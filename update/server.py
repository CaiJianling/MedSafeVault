"""MedSafeVault 更新服务：客户端更新接口 + HeroUI 管理后台，一个端口全搞定。

只用标准库，Linux / Windows 都能直接跑（Python 3.11+，无需 pip 安装任何依赖）：

    python3 update/server.py                       # 监听 0.0.0.0:8000
    python3 update/server.py --port 8080 --host 127.0.0.1
    python3 update/server.py --config update/versions.json --root update
    python3 update/server.py --username admin --password '改成你自己的'
    python3 update/server.py --set-password        # 重置管理后台口令后退出
    python update/server.py --throttle 3000000     # 限速 3 MB/s，模拟慢速链路看进度条

打开 `http://<服务器IP>:8000/` 就是管理页面（源码在 `update/web`，构建产物
`update/web/dist` 已随目录发布，服务器上不需要 Node）：登录 → 上传 exe → 填
版本号登记 → 页面里给出「应用设置里要填的更新服务地址」。版本与文件位置仍然
写在同目录的 `versions.json` 里（命令行登记见 `update/make_release.py`）：

    {
      "latest": "2.1.0",
      "releases": [
        {
          "version": "2.1.0",
          "file": "files/MedSafeVault-2.1.0.exe",
          "notes": "修复列表首行提示被表头遮挡",
          "mandatory": false,
          "released_at": "2026-11-04",
          "size": 28227388,
          "sha256": "…"
        }
      ]
    }

`file` 是相对本服务目录（`--root`，默认为本文件所在目录）的路径；服务只会
发送 versions.json 中登记过的文件，因此不存在目录穿越。`size` 与 `sha256`
可以省略，服务会按磁盘上的文件自动补齐（客户端仍然会自己校验）。

接口：

    GET  /                        管理页面（HeroUI v3，构建好的静态站）
    GET  /healthz                 服务概览（不含路径等内部信息）
    GET  /api/info                服务名、监听端口、建议填到设置里的地址
    GET  /api/version?current=2.0.0  最新版、是否有更新、下载信息
    GET  /api/releases            全部已登记版本
    GET  /download/<version>      下载该版本（支持单段 Range，可断点续传）

    POST /api/admin/login         {"username","password"} → 会话 Cookie
    POST /api/admin/logout
    GET  /api/admin/session       当前登录者 + 服务详情（含 versions.json 路径）
    GET  /api/admin/releases      管理视图（含磁盘路径、是否存在、是否最新）
    GET  /api/admin/files         files/ 目录里还没登记的文件
    POST /api/admin/upload        请求体直接是文件字节 → 暂存，返回 upload token
    POST /api/admin/releases      用 upload token（或已有文件）登记一个版本
    PATCH  /api/admin/releases/<version>   改说明 / 必须更新 / 设为最新
    DELETE /api/admin/releases/<version>   下架，可顺带删文件
    POST /api/admin/password      修改登录口令
    GET  /api/admin/audit         最近的登录与发布记录（内存里，重启清空）

登录凭据保存在 `update/admin.json`（只存 PBKDF2-SHA256 散列，不入库）；客户端
接口 /api/version 与 /download 不需要登录，因为每次启动都要访问。

版本号比较与 `backend/updater.py` 中的实现保持一致（同样的 4 段数字），
`tools/test_updater.py` 会同时导入两边并断言结果一致。
"""
from __future__ import annotations

import argparse
import getpass
import json
import logging
import os
import re
import secrets
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import admin as admin_lib  # noqa: E402
from common import (SHA_RE, VERSION_RE, AdminError, human_size, is_newer,  # noqa: E402
                    parse_version, read_json, sha256_of, today,
                    version_or_zero, write_json_atomic)

log = logging.getLogger("msv-update")

CHUNK = 256 * 1024
DEFAULT_CONFIG_NAME = "versions.json"
EMPTY_CONFIG = {"_readme": "MedSafeVault 更新服务版本表；releases 按版本从新到旧排列",
                "latest": "", "releases": []}

__all__ = ["Catalog", "Handler", "build_server", "main",
           "parse_version", "is_newer", "version_or_zero", "sha256_of"]


class Catalog:
    """versions.json plus the files it points at, re-read when it changes."""

    def __init__(self, root: Path, config: Path | None = None) -> None:
        self.root = root.resolve()
        self.config = (config or self.root / DEFAULT_CONFIG_NAME).resolve()
        self._lock = threading.RLock()
        self._stamp: tuple[float, int] | None = None
        self._releases: list[dict] = []
        self._declared_latest: str = ""
        self._digests: dict[str, tuple[str, int]] = {}

    # ------------------------------------------------------------------ config
    def _refresh(self) -> None:
        try:
            stat = self.config.stat()
        except OSError:
            if self._stamp is not None:
                log.warning("config disappeared: %s", self.config)
                self._releases, self._declared_latest, self._stamp = [], "", None
            return
        stamp = (stat.st_mtime, stat.st_size)
        if stamp == self._stamp:
            return
        try:
            payload = json.loads(self.config.read_text(encoding="utf-8"))
        except Exception as exc:
            log.error("配置文件解析失败：%s", exc)
            self._releases, self._declared_latest, self._stamp = [], "", stamp
            return
        releases = []
        for item in payload.get("releases") or []:
            if not isinstance(item, dict):
                continue
            version = str(item.get("version") or "").strip()
            try:
                parse_version(version)
            except ValueError:
                log.warning("忽略非法版本条目：%r", version)
                continue
            releases.append({
                "version": version,
                "file": str(item.get("file") or ""),
                "notes": str(item.get("notes") or ""),
                "mandatory": bool(item.get("mandatory")),
                "released_at": str(item.get("released_at") or ""),
                "size": int(item.get("size") or 0),
                "sha256": str(item.get("sha256") or "").lower(),
            })
        releases.sort(key=lambda r: parse_version(r["version"]), reverse=True)
        self._releases = releases
        self._declared_latest = str(payload.get("latest") or "").strip()
        self._stamp = stamp
        log.info("已加载 %s（%d 个版本）", self.config.name, len(releases))

    def _usable(self) -> list[dict]:
        """Registered releases whose file is actually on disk."""
        out = []
        for release in self._releases:
            path = self._resolve(release["file"])
            if path and path.is_file():
                out.append(release)
            else:
                log.warning("版本 %s 的文件缺失：%s", release["version"], release["file"])
        return out

    def _resolve(self, relative: str) -> Path | None:
        """Map a config path into the served root, refusing anything outside."""
        if not relative:
            return None
        candidate = Path(relative)
        if not candidate.is_absolute():
            candidate = self.root / candidate
        try:
            resolved = candidate.resolve()
        except OSError:
            return None
        try:
            resolved.relative_to(self.root)
        except ValueError:
            log.warning("拒绝服务根目录之外的文件：%s", resolved)
            return None
        return resolved

    # ------------------------------------------------------------------ lookups
    def latest(self) -> dict | None:
        with self._lock:
            self._refresh()
            usable = self._usable()
            if not usable:
                return None
            declared = next(
                (r for r in usable if r["version"] == self._declared_latest), None)
            return declared or usable[0]

    def find(self, version: str) -> dict | None:
        with self._lock:
            self._refresh()
            return next((r for r in self._releases if r["version"] == version), None)

    def all_releases(self) -> list[dict]:
        with self._lock:
            self._refresh()
            return list(self._releases)

    def path_for(self, release: dict) -> Path | None:
        return self._resolve(release.get("file") or "")

    def public(self, release: dict) -> dict:
        """The JSON view of a release, with size/sha256 filled in."""
        path = self._resolve(release["file"])
        size = release["size"]
        sha = release["sha256"]
        if path and path.is_file() and (not size or not SHA_RE.match(sha or "")):
            digest, length = self._digest(release["version"], path)
            size = size or length
            sha = sha if SHA_RE.match(sha or "") else digest
        return {
            "version": release["version"],
            "notes": release["notes"],
            "mandatory": release["mandatory"],
            "released_at": release["released_at"],
            "size": int(size or 0),
            "sha256": sha,
            "download": f"/download/{release['version']}",
            "filename": (path.name if path else f"MedSafeVault-{release['version']}.exe"),
        }

    def _digest(self, version: str, path: Path) -> tuple[str, int]:
        stat = path.stat()
        key = f"{version}:{path.name}:{stat.st_mtime_ns}:{stat.st_size}"
        cached = self._digests.get(key)
        if cached:
            return cached
        value = (sha256_of(path), stat.st_size)
        if len(self._digests) > 32:  # 每个版本算一次就够，缓存不能无限长
            self._digests.clear()
        self._digests[key] = value
        return value

    def version_payload(self, current: str) -> dict:
        latest = self.latest()
        if not latest:
            return {
                "ok": True,
                "latest": "",
                "current": current,
                "has_update": False,
                "update": None,
                "message": "没有可提供的版本，请先在 versions.json 中登记",
            }
        public = self.public(latest)
        available = is_newer(latest["version"], current) if current else True
        return {
            "ok": True,
            "latest": latest["version"],
            "current": current,
            "has_update": bool(available),
            "update": public,
            "releases": [self.public(r) for r in self._releases],
        }

    # ------------------------------------------------------------------ writes
    # 下面几个方法只被管理后台和 make_release.py 调用；一律在 _lock 里读原文件、
    # 改内容、原子写回，再把缓存作废，保证 HTTP 并发时不会写出半个 versions.json。

    def _raw(self) -> dict:
        """versions.json 的原始内容（保留 _readme 等自定义键），坏文件退回空表。"""
        try:
            payload = read_json(self.config, None)
        except Exception as exc:
            log.error("配置文件读取失败，将按空表处理：%s", exc)
            payload = None
        if not isinstance(payload, dict) or not isinstance(payload.get("releases"), list):
            payload = dict(EMPTY_CONFIG)
        payload.setdefault("latest", "")
        return payload

    @staticmethod
    def _entry(item: dict) -> dict:
        """Normalize one release record, keeping any extra keys the operator added."""
        base = {
            "version": str(item.get("version") or "").strip(),
            "file": str(item.get("file") or "").replace("\\", "/").lstrip("/"),
            "notes": str(item.get("notes") or ""),
            "mandatory": bool(item.get("mandatory")),
            "released_at": str(item.get("released_at") or ""),
            "size": int(item.get("size") or 0),
            "sha256": str(item.get("sha256") or "").lower(),
        }
        return {**item, **base}

    def _save(self, payload: dict) -> None:
        releases = [self._entry(r) for r in payload.get("releases") or []
                    if isinstance(r, dict) and str(r.get("version") or "").strip()]
        releases.sort(key=lambda r: version_or_zero(r["version"]), reverse=True)
        payload["releases"] = releases
        declared = str(payload.get("latest") or "").strip()
        if declared and not any(r["version"] == declared for r in releases):
            declared = releases[0]["version"] if releases else ""
        payload["latest"] = declared
        write_json_atomic(self.config, payload)
        with self._lock:
            self._stamp = None
            self._refresh()

    def declared_latest(self) -> str:
        with self._lock:
            self._refresh()
            return self._declared_latest

    def resolve_existing(self, relative: str) -> Path | None:
        """管理页面选择「files/ 里已有文件」时的校验：必须在 files/ 下且真的存在。"""
        path = self._resolve(relative)
        if not path or not path.is_file():
            return None
        folder = (self.root / "files").resolve()
        if folder != path.parent and folder not in path.parents:
            log.warning("拒绝登记 files/ 之外的文件：%s", path)
            return None
        return path

    def allocate(self, version: str, name: str, suffix: str = ".exe") -> Path:
        """为新版本挑一个不撞车的落盘文件名（同版本覆盖，不同版本加版本后缀）。"""
        files = self.root / "files"
        files.mkdir(parents=True, exist_ok=True)
        wanted = Path(str(name or "").strip() or f"MedSafeVault-{version}{suffix}")
        stem = wanted.stem or f"MedSafeVault-{version}"
        tail = wanted.suffix.lower() or suffix.lower() or ".exe"
        with self._lock:
            self._refresh()
            owners = {r["file"]: r["version"] for r in self._releases}
            index = 0
            while True:
                candidate_name = (f"{stem}{tail}" if index == 0 else
                                  f"{stem}-{version}{tail}" if index == 1 else
                                  f"{stem}-{version}-{index}{tail}")
                path = files / candidate_name
                owner = owners.get(f"files/{candidate_name}")
                if owner in (None, version) and not path.exists():
                    return path
                if owner == version:
                    return path
                index += 1
                if index > 40:  # 理论上到不了，防止名字算不出来时死循环
                    raise AdminError(400, f"无法为版本 {version} 安排文件名")

    def upsert(self, entry: dict, make_latest: bool = True,
               explicit_latest: str = "") -> dict:
        with self._lock:
            payload = self._raw()
            releases = [r for r in payload["releases"] if isinstance(r, dict)
                        and str(r.get("version") or "").strip() != entry["version"]]
            releases.append(entry)
            payload["releases"] = releases
            declared = str(payload.get("latest") or "")
            if explicit_latest:
                payload["latest"] = explicit_latest
            elif make_latest:
                payload["latest"] = entry["version"]
            else:
                payload["latest"] = declared or entry["version"]
            self._save(payload)
            return self.admin_record(self.find(entry["version"]))

    def patch_version(self, version: str, fields: dict,
                      set_latest: bool | None = None) -> dict:
        with self._lock:
            if not self.find(version):
                raise AdminError(404, f"没有登记的版本：{version}")
            payload = self._raw()
            for item in payload["releases"]:
                if isinstance(item, dict) and str(item.get("version") or "") == version:
                    item.update({k: v for k, v in fields.items() if v is not None})
            if set_latest:
                payload["latest"] = version
            self._save(payload)
            return self.admin_record(self.find(version))

    def remove(self, version: str, delete_file: bool = False) -> dict:
        with self._lock:
            record = self.find(version)
            if not record:
                raise AdminError(404, f"没有登记的版本：{version}")
            payload = self._raw()
            payload["releases"] = [r for r in payload["releases"]
                                   if not (isinstance(r, dict)
                                           and str(r.get("version") or "") == version)]
            if str(payload.get("latest") or "") == version:
                payload["latest"] = ""
            self._save(payload)
            removed = ""
            path = self._resolve(record["file"])
            if delete_file and path and path.is_file():
                try:
                    path.unlink()
                    removed = record["file"]
                    self._digests.clear()
                except OSError as exc:
                    log.warning("版本 %s 已下架，但文件删除失败：%s", version, exc)
            return {
                "version": version,
                "file": record["file"],
                "file_removed": removed,
                "releases": len(self._releases),
            }

    def admin_record(self, release: dict) -> dict:
        """管理视图：公开字段 + 磁盘真相（是否存在、大小和散列是否对得上）。"""
        path = self._resolve(release["file"])
        exists = bool(path and path.is_file())
        on_disk_size = path.stat().st_size if exists else 0
        disk_sha, disk_size = self._digest(release["version"], path) if exists else ("", 0)
        latest = self.latest()
        return {
            **self.public(release),
            "file": release["file"],
            "path": str(path) if path else "",
            "exists": exists,
            "size_on_disk": on_disk_size,
            "size_text": human_size(on_disk_size),
            "recorded_size": release["size"],
            "recorded_sha256": release["sha256"],
            "size_matches": bool(not release["size"] or release["size"] == on_disk_size),
            "hash_matches": bool(not release["sha256"]
                                 or release["sha256"] == disk_sha),
            "is_latest": bool(latest and latest["version"] == release["version"]),
        }

    def admin_records(self) -> list[dict]:
        with self._lock:
            self._refresh()
            return [self.admin_record(r) for r in self._releases]

    def disk_files(self) -> list[dict]:
        """files/ 目录里已经存在的文件，用于「不重复上传、直接登记」那一档。"""
        with self._lock:
            self._refresh()
            owners: dict[str, list[str]] = {}
            for release in self._releases:
                owners.setdefault(release["file"], []).append(release["version"])
        folder = self.root / "files"
        out: list[dict] = []
        if not folder.is_dir():
            return out
        for path in sorted(folder.glob("*"), key=lambda p: p.name.lower()):
            if not path.is_file() or path.name.startswith("."):
                continue
            relative = f"files/{path.name}"
            try:
                size = path.stat().st_size
            except OSError:
                continue
            out.append({
                "file": relative,
                "name": path.name,
                "suffix": path.suffix.lower(),
                "size": size,
                "size_text": human_size(size),
                "registered": relative in owners,
                "registered_for": owners.get(relative, []),
            })
        return out


class Handler(BaseHTTPRequestHandler):
    server_version = "MedSafeVaultUpdate/1"
    protocol_version = "HTTP/1.1"
    catalog: Catalog
    admin: admin_lib.AdminApi | None = None
    site: admin_lib.StaticSite | None = None
    service_name = "MedSafeVault 更新服务"
    throttle = 0  # bytes per second; 0 = as fast as the link allows

    # ------------------------------------------------------------------ plumbing
    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        log.info("%s %s", self.address_string(), fmt % args)

    def _send(self, status: int, body: bytes, content_type: str,
              extra: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        # Cookie 只能在 send_response 之后写，所以先攒着，在这里一起发出去。
        for value in getattr(self, "_cookies", []):
            self.send_header("Set-Cookie", value)
        self._cookies = []
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def json(self, payload: dict, status: int = 200) -> None:
        self._send(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    def error(self, status: int, message: str, **extra: Any) -> None:
        self.json({"ok": False, "error": message, **extra}, status)

    _json = json
    _error = error

    def remote_ip(self) -> str:
        try:
            return str(self.client_address[0])
        except Exception:
            return ""

    def cookie(self, name: str) -> str | None:
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        try:
            jar = SimpleCookie()
            jar.load(raw)
        except Exception:
            return None
        morsel = jar.get(name)
        return morsel.value if morsel else None

    def set_cookie(self, name: str, value: str, expires_at: float) -> None:
        max_age = max(0, int(expires_at - time.time()))
        self._cookies.append(
            f"{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}")

    def clear_cookie(self, name: str) -> None:
        self._cookies.append(f"{name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")

    @staticmethod
    def query_text(query: dict, key: str, default: str = "") -> str:
        return str((query.get(key) or [default])[0]).strip() or default

    # --------------------------------------------------------------- request body
    def body_json(self, limit: int = 256 * 1024, optional: bool = False) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            self._body_done = True
            if optional:
                return {}
            raise AdminError(400, "请求体为空")
        if length > limit:
            self.drain_body()
            raise AdminError(413, f"请求体超过 {human_size(limit)}")
        raw = self.rfile.read(length)
        self._body_done = True
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except Exception as exc:
            raise AdminError(400, f"请求体不是合法 JSON：{exc}") from exc
        if not isinstance(payload, dict):
            raise AdminError(400, "请求体要是一个 JSON 对象")
        return payload

    def drain_body(self) -> None:
        """HTTP/1.1 是长连接：错误分支也必须把请求体读完，否则下一条请求会错位。"""
        if getattr(self, "_body_done", False):
            return
        length = int(self.headers.get("Content-Length") or 0)
        remaining = min(length, 4 * 1024 * 1024)
        try:
            while remaining > 0:
                block = self.rfile.read(min(64 * 1024, remaining))
                if not block:
                    break
                remaining -= len(block)
        except Exception:
            pass
        self._body_done = True

    # ------------------------------------------------------------------- routes
    def do_GET(self) -> None:  # noqa: N802
        self.dispatch("GET")

    def do_HEAD(self) -> None:  # noqa: N802
        self.dispatch("HEAD")

    def do_POST(self) -> None:  # noqa: N802
        self.dispatch("POST")

    def do_PATCH(self) -> None:  # noqa: N802
        self.dispatch("PATCH")

    def do_PUT(self) -> None:  # noqa: N802
        self.dispatch("PUT")

    def do_DELETE(self) -> None:  # noqa: N802
        self.dispatch("DELETE")

    def dispatch(self, method: str) -> None:
        self._body_done = False
        self._cookies: list[str] = []
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)
        try:
            if self.admin and self.admin.handle(self, method, path, query):
                return
            if method in ("GET", "HEAD"):
                self.route_get(path, query)
                return
            if path.startswith("/api/"):
                self.drain_body()
                self.error(405, f"这个接口不支持 {method}")
            else:
                self.error(405, "不支持的请求方法")
        except AdminError as exc:
            self.drain_body()
            self.json({"ok": False, "error": exc.message, **exc.extra}, exc.status)
        except (BrokenPipeError, ConnectionResetError):
            log.info("连接被对端关闭：%s %s", method, path)
        except Exception as exc:  # 不把堆栈写给客户端，只留一句能看的话
            log.exception("请求失败：%s %s", method, path)
            self.drain_body()
            self.error(500, f"服务内部错误：{exc}")

    def route_get(self, path: str, query: dict) -> None:
        if path == "/healthz":
            latest = self.catalog.latest()
            self.json({
                "ok": True,
                "service": self.service_name,
                "time": time.strftime("%Y-%m-%d %H:%M:%S"),
                "latest": latest["version"] if latest else "",
                "releases": len(self.catalog.all_releases()),
                "admin_page": bool(self.site and self.site.ready),
            })
            return
        if path == "/api/info":
            if self.admin:
                self.json(self.admin.public_info(self))
            else:
                self.json({"ok": True, "service": self.service_name,
                           "latest": (self.catalog.latest() or {}).get("version", "")})
            return
        if path == "/api/version":
            current = self.query_text(query, "current")
            try:
                if current:
                    parse_version(current)
            except ValueError:
                self.error(400, "current 参数不是合法版本号")
                return
            self.json(self.catalog.version_payload(current))
            return
        if path == "/api/releases":
            self.json({"ok": True, "releases": [
                self.catalog.public(r) for r in self.catalog.all_releases()]})
            return
        if path.startswith("/download/"):
            self._send_file(path[len("/download/"):])
            return
        if path.startswith("/api/"):
            self.error(404, "接口不存在")
            return
        if self.site:
            if path in ("/", "/index.html") and not self.site.ready:
                self.json({
                    "ok": True,
                    "service": self.service_name,
                    "endpoints": ["/healthz", "/api/version", "/api/releases",
                                  "/download/<version>"],
                    "admin_page": False,
                    "message": "管理页面还没构建：在开发机上执行 "
                               "cd update/web && npm run build，生成 web/dist 后再刷新。",
                })
                return
            if self.site.serve(self, path):
                return
        elif path in ("/", "/index.html"):
            self.json({
                "ok": True,
                "service": self.service_name,
                "endpoints": ["/healthz", "/api/version", "/api/releases",
                              "/download/<version>"],
            })
            return
        self.error(404, "接口不存在")

    def _send_file(self, version: str) -> None:
        version = urllib.parse.unquote(version).strip("/")
        release = self.catalog.find(version)
        if not release:
            self.error(404, f"未登记的版本：{version}")
            return
        path = self.catalog.path_for(release)
        if not path or not path.is_file():
            self.error(404, f"文件不存在：{release['file']}")
            return
        size = path.stat().st_size
        start, end = 0, size - 1
        status = 200
        header = self.headers.get("Range")
        if header:
            match = re.match(r"bytes=(\d*)-(\d*)$", header.strip())
            if not match:
                self.error(416, "只支持单段 bytes Range")
                return
            low, high = match.groups()
            start = int(low) if low else 0
            end = int(high) if high else size - 1
            if start > end or start >= size or end >= size:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            status = 206
        length = end - start + 1
        public = self.catalog.public(release)
        self.send_response(status)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        self.send_header(
            "Content-Disposition",
            f'attachment; filename="{public["filename"]}"')
        self.send_header("X-Sha256", public["sha256"] or "")
        self.send_header("X-Msv-Version", release["version"])
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if self.command == "HEAD":
            return
        remaining = length
        try:
            with open(path, "rb") as fh:
                fh.seek(start)
                while remaining > 0:
                    block = fh.read(min(CHUNK, remaining))
                    if not block:
                        break
                    self.wfile.write(block)
                    remaining -= len(block)
                    if self.throttle:
                        # --throttle simulates a slow ward link so the client's
                        # progress bar and resume behaviour can be watched.
                        time.sleep(len(block) / self.throttle)
        except (BrokenPipeError, ConnectionResetError):
            log.info("下载中断：%s（已发 %d/%d 字节）", version, length - remaining, length)


def build_server(host: str, port: int, catalog: Catalog, throttle: int = 0,
                 admin: admin_lib.AdminApi | None = None,
                 site: admin_lib.StaticSite | None = None,
                 service_name: str = "MedSafeVault 更新服务") -> ThreadingHTTPServer:
    handler = type("BoundHandler", (Handler,), {
        "catalog": catalog,
        "throttle": throttle,
        "admin": admin,
        "site": site,
        "service_name": service_name,
    })

    class Server(ThreadingHTTPServer):
        daemon_threads = True
        # Windows 上开了 SO_REUSEADDR 会出现「两个实例都监听同一端口，老的那个还在收包」，
        # 改完代码重启时特别容易踩到；Linux 保留复用，方便重启不被 TIME_WAIT 卡住。
        allow_reuse_address = os.name != "nt"

    httpd = Server((host, port), handler)
    httpd.msv_host = host  # type: ignore[attr-defined]  # /api/info 用它拼建议地址
    return httpd


def new_password() -> str:
    """随机初始口令：分成三组，好抄到纸上，也够长。"""
    raw = secrets.token_hex(9)
    return "-".join(raw[i:i + 6] for i in (0, 6, 12))


def build_admin(catalog: Catalog, *, dist: Path, credentials: Path, username: str,
                password: str, session_hours: float, max_upload: int,
                service_name: str,
                app_version: str = "") -> tuple[admin_lib.AdminApi, admin_lib.StaticSite, dict]:
    """准备好登录凭据、会话表、上传暂存区和静态页面；返回 (api, site, 首次生成的口令)。"""
    creds = admin_lib.Credentials(credentials)
    created: dict = {}
    if not creds.configured:
        user = (username or os.environ.get("MSV_UPDATE_USERNAME") or "admin").strip()
        secret = password or (os.environ.get("MSV_UPDATE_PASSWORD") or "").strip()
        generated = not secret
        secret = secret or new_password()
        creds.create(user, secret, default=generated)
        created = {"username": user, "password": secret, "generated": generated}
        log.info("已创建管理后台账号 %s（凭据写入 %s）", user, creds.path.name)

    staging = catalog.root / "files" / ".uploads"
    uploads = admin_lib.UploadStore(staging, max_bytes=max_upload)
    uploads.start()
    api = admin_lib.AdminApi(
        catalog, creds,
        admin_lib.Sessions(ttl_hours=session_hours),
        uploads, service=service_name, app_version=app_version)
    site = admin_lib.StaticSite(dist)
    return api, site, created


def setup_password(root: Path, credentials: Path, username: str,
                   password: str) -> int:
    """--set-password：改掉管理后台口令后退出（忘记口令就用它）。"""
    creds = admin_lib.Credentials(credentials)
    chosen = password
    if not chosen:
        if not sys.stdin or not sys.stdin.isatty():
            print("请用 --password 提供新口令，或在交互终端里运行本命令")
            return 2
        first = getpass.getpass("新口令（至少 8 位）：")
        second = getpass.getpass("再输一遍：")
        if first != second:
            print("两次输入不一致")
            return 2
        chosen = first
    try:
        result = creds.reset_password(username, chosen)
    except Exception as exc:
        print(f"改口令失败：{exc}")
        return 2
    print(f"已设置管理后台账号：{result['username']}（{creds.path}）")
    print("服务若正在运行，请重启以让新口令生效。")
    return 0


def read_app_version(root: Path) -> str:
    """从 backend/__init__.py 里读版本号，只为页面标题栏好看；读不到就算了。"""
    try:
        text = (root.parent / "backend" / "__init__.py").read_text(encoding="utf-8")
    except OSError:
        return ""
    match = re.search(r'^__version__\s*=\s*["\']([^"\']+)["\']', text, re.M)
    return match.group(1) if match else ""


def banner(host: str, port: int, catalog: Catalog, site: admin_lib.StaticSite | None,
           created: dict, app_version: str, root: Path) -> None:
    latest = catalog.latest()
    show = "0.0.0.0" if host in ("0.0.0.0", "::", "") else host
    ready = bool(site and site.ready)
    print(f"MedSafeVault 更新服务 {app_version and f'({app_version}) ' or ''}")
    if site:
        print(f"  管理页面    http://{show}:{port}/"
              f"{'' if ready else '   ← 还没构建 update/web/dist'}")
    print(f"  更新接口    http://{show}:{port}/api/version")
    print(f"  文件根目录  {root}")
    print(f"  当前最新    {latest['version'] if latest else '（还没有登记版本）'}")
    addresses = admin_lib.lan_addresses(port)
    if addresses:
        print("  应用「设置 → 关于 → 更新服务地址」里可以填：")
        for value in addresses:
            print(f"      http://{value}:{port}/")
    else:
        print(f"  应用里填的地址：http://<这台机器的内网IP>:{port}/")
    if site and not ready:
        print("  提示：管理页面未构建（开发机上 cd update/web && npm install && npm run build），"
              "更新接口不受影响。")
    if created:
        print("")
        print(f"  首次启动已创建管理员账号：{created['username']} / {created['password']}")
        if created.get("generated"):
            print("  （随机生成的初始口令，请登录后在「账号」里改掉，或用 --set-password 重设）")
        print(f"  凭据文件：{root / 'admin.json'}（只存 PBKDF2 散列，不要提交到版本库）")
    print("  Ctrl+C 停止")


def main(argv: list[str] | None = None) -> int:
    default_root = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="MedSafeVault 更新服务（更新接口 + 管理后台）")
    parser.add_argument("--host", default="0.0.0.0", help="监听地址，默认 0.0.0.0")
    parser.add_argument("--port", type=int, default=8000, help="监听端口，默认 8000")
    parser.add_argument("--root", default=str(default_root),
                        help="文件根目录，默认为本脚本所在目录")
    parser.add_argument("--config", default="",
                        help="versions.json 路径，默认为 <root>/versions.json")
    parser.add_argument("--verbose", action="store_true", help="输出调试日志")
    parser.add_argument("--throttle", type=int, default=0,
                        help="限速字节/秒，模拟慢速内网链路（0 = 不限速）")
    parser.add_argument("--username", default="", help="首次启动时创建的管理员账号，默认 admin")
    parser.add_argument("--password", default="",
                        help="首次启动时的管理员口令；不给就随机生成并打印（也可用环境变量 "
                             "MSV_UPDATE_PASSWORD）")
    parser.add_argument("--credentials", default="",
                        help="凭据文件路径，默认为 <root>/admin.json")
    parser.add_argument("--dist", default="",
                        help="管理页面目录，默认为 <root>/web/dist")
    parser.add_argument("--session-hours", type=float, default=8.0,
                        help="登录后免重复输入的小时数，默认 8")
    parser.add_argument("--max-upload", type=int, default=500,
                        help="允许上传的单个文件上限（MB），默认 500")
    parser.add_argument("--no-admin", action="store_true",
                        help="只提供更新接口，不启用管理后台（等价于旧版只读服务）")
    parser.add_argument("--set-password", action="store_true",
                        help="只重置管理后台口令，然后退出")
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"根目录不存在：{root}")
        return 2
    credentials = Path(args.credentials).resolve() if args.credentials else root / "admin.json"
    dist = Path(args.dist).resolve() if args.dist else default_root / "web" / "dist"
    if args.set_password:
        return setup_password(root, credentials,
                              args.username or os.environ.get("MSV_UPDATE_USERNAME", ""),
                              args.password)
    config = Path(args.config).resolve() if args.config else root / DEFAULT_CONFIG_NAME
    if not config.exists():
        log.warning("配置文件不存在，第一次登记版本时会自动创建：%s", config)
    catalog = Catalog(root, config)
    app_version = read_app_version(root)
    admin_api: admin_lib.AdminApi | None = None
    site: admin_lib.StaticSite | None = admin_lib.StaticSite(dist)
    created: dict = {}
    if args.no_admin:
        site = None
    else:
        admin_api, site, created = build_admin(
            catalog, dist=dist, credentials=credentials,
            username=args.username, password=args.password,
            session_hours=args.session_hours,
            max_upload=max(1, args.max_upload) * 1024 * 1024,
            service_name="MedSafeVault 更新服务", app_version=app_version)
    try:
        httpd = build_server(args.host, args.port, catalog, throttle=args.throttle,
                             admin=admin_api, site=site)
    except OSError as exc:
        print(f"监听失败 {args.host}:{args.port} → {exc}")
        return 1
    banner(args.host, args.port, catalog, site, created, app_version, root)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("已停止")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
