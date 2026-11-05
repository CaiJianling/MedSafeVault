"""管理后台检查：口令散列、会话限速、上传登记、versions.json 写入、静态页面。

Run:  .venv\\Scripts\\python.exe tools\\test_update_admin.py

所有写操作都发生在临时目录里，不会碰仓库的 update/versions.json 和 files/。
"""
from __future__ import annotations

import hashlib
import json
import shutil
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(1, str(ROOT / "update"))

import admin as admin_lib  # noqa: E402
import server as update_server  # noqa: E402
from common import AdminError, parse_version, sha256_of  # noqa: E402

USER = "admin"
PASSWORD = "intranet-2026"
BLOB = b"MZ\x90\x00" + bytes(range(256)) * 40  # 假装是一个 exe，10 KiB 出头


def check(condition, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"  ok  {message}")


class Client:
    """小 HTTP 客户端：默认带上页面会带的来源头，token 走 X-Msv-Session。"""

    def __init__(self, port: int, token: str = "") -> None:
        self.base = f"http://127.0.0.1:{port}"
        self.token = token

    def raw(self, method: str, path: str, *, data: bytes | None = None,
            json_body: dict | None = None, origin: bool = True,
            headers: dict[str, str] | None = None, token: str | None = None):
        request = urllib.request.Request(self.base + path, data=data, method=method)
        if json_body is not None:
            request.add_header("Content-Type", "application/json; charset=utf-8")
            request.data = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
        if origin:
            request.add_header("X-Msv-Requested-With", "msv-admin")
        use = self.token if token is None else token
        if use:
            request.add_header("X-Msv-Session", use)
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, response.read(), dict(response.headers)
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read(), dict(exc.headers or {})

    def api(self, method: str, path: str, **kwargs) -> tuple[int, dict]:
        status, payload, _headers = self.raw(method, path, **kwargs)
        try:
            return status, json.loads(payload.decode("utf-8"))
        except Exception:
            return status, {"_raw": payload[:200].decode("utf-8", "replace")}

    def get(self, path: str, **kwargs) -> tuple[int, dict]:
        return self.api("GET", path, **kwargs)

    def text(self, path: str, **kwargs) -> tuple[int, bytes, dict]:
        return self.raw("GET", path, **kwargs)


def serve(root: Path, *, dist: Path | None = None, max_upload: int = 5 * 1024 * 1024,
          session_hours: float = 8.0,
          password: str = PASSWORD) -> tuple[ThreadingHTTPServer, int, admin_lib.AdminApi]:
    """在临时目录里起一个完整的服务（管理后台 + 更新接口同端口）。"""
    (root / "files").mkdir(parents=True, exist_ok=True)
    catalog = update_server.Catalog(root, root / "versions.json")
    api, site, _created = update_server.build_admin(
        catalog, dist=dist or (root / "web" / "dist"),
        credentials=root / "admin.json", username=USER, password=password,
        session_hours=session_hours, max_upload=max_upload,
        service_name="MedSafeVault 更新服务", app_version="2.0.0")
    httpd = update_server.build_server("127.0.0.1", 0, catalog, admin=api, site=site)
    threading.Thread(target=httpd.serve_forever, daemon=True,
                     name="msv-admin-test").start()
    port = httpd.server_address[1]
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=2):
                return httpd, port, api
        except Exception:
            time.sleep(0.05)
    httpd.shutdown()
    raise AssertionError("update server did not come up")


def login(client: Client) -> str:
    status, payload = client.api("POST", "/api/admin/login", origin=False,
                                 json_body={"username": USER, "password": PASSWORD})
    assert status == 200 and payload.get("ok"), payload
    return payload["session"]


# --------------------------------------------------------------------- 单元测试


def test_credentials(tmp: Path) -> None:
    print("[3] 口令只存散列，改口令要旧口令")
    path = tmp / "admin.json"
    creds = admin_lib.Credentials(path)
    check(not creds.configured, "还没有凭据文件时 configured 为假")
    creds.create("admin", "correct-horse", default=True)
    raw = path.read_text(encoding="utf-8")
    check("correct-horse" not in raw, "明文口令没有写进文件")
    check("pbkdf2_sha256" in raw and "salt" in raw, "文件里是 PBKDF2 散列和盐")
    check(creds.verify("admin", "correct-horse"), "正确口令通过")
    check(not creds.verify("admin", "Correct-Horse"), "大小写不同不通过")
    check(not creds.verify("root", "correct-horse"), "账号不对也不通过")
    check(creds.uses_default, "初始口令会被标记为待修改")
    try:
        creds.create("admin", "short")
    except AdminError as exc:
        check("至少 8 位" in exc.message, "过短的口令被拒绝")
    else:
        raise AssertionError("短口令竟然通过了")
    try:
        creds.change_password("admin", "wrong-old", "brand-new-pass")
    except AdminError as exc:
        check("当前口令不正确" in exc.message, "旧口令不对时不能改")
    else:
        raise AssertionError("改口令没校验旧口令")
    result = creds.change_password("admin", "correct-horse", "brand-new-pass")
    check(result["username"] == "admin" and not creds.uses_default, "改完不再标记初始口令")
    check(creds.verify("admin", "brand-new-pass"), "新口令生效")
    creds.reset_password("admin", "cli-reset-pass")
    check(creds.verify("admin", "cli-reset-pass"), "--set-password 能直接重置")


def test_sessions() -> None:
    print("[1] 会话有有效期，连错要锁定")
    store = admin_lib.Sessions(ttl_hours=0.01, max_fails=3, lockout_seconds=2,
                               window_seconds=60)
    token, expires = store.issue("admin")
    check(store.user(token) == "admin", "发出去的 token 能认出用户")
    check(store.user("nope") is None, "乱猜的 token 不认")
    store.drop(token)
    check(store.user(token) is None, "退出后 token 立刻失效")
    token2, _ = store.issue("admin")
    token3, _ = store.issue("admin")
    check(store.drop_user("admin") == 2, "改口令可以让全部会话失效")
    check(store.user(token2) is None and store.user(token3) is None, "所有会话都没了")
    check(store.locked_for("10.0.0.1") == 0, "没失败过不锁定")
    for _ in range(3):
        store.note_failure("10.0.0.1")
    check(store.locked_for("10.0.0.1") > 0, "连错 3 次进入锁定")
    time.sleep(2.1)
    check(store.locked_for("10.0.0.1") == 0, "锁定期过后可以重试")
    store.note_failure("10.0.0.2")
    store.note_success("10.0.0.2")
    check(store.locked_for("10.0.0.2") == 0, "成功登录清零失败次数")
    check(store.user(store.issue("admin")[0]) == "admin", "ttl 0.01h 也至少有 60 秒")


def test_filename_rules() -> None:
    print("[2] 文件名与内网地址猜测")
    check(admin_lib.sanitize_filename("..\\..\\windows\\system32\\evil.exe") == "evil.exe",
          "去掉目录，只留文件名")
    check("/" not in admin_lib.sanitize_filename('a/b\\c;d.exe'), "分隔符和分号被清掉")
    check(admin_lib.sanitize_filename("") == "MedSafeVault.exe", "空名字退回默认值")
    check(admin_lib.sanitize_filename("医安密管 2.1.0.exe") == "医安密管-2.1.0.exe",
          "中文文件名保留")
    addresses = admin_lib.lan_addresses(8000)
    check(all(a and not a.startswith("127.") for a in addresses),
          f"猜出来的地址不含回环（{addresses}）")


# ------------------------------------------------------------------- HTTP 检查


def test_auth_http(tmp: Path) -> None:
    print("[4] 未登录只能用更新接口，管理接口要 401")
    httpd, port, _api = serve(tmp)
    try:
        client = Client(port)
        status, health = client.get("/healthz")
        check(status == 200 and health["ok"], "healthz 正常返回")
        check("root" not in health and "config" not in health,
              "healthz 不再泄漏服务器路径")
        check(health["admin_page"] is False, "页面还没构建时 admin_page 为假")
        status, info = client.get("/api/info")
        check(status == 200 and info["logged_in"] is False, "api/info 公开且未登录")
        check(info["listening"]["port"] == port, "api/info 报出监听端口")
        status, _ = client.get("/api/admin/releases")
        check(status == 401 and "登录" in _["error"], f"未登录访问管理接口 401：{status}")
        status, _ = client.get("/api/admin/releases", origin=False)
        check(status == 401, f"读接口不要求来源头，未登录仍是 401：{status}")
        status, _ = client.api("POST", "/api/admin/releases",
                               json_body={"version": "9.9.9"})
        check(status == 401, "未登录不能登记版本")
        status, _ = client.api("POST", "/api/admin/upload", data=BLOB,
                               headers={"Content-Length": str(len(BLOB))})
        check(status == 401, "未登录不能上传文件")

        # 登录限速：同一 IP 连错 5 次要 429，锁定期内即使口令正确也不放行
        status, payload = client.api("POST", "/api/admin/login", origin=False,
                                     json_body={"username": USER, "password": "bad-pass"})
        check(status == 401 and "账号或口令不正确" in payload["error"],
              f"口令错误报统一的一句话（{payload['error']}）")
        for _ in range(5):
            status, payload = client.api("POST", "/api/admin/login", origin=False,
                                         json_body={"username": USER, "password": "bad-pass"})
        check(status == 429 and "失败次数过多" in payload["error"],
              f"连错之后返回 429（{payload['error']}）")
        status, payload = client.api("POST", "/api/admin/login", origin=False,
                                     json_body={"username": USER, "password": PASSWORD})
        check(status == 429, "锁定期内即使口令正确也要等一会儿")

        status, payload = client.api("POST", "/api/admin/logout", json_body={})
        check(status == 200 and payload["ok"], "没登录时退出登录也幂等返回成功")
    finally:
        httpd.shutdown()


def test_release_flow(tmp: Path) -> None:
    print("[5] 上传 → 登记 → 客户端拿到并下载 → 改说明 → 下架")
    httpd, port, api = serve(tmp)
    config = tmp / "versions.json"
    try:
        client = Client(port)
        client.token = login(client)

        # 改动类请求必须带来源头（挡跨站表单）
        status, payload = client.api("POST", "/api/admin/releases", origin=False,
                                     json_body={"version": "2.1.0"})
        check(status == 403 and "来源标记" in payload["error"], "缺来源头的写请求被拒")

        # 先上传：请求体就是文件本身
        status, payload = client.api("POST", "/api/admin/upload?name=MedSafeVault.exe",
                                     data=BLOB,
                                     headers={"Content-Length": str(len(BLOB))})
        check(status == 200 and payload["ok"], "上传成功")
        record = payload["upload"]
        want = hashlib.sha256(BLOB).hexdigest()
        check(record["sha256"] == want, "服务端算出的 sha256 与本地一致")
        check(record["size"] == len(BLOB), f"大小一致（{record['size']}）")
        staging = list((tmp / "files" / ".uploads").glob("*"))
        check(len(staging) == 1, "文件先落在 .uploads 暂存目录")

        # 登记
        status, payload = client.api("POST", "/api/admin/releases", json_body={
            "version": "2.1.0", "upload_token": record["token"],
            "notes": "新增两步验证", "mandatory": False})
        check(status == 200 and payload["ok"], "登记 2.1.0 成功")
        release = payload["release"]
        check(release["is_latest"], "默认成为最新版")
        check(release["sha256"] == want and release["size"] == len(BLOB),
              "versions.json 里的散列与大小正确")
        check(not (tmp / "files" / ".uploads" / record["token"]).exists(),
              "登记后暂存文件被搬走")
        data = json.loads(config.read_text(encoding="utf-8"))
        check(data["latest"] == "2.1.0" and len(data["releases"]) == 1,
              "versions.json 内容正确")
        check("_readme" in data, "手写说明键被保留")
        check(list((tmp / "files").glob("MedSafeVault-2.1.0.exe")),
              "没写版本号的文件名会自动补上版本号")
        check(not list((tmp / "files").glob("MedSafeVault.exe")), "原始名不会被直接沿用")

        # 客户端一侧：更新检查与下载
        status, payload = client.get("/api/version?current=2.0.0")
        check(status == 200 and payload["has_update"], "客户端能看到有新版")
        check(payload["update"]["sha256"] == want, "接口给出的 sha256 与文件一致")
        check(parse_version(payload["latest"]) == parse_version("2.1.0"), "最新版正确")
        status, payload = client.get("/api/version?current=2.1.0")
        check(not payload["has_update"], "同版本不再提示更新")
        status, body, headers = client.text("/download/2.1.0")
        check(status == 200 and body == BLOB, "整文件下载内容一致")
        check(headers.get("X-Sha256") == want, "下载响应带 X-Sha256")
        status, body, headers = client.text("/download/2.1.0",
                                            headers={"Range": "bytes=100-199"})
        check(status == 206 and body == BLOB[100:200], "单段 Range 断点续传可用")
        check(headers.get("Content-Range") == f"bytes 100-199/{len(BLOB)}",
              "Content-Range 正确")

        # 重复版本
        status, payload = client.api("POST", "/api/admin/releases", json_body={
            "version": "2.1.0", "existing_file": release["file"]})
        check(status == 409 and "已经登记" in payload["error"], "同版本重复登记要确认覆盖")
        status, payload = client.api("POST", "/api/admin/releases", json_body={
            "version": "2.1.0", "existing_file": release["file"], "replace": True})
        check(status == 200 and payload["ok"], "勾选覆盖后可以重登同一版本")

        # 非法版本号 / 不存在的已有文件
        status, payload = client.api("POST", "/api/admin/releases", json_body={
            "version": "v2.2", "existing_file": release["file"]})
        check(status == 400 and "版本号" in payload["error"], "非法版本号被拒")
        status, payload = client.api("POST", "/api/admin/releases", json_body={
            "version": "2.2.0", "existing_file": "files/没有这个.exe"})
        check(status == 400 and "找不到" in payload["error"], "不存在的已有文件被拒")
        status, payload = client.api("POST", "/api/admin/releases", json_body={
            "version": "2.2.0"})
        check(status == 400 and "上传" in payload["error"], "既没上传也没选已有文件被拒")

        # 第二个版本：不置最新，列表按版本倒序
        status, payload = client.api("POST", "/api/admin/upload?name=MedSafeVault-2.2.0.exe",
                                     data=BLOB + b"tail",
                                     headers={"Content-Length": str(len(BLOB) + 4)})
        token2 = payload["upload"]["token"]
        status, payload = client.api("POST", "/api/admin/releases", json_body={
            "version": "2.2.0", "upload_token": token2, "latest": False,
            "notes": "只做对照"})
        check(status == 200 and not payload["release"]["is_latest"], "可以只登记不置最新")
        check(json.loads(config.read_text(encoding="utf-8"))["latest"] == "2.1.0",
              "latest 没被抢走")
        status, payload = client.get("/api/admin/releases")
        versions = [r["version"] for r in payload["releases"]]
        check(versions == ["2.2.0", "2.1.0"], f"管理列表按版本从新到旧（{versions}）")

        # 设为最新 / 改说明 / 必须更新
        status, payload = client.api("PATCH", "/api/admin/releases/2.2.0",
                                     json_body={"latest": True})
        check(status == 200 and payload["latest"] == "2.2.0", "PATCH 可以设为最新")
        check(json.loads(config.read_text(encoding="utf-8"))["latest"] == "2.2.0",
              "versions.json 的 latest 已更新")
        status, payload = client.api("PATCH", "/api/admin/releases/2.2.0",
                                     json_body={"notes": "改成必须更新",
                                                "mandatory": True})
        check(payload["release"]["notes"] == "改成必须更新", "说明可以改")
        check(payload["release"]["mandatory"] is True, "必须更新开关可以改")
        status, payload = client.api("PATCH", "/api/admin/releases/2.2.0",
                                     json_body={"released_at": "2026-11-05"})
        check(payload["release"]["released_at"] == "2026-11-05", "发布日期可以改")
        status, payload = client.api("PATCH", "/api/admin/releases/2.2.0",
                                     json_body={"released_at": "11月5日"})
        check(status == 400, "非法日期被拒")
        status, payload = client.api("PATCH", "/api/admin/releases/9.9.9",
                                     json_body={"notes": "x"})
        check(status == 404, "不存在的版本改不了")

        # files/ 目录里已有文件的登记入口
        (tmp / "files" / "hand-copied.exe").write_bytes(b"hand" * 32)
        status, payload = client.get("/api/admin/files")
        names = [item["name"] for item in payload["files"]]
        check("hand-copied.exe" in names, "files/ 目录能列出来")
        item = next(i for i in payload["files"] if i["name"] == "hand-copied.exe")
        check(item["registered"] is False, "未登记的文件标记为未登记")
        status, payload = client.api("POST", "/api/admin/releases", json_body={
            "version": "2.3.0", "existing_file": "files/hand-copied.exe",
            "notes": "手工拷进来的"})
        check(status == 200 and payload["release"]["size"] == 128,
              "已有文件不重复拷贝，直接登记")
        status, payload = client.get("/api/admin/files")
        item = next(i for i in payload["files"] if i["name"] == "hand-copied.exe")
        check(item["registered"] and item["registered_for"] == ["2.3.0"],
              "登记后 files/ 里显示归属版本")

        # 文件名撞车时自动加版本后缀
        status, payload = client.api("POST", "/api/admin/upload?name=hand-copied.exe",
                                     data=BLOB, headers={"Content-Length": str(len(BLOB))})
        status, payload = client.api("POST", "/api/admin/releases", json_body={
            "version": "2.4.0", "upload_token": payload["upload"]["token"],
            "latest": False})
        check(status == 200 and payload["release"]["file"] != "files/hand-copied.exe",
              f"重名文件自动改名：{payload['release']['file']}")

        # 下架
        status, payload = client.api("DELETE", "/api/admin/releases/2.4.0",
                                     json_body={"delete_file": False})
        check(status == 200 and payload["removed"]["file_removed"] == "",
              "下架可以只删登记，保留文件")
        kept = tmp / "files" / Path(payload["removed"]["file"]).name
        check(kept.exists(), "文件留在 files/ 里")
        status, payload = client.api("DELETE", "/api/admin/releases/2.3.0",
                                     json_body={"delete_file": True})
        check(status == 200 and payload["removed"]["file_removed"] == "files/hand-copied.exe",
              "下架并删文件")
        check(not (tmp / "files" / "hand-copied.exe").exists(), "文件真的没了")
        status, payload = client.api("DELETE", "/api/admin/releases/2.3.0", json_body={})
        check(status == 404, "重复删除报 404")

        # 审计
        status, payload = client.get("/api/admin/audit")
        actions = [event["action"] for event in payload["events"]]
        check("login" in actions and "release" in actions,
              f"登录与发布都进了审计（{actions[:6]}）")
        check(payload["events"][0]["ip"], "审计记录带来源 IP")

        # 改口令：旧 token 失效，新 token 可用
        status, payload = client.api("POST", "/api/admin/password", json_body={
            "old_password": PASSWORD, "new_password": "another-2026"})
        check(status == 200 and payload["ok"], "改口令成功")
        old_token = client.token
        client.token = payload["session"]
        status, _ = client.get("/api/admin/session")
        check(status == 200, "新会话可用")
        status, payload = client.get("/api/admin/releases", token=old_token)
        check(status == 401, "旧会话在改口令后失效")
        status, payload = client.api("POST", "/api/admin/password", json_body={
            "old_password": "wrong", "new_password": "third-2026-pass"})
        check(status == 403 and "当前口令不正确" in payload["error"], "旧口令不对不能改")
        status, payload = client.api("POST", "/api/admin/password", json_body={
            "old_password": "another-2026", "new_password": "short"})
        check(status == 400 and "至少" in payload["error"], "太短的新口令被拒")
        status, payload = client.api("POST", "/api/admin/logout", json_body={})
        check(status == 200, "退出登录")
        status, _ = client.get("/api/admin/session")
        check(status == 401, "退出后管理接口又回到 401")
        check(api.credentials.verify(USER, "another-2026"), "散列里是新口令")
    finally:
        httpd.shutdown()


def test_integrity(tmp: Path) -> None:
    print("[6] 散列不符要能看出来，非法条目被忽略，路径穿越被挡住")
    config = tmp / "versions.json"
    (tmp / "files").mkdir(parents=True, exist_ok=True)
    payload = {"_readme": "test", "latest": "3.0.0", "releases": [
        {"version": "3.0.0", "file": "files/ok.exe", "notes": "正常",
         "size": 4, "sha256": hashlib.sha256(b"hand").hexdigest()},
        {"version": "3.0.1", "file": "files/tampered.exe", "notes": "被换过",
         "size": 4, "sha256": "0" * 64},
        {"version": "not-a-version", "file": "files/x.exe", "notes": "非法"},
        {"version": "3.0.2", "file": "../outside.exe", "notes": "穿越"},
        {"version": "3.0.3", "file": "files/gone.exe", "notes": "文件不见了"},
    ]}
    config.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    (tmp / "files" / "ok.exe").write_bytes(b"hand")
    (tmp / "files" / "tampered.exe").write_bytes(b"hand")
    (tmp.parent / "outside.exe").write_bytes(b"nope")

    httpd, port, _api = serve(tmp)
    try:
        client = Client(port)
        client.token = login(client)
        status, records = client.get("/api/admin/releases")
        by_version = {r["version"]: r for r in records["releases"]}
        check("not-a-version" not in by_version, "非法版本条目不进列表")
        check(by_version["3.0.0"]["hash_matches"] and by_version["3.0.0"]["exists"],
              "正常条目哈希匹配")
        check(not by_version["3.0.1"]["hash_matches"], "散列不符会被标出来")
        check(by_version["3.0.2"]["path"] == "" and not by_version["3.0.2"]["exists"],
              "服务根目录之外的文件不被承认")
        check(not by_version["3.0.3"]["exists"], "文件缺失显示为不存在")
        status, payload = client.get("/api/version?current=2.0.0")
        check(status == 200 and payload["latest"] == "3.0.0",
              "latest 声明优先于版本号最高的条目")
        check("3.0.1" in [r["version"] for r in payload["releases"]],
              "公开接口仍列出所有条目")
        status, *_ = client.text("/download/3.0.2")
        check(status == 404, "穿越路径的下载被拒")
        status, *_ = client.text("/download/3.0.3")
        check(status == 404, "缺失文件的下载报 404")

        # 静态页面
        dist = tmp / "web" / "dist"
        (dist / "assets").mkdir(parents=True, exist_ok=True)
        (dist / "index.html").write_text("<html>admin</html>", encoding="utf-8")
        (dist / "assets" / "index-abc.js").write_text("console.log(1)", encoding="utf-8")
        status, body, headers = client.text("/")
        check(status == 200 and body == b"<html>admin</html>", "构建产物被静态托管")
        check("text/html" in (headers.get("Content-Type") or ""), "index 的 MIME 正确")
        status, body, headers = client.text("/assets/index-abc.js")
        check("text/javascript" in (headers.get("Content-Type") or ""), "js 的 MIME 正确")
        check("immutable" in (headers.get("Cache-Control") or ""),
              "带哈希的资源名可以长缓存")
        status, _body, headers = client.text("/", headers={"If-None-Match":
                                                           headers.get("ETag", "?")})
        check(status == 200, "换页面的 ETag 后仍然正常返回")
        status, *_ = client.text("/index.html")
        check(status == 200, "直接访问 index.html 也可以")
        status, body, _ = client.text("/../../update/server.py")
        check(status != 200 or b"ThreadingHTTPServer" not in body, "目录穿越拿不到源码")
        status, body, _ = client.text("/%2e%2e/%2e%2e/etc/passwd")
        check(status == 404 or body == b"<html>admin</html>",
              "编码过的穿越最多退回单页应用，拿不到文件内容")
        status, *_ = client.text("/unknown-route")
        check(status == 200 and b"admin" in body, "未知路径回落到单页应用")
        status, payload = client.get("/api/nope")
        check(status == 404, "未知的 /api 路径不会被当成页面回落")
    finally:
        httpd.shutdown()
        (tmp.parent / "outside.exe").unlink(missing_ok=True)


def test_limits(tmp: Path) -> None:
    print("[7] 上传上限、后缀白名单与会话时长")
    httpd, port, api = serve(tmp, max_upload=2048, session_hours=0.0005)
    try:
        client = Client(port)
        client.token = login(client)
        status, payload = client.api("POST", "/api/admin/upload?name=big.exe",
                                    data=b"x" * 4096,
                                    headers={"Content-Length": "4096"})
        check(status == 413 and "上限" in payload["error"], "超过上限直接拒绝")
        check(not list((tmp / "files" / ".uploads").glob("*")), "被拒的上传没留下残留文件")
        status, payload = client.api("POST", "/api/admin/upload?name=readme.txt",
                                    data=b"hello", headers={"Content-Length": "5"})
        check(status == 400 and "只支持" in payload["error"], "非分发后缀被拒")
        status, payload = client.api("POST", "/api/admin/upload?name=a.exe", data=b"",
                                    headers={"Content-Length": "0"})
        check(status == 400, "空请求体被拒")
        status, payload = client.api("POST", "/api/admin/releases", json_body={
            "version": "2.1", "upload_token": "不存在"})
        check(status == 400 and "过期" in payload["error"], "无效 token 报过期")
        # 会话到期：ttl 有 60 秒下限（见 [1]），这里直接把过期时间挪到过去
        token = client.token
        holder = api.sessions._tokens[client.token]
        api.sessions._tokens[token] = (holder[0], time.time() - 1)
        status, payload = client.get("/api/admin/session")
        check(status == 401, "会话到期后需要重新登录")
        status, payload = client.api("POST", "/api/admin/login", origin=False,
                                    json_body={"username": USER, "password": PASSWORD})
        check(status == 200 and payload["must_change_password"] is False,
              "手工指定的口令不算初始口令")
        client.token = payload["session"]
        check(client.get("/api/admin/session")[0] == 200, "重新登录又能用了")
    finally:
        httpd.shutdown()


def test_client_contract(tmp: Path) -> None:
    print("[8] 桌面客户端的解析路径没被管理后台改坏")
    sys.path.insert(0, str(ROOT))
    from backend import updater

    httpd, port, _api = serve(tmp)
    base = f"http://127.0.0.1:{port}/"
    try:
        client = Client(port)
        client.token = login(client)
        status, payload = client.api("POST", "/api/admin/upload?name=MedSafeVault.exe",
                                    data=BLOB, headers={"Content-Length": str(len(BLOB))})
        token = payload["upload"]["token"]
        status, created = client.api("POST", "/api/admin/releases", json_body={
            "version": "9.9.9", "upload_token": token, "notes": "客户端契约检查",
            "mandatory": True})
        check(status == 200, "登记成功")
        info = updater.check(base, current="2.0.0")
        want = hashlib.sha256(BLOB).hexdigest()
        check(info["available"] is True, "客户端判断为有新版")
        check(info["latest"] == "9.9.9", "客户端拿到最新版号")
        check(info["version"] == "9.9.9", "客户端拿到版本号")
        check(info["sha256"] == want, "客户端拿到 sha256")
        check(info["size"] == len(BLOB), "客户端拿到 size")
        check(info["notes"] == "客户端契约检查", "客户端拿到说明")
        check(info["mandatory"] is True, "客户端拿到「必须更新」标记")
        check(info["download"].startswith("http"), "客户端拿到绝对下载地址")
        check("9.9.9" in info["filename"], f"下载文件名带着版本号（{info['filename']}）")
        path = updater.download(info, dest_dir=tmp)
        check(path.is_file() and sha256_of(path) == want,
              "客户端下载并按 sha256 校验通过")
        status, payload = client.get("/api/version?current=9.9.9")
        check(payload["has_update"] is False, "已是最新时客户端不再提示")
    finally:
        httpd.shutdown()


def main() -> None:
    test_sessions()
    test_filename_rules()
    for name, fn in (("creds", test_credentials), ("auth", test_auth_http)):
        tmp = Path(tempfile.mkdtemp(prefix=f"msv-admin-{name}-"))
        try:
            fn(tmp)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    for name in ("release", "integrity", "limits", "contract"):
        tmp = Path(tempfile.mkdtemp(prefix=f"msv-admin-{name}-"))
        try:
            {"release": test_release_flow, "integrity": test_integrity,
             "limits": test_limits,
             "contract": test_client_contract}[name](tmp)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    print("\nAll update admin checks passed.")


if __name__ == "__main__":
    main()
