"""更新服务的管理后台：账号、会话、上传暂存、静态页面与管理接口。

只用标准库（Linux 上 `python3 update/server.py` 就能跑，不需要 pip 安装任何东西）。
被 `server.py` 的 HTTP 层调用，本身不监听端口：

    Credentials   —— update/admin.json 里的 PBKDF2 口令散列，首次启动生成
    Sessions      —— 内存里的会话表 + 每 IP 登录失败限速
    UploadStore   —— 浏览器上传的 exe 先落 files/.uploads，登记时再搬进 files/
    StaticSite    —— 托管 update/web/dist 里构建好的 HeroUI 管理页面
    AdminApi      —— /api/admin/* 的管理接口

安全边界（内网工具，按最小可用设计）：

* 口令只存 PBKDF2-SHA256 散列与随机盐，不存明文；
* 会话是随机 token 的 HttpOnly / SameSite=Lax Cookie，改动类请求额外要求
  `X-Msv-Requested-With` 头（跨站脚本无法在没有 CORS 的情况下带上它）；
* 下载接口 `/api/version`、`/download/<version>` 仍然不需要登录，因为客户端
  每次启动都要访问它，且只提供公开的版本元数据；
* 静态页面只服务 update/web/dist 里存在的文件，路径解析后仍在 dist 内才允许。
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import socket
import threading
import time
import urllib.parse
from collections import deque
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any, BinaryIO, Callable

from common import (ALLOWED_SUFFIXES, AdminError, human_size, parse_version,
                    sha256_of, today, write_json_atomic)

log = logging.getLogger("msv-update")

COOKIE_NAME = "msv_admin"
SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._+\-\u4e00-\u9fff]+")


def sanitize_filename(name: str, fallback: str = "MedSafeVault.exe") -> str:
    """只留一个安全的文件名：去目录、去控制字符、压掉奇怪符号。"""
    base = urllib.parse.unquote(str(name or "")).replace("\\", "/").split("/")[-1]
    base = re.sub(r"[\x00-\x1f\"'<>|;*?`]", "", base).strip()
    base = SAFE_NAME_RE.sub("-", base).strip("-.")
    if not base or base in (".", ".."):
        return fallback
    return base[:120]


def lan_addresses(port: int) -> list[str]:
    """尽力猜一下这台机器在内网被访问的地址，猜不到就返回空列表。

    UDP connect 不会真的发包，只是让内核选出默认出口网卡；离线环境里它可能
    直接失败，那就退回 gethostbyname_ex 列出的本机地址。
    """
    candidates: list[str] = []

    def add(value: str) -> None:
        if value and not value.startswith("127.") and value not in candidates:
            candidates.append(value)

    for family_target in ("8.8.8.8", "10.255.255.255"):
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe.settimeout(0.2)
            probe.connect((family_target, port or 1))
            add(probe.getsockname()[0])
        except OSError:
            pass
        finally:
            probe.close()
    try:
        info = socket.gethostbyname_ex(socket.gethostname())
        for value in (info[2] if len(info) > 2 else []) or []:
            add(value)
    except OSError:
        pass
    return candidates


# --------------------------------------------------------------------- 口令


class Credentials:
    """update/admin.json：用户名 + PBKDF2-SHA256 散列，绝不存明文。"""

    KDF = "pbkdf2_sha256"
    ITERATIONS = 240_000
    MIN_LENGTH = 8

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._lock = threading.Lock()
        self._data: dict[str, Any] = {}
        self.reload()

    # ---------------------------------------------------------------- 读写
    def reload(self) -> None:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raw = {}
        except Exception as exc:  # 半个文件被写坏也不能让服务起不来
            log.error("凭据文件读取失败：%s（%s）", self.path, exc)
            raw = {}
        self._data = raw if isinstance(raw, dict) else {}

    def _write(self, data: dict[str, Any]) -> None:
        write_json_atomic(self.path, data)
        self._data = data

    @staticmethod
    def _hash(password: str, salt: bytes, iterations: int) -> bytes:
        return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt,
                                   iterations, 32)

    @classmethod
    def digest(cls, password: str, salt_hex: str, iterations: int) -> str:
        return cls._hash(password, bytes.fromhex(salt_hex), iterations).hex()

    # ------------------------------------------------------------------ 状态
    @property
    def configured(self) -> bool:
        data = self._data
        return bool(data.get("username") and data.get("hash") and data.get("salt"))

    @property
    def username(self) -> str:
        return str(self._data.get("username") or "")

    @property
    def uses_default(self) -> bool:
        """还在用首次生成/文档里写明的初始口令。"""
        return bool(self._data.get("default_password"))

    @property
    def updated_at(self) -> str:
        return str(self._data.get("updated_at") or "")

    def check_length(self, password: str) -> None:
        if len(password or "") < self.MIN_LENGTH:
            raise AdminError(400, f"口令至少 {self.MIN_LENGTH} 位")

    # ---------------------------------------------------------------- 创建/校验
    def create(self, username: str, password: str, *, default: bool = False) -> dict:
        self.check_length(password)
        name = (username or "admin").strip() or "admin"
        salt = secrets.token_hex(16)
        self._write({
            "_readme": "MedSafeVault 更新服务管理后台的登录凭据；只存 PBKDF2 散列。"
                       "忘记口令时用 python update/server.py --set-password 重置。",
            "username": name,
            "kdf": self.KDF,
            "iterations": self.ITERATIONS,
            "salt": salt,
            "hash": self.digest(password, salt, self.ITERATIONS),
            "default_password": bool(default),
            "created_at": today(),
            "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        })
        return {"username": name, "created": True}

    def verify(self, username: str, password: str) -> bool:
        data = self._data
        if not self.configured:
            return False
        if not hmac.compare_digest(str(data.get("username") or ""), username or ""):
            # 恒定返回 False，不告诉调用者是账号错还是口令错（上层也是同一句话）
            return False
        try:
            iterations = int(data.get("iterations") or self.ITERATIONS)
            want = str(data.get("hash") or "")
            got = self.digest(password, str(data.get("salt") or ""), iterations)
        except (ValueError, TypeError):
            return False
        return hmac.compare_digest(want, got)

    def change_password(self, username: str, old: str, new: str) -> dict:
        if not self.verify(username, old):
            raise AdminError(403, "当前口令不正确")
        self.check_length(new)
        if old == new:
            raise AdminError(400, "新口令与当前口令相同")
        salt = secrets.token_hex(16)
        data = dict(self._data)
        data.update({
            "salt": salt,
            "hash": self.digest(new, salt, self.ITERATIONS),
            "default_password": False,
            "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        })
        self._write(data)
        return {"username": data.get("username"), "updated_at": data["updated_at"]}

    def reset_password(self, username: str, new: str) -> dict:
        """CLI 重置：不需要旧口令，因为操作者已经能登录这台服务器。"""
        self.check_length(new)
        salt = secrets.token_hex(16)
        data = dict(self._data) if self.configured else {}
        data.update({
            "username": (username or data.get("username") or "admin").strip(),
            "kdf": self.KDF,
            "iterations": self.ITERATIONS,
            "salt": salt,
            "hash": self.digest(new, salt, self.ITERATIONS),
            "default_password": False,
            "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        })
        data.setdefault("created_at", today())
        self._write(data)
        return {"username": data["username"], "updated_at": data["updated_at"]}


# --------------------------------------------------------------------- 会话


class Sessions:
    """内存会话表 + 每个 IP 的登录失败限速。重启后需要重新登录，够用。"""

    def __init__(self, ttl_hours: float = 8.0, max_fails: int = 5,
                 lockout_seconds: int = 300, window_seconds: int = 900) -> None:
        self.ttl = max(60.0, ttl_hours * 3600.0)
        self.max_fails = max_fails
        self.lockout_seconds = lockout_seconds
        self.window = window_seconds
        self._tokens: dict[str, tuple[str, float]] = {}
        self._fails: dict[str, tuple[int, float]] = {}
        self._lock = threading.Lock()

    def issue(self, username: str) -> tuple[str, float]:
        token = secrets.token_urlsafe(32)
        expires = time.time() + self.ttl
        with self._lock:
            self._prune()
            self._tokens[token] = (username, expires)
        return token, expires

    def user(self, token: str | None) -> str | None:
        if not token:
            return None
        with self._lock:
            record = self._tokens.get(token)
            if not record:
                return None
            username, expires = record
            if expires < time.time():
                self._tokens.pop(token, None)
                return None
            return username

    def drop(self, token: str | None) -> None:
        if not token:
            return
        with self._lock:
            self._tokens.pop(token, None)

    def drop_user(self, username: str) -> int:
        """改口令后让该账号的所有会话失效。"""
        with self._lock:
            gone = [key for key, (user, _) in self._tokens.items() if user == username]
            for key in gone:
                self._tokens.pop(key, None)
        return len(gone)

    def _prune(self) -> None:
        now = time.time()
        for key in [k for k, (_, exp) in self._tokens.items() if exp < now]:
            self._tokens.pop(key, None)
        for key in [k for k, (_, seen) in self._fails.items() if seen + self.window < now]:
            self._fails.pop(key, None)

    def locked_for(self, key: str) -> int:
        with self._lock:
            record = self._fails.get(key)
            if not record:
                return 0
            count, seen = record
            if count < self.max_fails:
                return 0
            remaining = seen + self.lockout_seconds - time.time()
            return int(remaining) if remaining > 0 else 0

    def note_failure(self, key: str) -> None:
        with self._lock:
            self._prune()
            count, _seen = self._fails.get(key, (0, 0.0))
            self._fails[key] = (count + 1, time.time())

    def note_success(self, key: str) -> None:
        with self._lock:
            self._fails.pop(key, None)


# ------------------------------------------------------------------- 上传暂存


class UploadStore:
    """浏览器分两步走：先把 exe 传进 .uploads，再带着 token 登记成版本。

    这样上传进度、中断、以及“传一半又取消”都只影响暂存文件，versions.json
    永远只描述已经完整落盘的文件。
    """

    def __init__(self, staging: Path, max_bytes: int, keep_minutes: int = 90) -> None:
        self.staging = Path(staging)
        self.max_bytes = max_bytes
        self.keep = keep_minutes * 60
        self._records: dict[str, dict] = {}
        self._lock = threading.Lock()

    def start(self) -> None:
        self.staging.mkdir(parents=True, exist_ok=True)
        self.purge()

    def purge(self) -> None:
        now = time.time()
        try:
            entries = list(self.staging.glob("*"))
        except OSError:
            return
        for path in entries:
            try:
                if path.stat().st_mtime + self.keep < now:
                    path.unlink()
            except OSError:
                continue
        with self._lock:
            alive = {p.name for p in self.staging.glob("*")}
            for token in [k for k in self._records if k not in alive]:
                self._records.pop(token, None)

    def put(self, stream: BinaryIO, length: int, name: str,
            on_progress: Callable[[int, int], None] | None = None) -> dict:
        """把请求体原样写进暂存目录，边写边算 sha256。"""
        self.staging.mkdir(parents=True, exist_ok=True)
        token = secrets.token_urlsafe(16)
        filename = sanitize_filename(name)
        path = self.staging / f"{token}.part"
        digest = hashlib.sha256()
        written = 0
        try:
            with open(path, "wb") as sink:
                # 只读 Content-Length 这么多字节：多读一个字节都会把长连接的
                # 下一条请求吃掉，服务端就会卡在 read() 上。
                while written < length:
                    block = stream.read(min(1024 * 1024, length - written))
                    if not block:
                        break
                    written += len(block)
                    if written > self.max_bytes:
                        raise AdminError(
                            413, f"上传超过上限 {human_size(self.max_bytes)}，"
                                 f"请用 --max-upload 调大或改为手工放到 files/ 目录")
                    digest.update(block)
                    sink.write(block)
                    if on_progress:
                        on_progress(written, length)
                sink.flush()
                os.fsync(sink.fileno())
        except AdminError:
            path.unlink(missing_ok=True)
            raise
        except Exception as exc:
            path.unlink(missing_ok=True)
            log.error("上传失败：%s", exc)
            raise AdminError(400, f"上传失败：{exc}") from exc
        if written <= 0:
            path.unlink(missing_ok=True)
            raise AdminError(400, "上传内容为空")
        final = self.staging / token
        os.replace(path, final)
        record = {
            "token": token,
            "filename": filename,
            "size": written,
            "sha256": digest.hexdigest(),
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        with self._lock:
            self._records[token] = record
        return record

    def get(self, token: str) -> dict | None:
        with self._lock:
            record = self._records.get(token or "")
        if not record:
            return None
        path = self.staging / record["token"]
        if not path.is_file():
            with self._lock:
                self._records.pop(record["token"], None)
            return None
        return {**record, "path": path}

    def take(self, token: str, target: Path) -> Path:
        record = self.get(token)
        if not record:
            raise AdminError(400, "上传已过期，请重新选择文件")
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(record["path"], target)
        with self._lock:
            self._records.pop(token, None)
        return target

    def discard(self, token: str) -> None:
        record = self.get(token)
        if record:
            try:
                record["path"].unlink()
            except OSError:
                pass
        with self._lock:
            self._records.pop(token or "", None)


# ------------------------------------------------------------------ 静态页面


class StaticSite:
    """托管 update/web/dist（Vite 构建好的 HeroUI 管理页面）。

    dist 是构建产物、随目录一起发布，Linux 服务器上不需要 Node；解析后的路径
    必须仍落在 dist 内，所以不存在目录穿越。
    """

    MIME = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".ico": "image/x-icon",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
        ".map": "application/json; charset=utf-8",
        ".txt": "text/plain; charset=utf-8",
        ".webmanifest": "application/manifest+json",
    }

    def __init__(self, dist: Path) -> None:
        self.dist = Path(dist).resolve()

    @property
    def ready(self) -> bool:
        return (self.dist / "index.html").is_file()

    def resolve(self, url_path: str) -> Path | None:
        decoded = urllib.parse.unquote(url_path)
        candidate = (self.dist / decoded.lstrip("/")).resolve()
        if candidate != self.dist and self.dist not in candidate.parents:
            log.warning("静态目录之外的请求被拒绝：%s", decoded)
            return None
        return candidate if candidate.is_file() else None

    def serve(self, handler, url_path: str, fallback_to_index: bool = True) -> bool:
        """把文件发给客户端；True = 已经回复，False = 交给上层继续处理。"""
        path = self.resolve(url_path)
        if path is None and fallback_to_index and "." not in Path(url_path).name:
            path = self.resolve("/index.html")
        if path is None:
            return False
        stat = path.stat()
        etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
        fresh = handler.headers.get("If-None-Match") == etag
        suffix = path.suffix.lower()
        cache = ("public, max-age=31536000, immutable"
                 if url_path.startswith("/assets/") else "no-cache")
        handler.send_response(304 if fresh else 200)
        handler.send_header("Content-Type",
                            self.MIME.get(suffix, "application/octet-stream"))
        handler.send_header("ETag", etag)
        handler.send_header("Cache-Control", cache)
        handler.send_header("X-Content-Type-Options", "nosniff")
        if fresh:
            handler.send_header("Content-Length", "0")
            handler.end_headers()
            return True
        handler.send_header("Content-Length", str(stat.st_size))
        handler.end_headers()
        if handler.command == "HEAD":
            return True
        try:
            with open(path, "rb") as source:
                for block in iter(lambda: source.read(256 * 1024), b""):
                    handler.wfile.write(block)
        except (BrokenPipeError, ConnectionResetError):
            pass
        return True


# --------------------------------------------------------------------- 管理 API


class AdminApi:
    """/api/admin/*：登录、版本列表、上传登记、改说明/必须更新/最新、删除、改口令。

    约定：所有回复都是 JSON，都有 `ok`；错误统一 `{ok:false, error:"…"}`，
    管理页面直接把 error 显示出来，因此这里的每句话都必须是给人看的中文。
    """

    def __init__(self, catalog, credentials: Credentials, sessions: Sessions,
                 uploads: UploadStore, service: str = "MedSafeVault 更新服务",
                 app_version: str = "", audit_limit: int = 200) -> None:
        self.catalog = catalog
        self.credentials = credentials
        self.sessions = sessions
        self.uploads = uploads
        self.service = service
        self.app_version = app_version
        self.audit: deque[dict] = deque(maxlen=audit_limit)

    # ------------------------------------------------------------------ 会话
    def token_of(self, handler) -> str | None:
        header = handler.headers.get("X-Msv-Session")
        if header:
            return header.strip() or None
        return handler.cookie(COOKIE_NAME)

    def user(self, handler) -> str | None:
        return self.sessions.user(self.token_of(handler))

    def require(self, handler) -> str:
        user = self.user(handler)
        if not user:
            raise AdminError(401, "请先登录管理后台")
        return user

    def _guard_write(self, handler, method: str, path: str) -> None:
        """登录接口之外，改动类请求必须带上页面自己加的头（挡掉跨站表单）。"""
        if path == "/api/admin/login" or method in ("GET", "HEAD"):
            return
        if not handler.headers.get("X-Msv-Requested-With"):
            raise AdminError(403, "请求缺少来源标记，请刷新页面后重试")

    def log_event(self, handler, user: str, action: str, detail: str) -> None:
        entry = {
            "time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "ip": handler.remote_ip() if handler is not None else "",
            "user": user or "-",
            "action": action,
            "detail": detail,
        }
        self.audit.appendleft(entry)
        log.info("%(ip)s %(user)s %(action)s：%(detail)s", entry)

    def record_login_failure(self, handler, username: str) -> None:
        self.audit.appendleft({
            "time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "ip": handler.remote_ip(),
            "user": username or "-",
            "action": "login-failed",
            "detail": "口令或账号不正确",
        })

    # ------------------------------------------------------------------ 公共信息
    def public_info(self, handler) -> dict:
        latest = self.catalog.latest()
        port = 0
        try:
            port = int(handler.server.server_address[1])
        except Exception:
            pass
        host = getattr(handler.server, "msv_host", "") or ""
        return {
            "ok": True,
            "service": self.service,
            "app_version": self.app_version,
            "logged_in": bool(self.user(handler)),
            "username": self.user(handler) or "",
            "latest": latest["version"] if latest else "",
            "releases": len(self.catalog.all_releases()),
            "listening": {"host": host, "port": port},
            "addresses": [f"http://{ip}:{port}/" for ip in lan_addresses(port)],
            "client_endpoints": ["/api/version?current=2.0.0", "/api/releases",
                                 "/download/<version>", "/healthz"],
        }

    def admin_summary(self, handler) -> dict:
        info = self.public_info(handler)
        return {
            **info,
            "root": str(self.catalog.root),
            "config": str(self.catalog.config),
            "staging": str(self.uploads.staging),
            "max_upload": self.uploads.max_bytes,
            "using_default_password": self.credentials.uses_default,
            "password_updated_at": self.credentials.updated_at,
            "session_hours": round(self.sessions.ttl / 3600, 2),
        }

    # --------------------------------------------------------------------- 路由
    def handle(self, handler, method: str, path: str, query: dict) -> bool:
        """处理 /api/admin/*；返回 False 表示不属于管理接口，交回 server.py。"""
        if not path.startswith("/api/admin/"):
            return False
        try:
            self._guard_write(handler, method, path)
            self._route(handler, method, path, query)
        except AdminError as exc:
            # 出错也没读过请求体的话必须排空，否则 HTTP/1.1 长连接的下一条请求会错位
            handler.drain_body()
            handler.json({"ok": False, "error": exc.message, **exc.extra}, exc.status)
        except Exception as exc:  # 不能把堆栈泄漏到页面上
            log.exception("管理接口失败：%s %s", method, path)
            handler.drain_body()
            handler.json({"ok": False, "error": f"服务内部错误：{exc}"}, 500)
        return True

    def _route(self, handler, method: str, path: str, query: dict) -> None:
        if method in ("POST", "PUT") and path == "/api/admin/login":
            self.login(handler)
            return
        if method in ("POST", "PUT") and path == "/api/admin/logout":
            self.logout(handler)
            return

        user = self.require(handler)
        if method in ("GET", "HEAD"):
            if path == "/api/admin/session":
                handler.json({"ok": True, "username": user,
                              **self.admin_summary(handler)})
            elif path == "/api/admin/releases":
                handler.json({"ok": True, "latest": self.catalog.declared_latest(),
                              "releases": self.catalog.admin_records()})
            elif path == "/api/admin/files":
                handler.json({"ok": True, "files": self.catalog.disk_files()})
            elif path == "/api/admin/audit":
                handler.json({"ok": True, "events": list(self.audit)})
            else:
                raise AdminError(404, "接口不存在")
            return

        if method in ("POST", "PUT"):
            if path == "/api/admin/upload":
                self.upload(handler, user, query)
            elif path == "/api/admin/releases":
                self.create_release(handler, user)
            elif path == "/api/admin/password":
                self.change_password(handler, user)
            elif path.startswith("/api/admin/uploads/"):
                token = urllib.parse.unquote(path.rsplit("/", 1)[-1])
                self.uploads.discard(token)
                self.log_event(handler, user, "upload-cancel", token)
                handler.json({"ok": True})
            else:
                raise AdminError(404, "接口不存在")
            return

        if method in ("PATCH",):
            if path.startswith("/api/admin/releases/"):
                self.patch_release(handler, user, self._version_of(path))
            else:
                raise AdminError(404, "接口不存在")
            return

        if method == "DELETE":
            if path.startswith("/api/admin/releases/"):
                self.delete_release(handler, user, self._version_of(path))
            else:
                raise AdminError(404, "接口不存在")
            return

        raise AdminError(405, "不支持的请求方法")

    @staticmethod
    def _version_of(path: str) -> str:
        return urllib.parse.unquote(path.split("/api/admin/releases/", 1)[1]).strip("/")

    # --------------------------------------------------------------------- 登录
    def login(self, handler) -> None:
        body = handler.body_json()
        username = str(body.get("username") or "").strip()
        password = str(body.get("password") or "")
        ip = handler.remote_ip()
        wait = self.sessions.locked_for(ip)
        if wait:
            handler.json({"ok": False,
                          "error": f"失败次数过多，请在 {wait} 秒后重试",
                          "retry_after": wait}, 429)
            self.record_login_failure(handler, username)
            return
        if not self.credentials.configured:
            handler.json({"ok": False,
                          "error": "服务端还没有管理员账号，请用 --password 初始化"}, 503)
            return
        if not self.credentials.verify(username, password):
            self.sessions.note_failure(ip)
            self.record_login_failure(handler, username)
            remaining = max(0, self.sessions.max_fails - 1)
            handler.json({"ok": False,
                          "error": "账号或口令不正确",
                          "hint": f"连续失败 {self.sessions.max_fails} 次会锁定 "
                                  f"{self.sessions.lockout_seconds} 秒（还可约 {remaining} 次）"}, 401)
            return
        self.sessions.note_success(ip)
        token, expires = self.sessions.issue(self.credentials.username)
        handler.set_cookie(COOKIE_NAME, token, expires)
        self.log_event(handler, self.credentials.username, "login", "登录成功")
        handler.json({
            "ok": True,
            "username": self.credentials.username,
            "session": token,
            "expires_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(expires)),
            "must_change_password": self.credentials.uses_default,
        })

    def logout(self, handler) -> None:
        token = self.token_of(handler)
        user = self.sessions.user(token)
        self.sessions.drop(token)
        handler.clear_cookie(COOKIE_NAME)
        self.log_event(handler, user or "-", "logout", "退出登录")
        handler.json({"ok": True})

    def change_password(self, handler, user: str) -> None:
        body = handler.body_json()
        old = str(body.get("old_password") or "")
        new = str(body.get("new_password") or "")
        result = self.credentials.change_password(user, old, new)
        self.sessions.drop_user(user)
        token, expires = self.sessions.issue(result["username"])
        handler.set_cookie(COOKIE_NAME, token, expires)
        self.log_event(handler, user, "password", "修改登录口令")
        handler.json({"ok": True, "session": token, **result})

    # --------------------------------------------------------------------- 上传
    def upload(self, handler, user: str, query: dict) -> None:
        length = int(handler.headers.get("Content-Length") or 0)
        if length <= 0:
            raise AdminError(400, "上传请求没有长度，请重新选择文件")
        if length > self.uploads.max_bytes:
            raise AdminError(413, f"文件超过上限 {human_size(self.uploads.max_bytes)}")
        suffix = Path(sanitize_filename(handler.query_text(query, "name"))).suffix.lower()
        if suffix not in ALLOWED_SUFFIXES:
            raise AdminError(400, "只支持 " + "、".join(ALLOWED_SUFFIXES) + " 这类分发文件")
        self.uploads.purge()
        record = self.uploads.put(handler.rfile, length,
                                  handler.query_text(query, "name"))
        handler.json({
            "ok": True,
            "upload": {k: v for k, v in record.items() if k != "path"},
        })
        self.log_event(handler, user, "upload",
                       f"{record['filename']}（{human_size(record['size'])}，"
                       f"sha256 {record['sha256'][:12]}…）")

    def create_release(self, handler, user: str) -> None:
        body = handler.body_json()
        version = str(body.get("version") or "").strip()
        try:
            parse_version(version)
        except ValueError as exc:
            raise AdminError(400, str(exc)) from exc
        notes = str(body.get("notes") or "").strip()[:2000]
        mandatory = bool(body.get("mandatory"))
        make_latest = body.get("latest")
        make_latest = True if make_latest is None else bool(make_latest)
        replace = bool(body.get("replace"))
        token = str(body.get("upload_token") or "").strip()
        existing_file = str(body.get("existing_file") or "").strip()
        if not token and not existing_file:
            raise AdminError(400, "请先上传文件，或选择 files/ 目录里已有的文件")
        supplied = str(body.get("filename") or "").strip()
        base_name = supplied or f"MedSafeVault-{version}.exe"
        if token:
            record = self.uploads.get(token)
            if not record:
                raise AdminError(400, "上传已过期，请重新选择文件")
            base_name = supplied or record["filename"]
        name = sanitize_filename(base_name, f"MedSafeVault-{version}.exe")
        # 文件名里最好带着版本号，files/ 目录才不会一团乱麻；页面里手填过就不动它。
        tail = Path(name).suffix.lower() or ".exe"
        if not supplied and version not in Path(name).stem:
            name = f"{Path(name).stem}-{version}{tail}"
        current = self.catalog.find(version)
        if current and not replace:
            raise AdminError(409, f"版本 {version} 已经登记（sha256 "
                                  f"{(current['sha256'] or '?')[:12]}…）。"
                                  f"确认要覆盖请勾选「覆盖同版本」。",
                             version=version,
                             sha256=current["sha256"], file=current["file"])
        if existing_file and token:
            raise AdminError(400, "上传文件和已有文件只能选一种")

        if token:
            target = self.catalog.allocate(version, name, tail)
            self.uploads.take(token, target)
        else:
            target = self.catalog.resolve_existing(existing_file)
            if target is None:
                raise AdminError(400, f"files/ 目录里找不到：{existing_file}")

        digest = sha256_of(target)
        if current and current["sha256"] and current["sha256"] != digest:
            log.warning("版本 %s 被覆盖：sha256 %s… → %s…", version,
                        current["sha256"][:12], digest[:12])
        relative = target.relative_to(self.catalog.root).as_posix()
        entry = {
            "version": version,
            "file": relative,
            "notes": notes,
            "mandatory": mandatory,
            "released_at": str(body.get("released_at") or "").strip() or today(),
            "size": target.stat().st_size,
            "sha256": digest,
        }
        result = self.catalog.upsert(entry, make_latest=make_latest,
                                     explicit_latest=str(
                                         body.get("set_latest_version") or "").strip())
        self.log_event(handler, user, "release",
                       f"登记 {version}（{human_size(entry['size'])}，"
                       f"{'最新' if result['is_latest'] else '非最新'}）")
        handler.json({"ok": True, "release": result,
                      "latest": (self.catalog.latest() or {}).get("version", ""),
                      "releases": self.catalog.admin_records()})

    def patch_release(self, handler, user: str, version: str) -> None:
        body = handler.body_json()
        fields: dict[str, Any] = {}
        if "notes" in body:
            fields["notes"] = str(body.get("notes") or "").strip()[:2000]
        if "mandatory" in body:
            fields["mandatory"] = bool(body.get("mandatory"))
        if "released_at" in body:
            stamp = str(body.get("released_at") or "").strip()
            if stamp and not re.match(r"^\d{4}-\d{2}-\d{2}$", stamp):
                raise AdminError(400, "发布日期要用 2026-11-05 这种格式")
            fields["released_at"] = stamp
        want_latest = body.get("latest")
        target = self.catalog.patch_version(version, fields,
                                            set_latest=None if want_latest is None
                                            else bool(want_latest))
        self.log_event(handler, user, "release-edit",
                       f"修改 {version}：{'、'.join(fields) or ('最新' if want_latest else '状态')}")
        handler.json({"ok": True, "release": target,
                      "latest": (self.catalog.latest() or {}).get("version", ""),
                      "releases": self.catalog.admin_records()})

    def delete_release(self, handler, user: str, version: str) -> None:
        body = handler.body_json(optional=True)
        remove_file = bool(body.get("delete_file"))
        result = self.catalog.remove(version, delete_file=remove_file)
        detail = f"删除 {version}"
        if remove_file and result.get("file_removed"):
            detail += f"（同时删除 {result['file_removed']}）"
        self.log_event(handler, user, "release-delete", detail)
        handler.json({"ok": True, "removed": result,
                      "latest": self.catalog.latest()["version"]
                      if self.catalog.latest() else "",
                      "releases": self.catalog.admin_records()})

