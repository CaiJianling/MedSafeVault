"""Built-in terminal sessions: SSH, FTP/SFTP and VNC.

Everything here is memory-only and dies with the vault: locking the vault
closes every session, and no credential is ever written to disk. The front-end
polls ``read`` for terminal output; a byte cursor keeps that idempotent.
"""
from __future__ import annotations

import logging
import os
import posixpath
import socket
import threading
import time
import uuid
from typing import Any

from .store import VaultError

log = logging.getLogger(__name__)

MAX_BUFFER = 1_500_000
SSH_CONNECT_TIMEOUT = 10


# --------------------------------------------------------------------- base
class _Session:
    kind = "session"

    def __init__(self, title: str, protocol: str = "") -> None:
        self.id = uuid.uuid4().hex[:12]
        self.title = title
        self.protocol = protocol
        self.created_at = time.time()
        self.error = ""

    def info(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "protocol": self.protocol,
            "title": self.title,
            "error": self.error,
        }

    def close(self) -> None:  # pragma: no cover - overridden
        pass


def _friendly(exc: Exception, what: str = "连接") -> VaultError:
    """Turn socket/auth exceptions into short, actionable Chinese prose."""
    text = str(exc) or exc.__class__.__name__
    lowered = text.lower()
    if isinstance(exc, socket.timeout) or "timed out" in lowered:
        return VaultError(f"{what}超时，请检查地址、端口与网络")
    if isinstance(exc, socket.gaierror) or "name or service not known" in lowered:
        return VaultError("无法解析主机地址")
    if isinstance(exc, ConnectionRefusedError) or "refused" in lowered:
        return VaultError("目标主机拒绝连接，请确认服务已启动")
    if isinstance(exc, (ConnectionResetError, ConnectionAbortedError)):
        return VaultError(f"{what}被目标主机断开")
    return VaultError(f"{what}失败：{text}")


# ---------------------------------------------------------------------- ssh
class SshSession(_Session):
    kind = "ssh"

    def __init__(
        self,
        host: str,
        port: int,
        username: str,
        password: str,
        title: str,
        cols: int = 100,
        rows: int = 30,
    ) -> None:
        super().__init__(title, "ssh")
        try:
            import paramiko
        except ImportError as exc:  # pragma: no cover - packaging guard
            raise VaultError("内置终端缺少 SSH 组件，请重新安装程序") from exc

        client = paramiko.SSHClient()
        # Convenience over strict pinning: a hospital technician connecting to
        # the same jump hosts every day should not be blocked by a changed key.
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(
                hostname=host,
                port=port,
                username=username or None,
                password=password or None,
                timeout=SSH_CONNECT_TIMEOUT,
                banner_timeout=SSH_CONNECT_TIMEOUT,
                auth_timeout=SSH_CONNECT_TIMEOUT,
                allow_agent=False,
                look_for_keys=False,
            )
        except paramiko.AuthenticationException as exc:
            client.close()
            raise VaultError("SSH 用户名或密码不正确") from exc
        except Exception as exc:
            client.close()
            raise _friendly(exc, "SSH 连接") from exc

        try:
            channel = client.invoke_shell(term="xterm-256color", width=cols, height=rows)
            channel.settimeout(0.2)
        except Exception as exc:
            client.close()
            raise _friendly(exc, "SSH 会话") from exc

        self._client = client
        self._channel = channel
        self._buffer = bytearray()
        self._base = 0
        self._closed = False
        self._lock = threading.Lock()
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()

    def _append(self, data: bytes) -> None:
        with self._lock:
            self._buffer.extend(data)
            if len(self._buffer) > MAX_BUFFER:
                drop = len(self._buffer) - MAX_BUFFER
                del self._buffer[:drop]
                self._base += drop

    def _read_loop(self) -> None:
        while True:
            try:
                data = self._channel.recv(16384)
            except socket.timeout:
                if self._closed:
                    break
                continue
            except Exception as exc:
                with self._lock:
                    self._closed = True
                    self.error = str(exc) or "SSH 会话已断开"
                break
            if not data:
                with self._lock:
                    self._closed = True
                break
            self._append(data)

    def read(self, cursor: int) -> dict:
        with self._lock:
            start = 0
            if isinstance(cursor, int) and cursor > self._base:
                start = min(cursor - self._base, len(self._buffer))
            data = bytes(self._buffer[start:])
            return {
                "data": data.decode("utf-8", "replace"),
                "cursor": self._base + len(self._buffer),
                "closed": self._closed,
                "error": self.error,
            }

    def write(self, data: str) -> None:
        if self._closed:
            raise VaultError("SSH 会话已断开")
        try:
            self._channel.send(data.encode("utf-8"))
        except Exception as exc:
            raise _friendly(exc, "发送输入") from exc

    def resize(self, cols: int, rows: int) -> None:
        try:
            self._channel.resize_pty(width=max(20, int(cols)), height=max(5, int(rows)))
        except Exception:
            log.debug("resize failed", exc_info=True)

    def close(self) -> None:
        with self._lock:
            self._closed = True
        for closer in (self._channel.close, self._client.close):
            try:
                closer()
            except Exception:
                pass


# --------------------------------------------------------------- file share
def _clean_remote(path: str) -> str:
    """paramiko exposes the root as "//", which reads like a typo in the UI."""
    cleaned = (path or "/").replace("\\", "/")
    while cleaned.startswith("//"):
        cleaned = cleaned[1:]
    return cleaned or "/"


def _join_remote(directory: str, name: str) -> str:
    if directory in ("", "."):
        return name
    return posixpath.join(directory.rstrip("/") or "/", name)


class FileSession(_Session):
    """FTP or SFTP file browser backed by one connection."""

    kind = "files"

    def __init__(
        self,
        protocol: str,
        host: str,
        port: int,
        username: str,
        password: str,
        title: str,
    ) -> None:
        super().__init__(title, protocol)
        self.protocol = protocol
        self._lock = threading.Lock()
        self._ssh = None
        self._sftp = None
        self._ftp = None
        if protocol == "sftp":
            import paramiko

            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            try:
                client.connect(
                    hostname=host,
                    port=port or 22,
                    username=username or None,
                    password=password or None,
                    timeout=SSH_CONNECT_TIMEOUT,
                    banner_timeout=SSH_CONNECT_TIMEOUT,
                    auth_timeout=SSH_CONNECT_TIMEOUT,
                    allow_agent=False,
                    look_for_keys=False,
                )
                self._sftp = client.open_sftp()
            except paramiko.AuthenticationException as exc:
                client.close()
                raise VaultError("SFTP 用户名或密码不正确") from exc
            except Exception as exc:
                client.close()
                raise _friendly(exc, "SFTP 连接") from exc
            self._ssh = client
            self.cwd = _clean_remote(self._sftp.normalize("."))
        else:
            import ftplib

            last: Exception | None = None
            ftp = None
            for encoding in ("utf-8", "gb18030"):
                candidate = ftplib.FTP(encoding=encoding)
                try:
                    candidate.connect(host, port or 21, timeout=SSH_CONNECT_TIMEOUT)
                    candidate.login(username or "anonymous", password or "anonymous@")
                    self.cwd = candidate.pwd()
                    ftp = candidate
                    break
                except UnicodeError as exc:  # legacy Chinese servers
                    last = exc
                    try:
                        candidate.close()
                    except Exception:
                        pass
                except ftplib.error_perm as exc:
                    candidate.close()
                    raise VaultError(f"FTP 登录失败：{exc}") from exc
                except Exception as exc:
                    candidate.close()
                    raise _friendly(exc, "FTP 连接") from exc
            if ftp is None:
                raise _friendly(last or RuntimeError("FTP 连接失败"), "FTP 连接")
            ftp.set_pasv(True)
            self._ftp = ftp

    # ------------------------------------------------------------- listing
    def list(self, path: str) -> dict:
        target = (path or self.cwd or ".").strip() or "."
        entries: list[dict] = []
        with self._lock:
            if self._sftp is not None:
                try:
                    attrs = self._sftp.listdir_attr(target)
                except FileNotFoundError as exc:
                    raise VaultError("远程目录不存在") from exc
                except Exception as exc:
                    raise _friendly(exc, "读取远程目录") from exc
                for attr in attrs:
                    entries.append(
                        {
                            "name": attr.filename,
                            "is_dir": (attr.st_mode or 0) & 0o170000 == 0o040000,
                            "size": int(attr.st_size or 0),
                            "mtime": int(attr.st_mtime or 0),
                        }
                    )
                self.cwd = _clean_remote(self._sftp.normalize(target))
            else:
                assert self._ftp is not None
                try:
                    self._ftp.cwd(target)
                    self.cwd = self._ftp.pwd()
                    try:
                        for name, facts in self._ftp.mlsd():
                            if name in (".", ".."):
                                continue
                            entries.append(
                                {
                                    "name": name,
                                    "is_dir": facts.get("type") in ("dir", "cdir", "pdir"),
                                    "size": int(facts.get("size") or 0),
                                    "mtime": 0,
                                }
                            )
                    except Exception:
                        lines: list[str] = []
                        self._ftp.retrlines("LIST", lines.append)
                        entries = _parse_list_lines(lines)
                except Exception as exc:
                    raise _friendly(exc, "读取远程目录") from exc
        entries.sort(key=lambda item: (not item["is_dir"], item["name"].lower()))
        return {"path": self.cwd, "entries": entries}

    # ------------------------------------------------------------ mutation
    def mkdir(self, path: str) -> None:
        with self._lock:
            try:
                if self._sftp is not None:
                    self._sftp.mkdir(path)
                else:
                    assert self._ftp is not None
                    self._ftp.mkd(path)
            except Exception as exc:
                raise _friendly(exc, "新建目录") from exc

    def remove(self, path: str, is_dir: bool = False) -> None:
        with self._lock:
            try:
                if self._sftp is not None:
                    if is_dir:
                        self._sftp.rmdir(path)
                    else:
                        self._sftp.remove(path)
                else:
                    assert self._ftp is not None
                    if is_dir:
                        self._ftp.rmd(path)
                    else:
                        self._ftp.delete(path)
            except Exception as exc:
                raise _friendly(exc, "删除") from exc

    def rename(self, old: str, new: str) -> None:
        with self._lock:
            try:
                if self._sftp is not None:
                    self._sftp.rename(old, new)
                else:
                    assert self._ftp is not None
                    self._ftp.rename(old, new)
            except Exception as exc:
                raise _friendly(exc, "重命名") from exc

    # ----------------------------------------------------------- transfers
    def download(self, remote: str, local: str) -> dict:
        os.makedirs(os.path.dirname(os.path.abspath(local)) or ".", exist_ok=True)
        with self._lock:
            try:
                if self._sftp is not None:
                    self._sftp.get(remote, local)
                else:
                    assert self._ftp is not None
                    with open(local, "wb") as handle:
                        self._ftp.retrbinary(f"RETR {remote}", handle.write)
            except Exception as exc:
                raise _friendly(exc, "下载") from exc
        return {"path": local, "name": os.path.basename(local)}

    def upload(self, local: str, remote_dir: str) -> dict:
        target = _join_remote(remote_dir, os.path.basename(local))
        with self._lock:
            try:
                if self._sftp is not None:
                    self._sftp.put(local, target)
                else:
                    assert self._ftp is not None
                    with open(local, "rb") as handle:
                        self._ftp.storbinary(f"STOR {target}", handle)
            except Exception as exc:
                raise _friendly(exc, "上传") from exc
        return {"path": target, "name": os.path.basename(local)}

    def close(self) -> None:
        for closer in (self._sftp.close if self._sftp else None,
                       self._ssh.close if self._ssh else None,
                       self._ftp.close if self._ftp else None):
            if closer:
                try:
                    closer()
                except Exception:
                    pass
        self._sftp = None
        self._ssh = None
        self._ftp = None


def _parse_list_lines(lines: list[str]) -> list[dict]:
    """Best-effort fallback for servers without MLSD (unix or DOS style)."""
    import re

    entries: list[dict] = []
    dos_row = re.compile(
        r"^\d{2}-\d{2}-\d{2,4}\s+\d{1,2}:\d{2}(?:\s*[AP]M)?\s+(\d+)\s+(.+)$", re.I
    )
    for line in lines:
        text = line.rstrip()
        if not text:
            continue
        if "<DIR>" in text.upper():
            name = text[text.upper().index("<DIR>") + 5:].strip()
            if name and name not in (".", ".."):
                entries.append({"name": name, "is_dir": True, "size": 0, "mtime": 0})
            continue
        parts = text.split(None, 8)
        if len(parts) < 9:
            # DOS style without <DIR>: 10-25-2023  03:14 PM   1234  name.txt
            match = dos_row.match(text)
            if match:
                entries.append(
                    {
                        "name": match.group(2).strip(),
                        "is_dir": False,
                        "size": int(match.group(1)),
                        "mtime": 0,
                    }
                )
            continue
        mode, _links, _owner, _group, size, _month, _day, _time_or_year, name = parts
        if name in (".", ".."):
            continue
        is_dir = mode.startswith("d")
        entries.append(
            {
                "name": name,
                "is_dir": is_dir,
                "size": 0 if is_dir or not size.isdigit() else int(size),
                "mtime": 0,
            }
        )
    return entries


# ---------------------------------------------------------------------- vnc
class VncSession(_Session):
    """A tiny WebSocket-to-TCP relay so noVNC can render inside the app."""

    kind = "vnc"

    def __init__(self, host: str, port: int, title: str) -> None:
        super().__init__(title, "vnc")
        from websockets.sync.server import serve

        self.token = uuid.uuid4().hex
        self._host = host
        self._port = port
        self._closed = False
        self._active: set[Any] = set()
        self._active_lock = threading.Lock()

        def handler(ws) -> None:
            request = getattr(ws, "request", None)
            path = getattr(request, "path", "") if request is not None else ""
            if self.token not in (path or ""):
                try:
                    ws.close(code=1008, reason="invalid token")
                except Exception:
                    pass
                return
            try:
                upstream = socket.create_connection((host, port), timeout=SSH_CONNECT_TIMEOUT)
            except Exception as exc:
                try:
                    ws.close(code=1011, reason=text_of(exc)[:120])
                except Exception:
                    pass
                return
            upstream.setblocking(False)
            with self._active_lock:
                self._active.add(upstream)
            try:
                while True:
                    if self._closed:
                        break
                    message = None
                    try:
                        message = ws.recv(timeout=0.1)
                    except TimeoutError:
                        message = None
                    except Exception:
                        break
                    if message:
                        if isinstance(message, str):
                            message = message.encode("utf-8", "ignore")
                        try:
                            upstream.setblocking(True)
                            upstream.sendall(message)
                        finally:
                            upstream.setblocking(False)
                    try:
                        chunk = upstream.recv(65536)
                    except BlockingIOError:
                        chunk = None
                    except Exception:
                        break
                    if chunk == b"":
                        break
                    if chunk:
                        try:
                            ws.send(chunk)
                        except Exception:
                            break
            finally:
                with self._active_lock:
                    self._active.discard(upstream)
                try:
                    upstream.close()
                except Exception:
                    pass
                try:
                    ws.close()
                except Exception:
                    pass

        try:
            self._server = serve(
                handler,
                "127.0.0.1",
                0,
                subprotocols=["binary"],
                max_size=None,
            )
        except Exception as exc:
            raise _friendly(exc, "VNC 代理") from exc
        self._server_port = self._server.socket.getsockname()[1]
        self._thread = threading.Thread(
            target=self._server.serve_forever, name=f"vnc-{self.id}", daemon=True
        )
        self._thread.start()

    def ws_url(self) -> str:
        return f"ws://127.0.0.1:{self._server_port}/?token={self.token}"

    def close(self) -> None:
        self._closed = True
        try:
            self._server.shutdown()
        except Exception:
            pass
        with self._active_lock:
            active = list(self._active)
            self._active.clear()
        for sock in active:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass
            try:
                sock.close()
            except Exception:
                pass


def text_of(exc: Exception) -> str:
    return str(exc) or exc.__class__.__name__


# -------------------------------------------------------------------- local
def local_roots() -> list[dict]:
    entries: list[dict] = []
    if os.name == "nt":
        import string

        for letter in string.ascii_uppercase:
            root = f"{letter}:\\"
            if os.path.exists(root):
                entries.append({"name": root, "path": root})
    else:  # pragma: no cover - the product targets Windows
        entries.append({"name": "/", "path": "/"})
    return entries


def local_list(path: str) -> dict:
    if not path:
        return {"path": "", "parent": "", "roots": local_roots(), "entries": []}
    resolved = os.path.abspath(os.path.expanduser(path))
    if not os.path.isdir(resolved):
        raise VaultError("本地目录不存在或不可访问")
    entries: list[dict] = []
    try:
        with os.scandir(resolved) as iterator:
            for entry in iterator:
                try:
                    stat = entry.stat()
                    size = 0 if entry.is_dir() else int(stat.st_size)
                    mtime = int(stat.st_mtime)
                except OSError:
                    size, mtime = 0, 0
                entries.append(
                    {"name": entry.name, "is_dir": entry.is_dir(), "size": size, "mtime": mtime}
                )
    except PermissionError as exc:
        raise VaultError("没有权限读取这个目录") from exc
    entries.sort(key=lambda item: (not item["is_dir"], item["name"].lower()))
    parent = os.path.dirname(resolved.rstrip("\\/")) or ""
    if parent == resolved:
        parent = ""
    return {"path": resolved, "parent": parent, "entries": entries}


# ------------------------------------------------------------------ manager
_sessions: dict[str, _Session] = {}
_sessions_lock = threading.Lock()


def _register(session: _Session) -> dict:
    with _sessions_lock:
        _sessions[session.id] = session
    return session.info()


def get(session_id: str) -> _Session:
    with _sessions_lock:
        session = _sessions.get(session_id)
    if session is None:
        raise VaultError("会话不存在或已结束")
    return session


def open_ssh(host: str, port: int, username: str, password: str, title: str,
             cols: int = 100, rows: int = 30) -> dict:
    session = SshSession(host, port, username, password, title, cols, rows)
    info = _register(session)
    info["session_id"] = info["id"]
    return info


def open_files(protocol: str, host: str, port: int, username: str, password: str,
               title: str) -> dict:
    session = FileSession(protocol, host, port, username, password, title)
    info = _register(session)
    info["session_id"] = info["id"]
    return info


def open_vnc(host: str, port: int, title: str) -> dict:
    session = VncSession(host, port, title)
    info = _register(session)
    info["session_id"] = info["id"]
    info["ws_url"] = session.ws_url()
    return info


def list_info() -> list[dict]:
    with _sessions_lock:
        sessions = list(_sessions.values())
    return [session.info() for session in sessions]


def close(session_id: str) -> None:
    with _sessions_lock:
        session = _sessions.pop(session_id, None)
    if session is not None:
        session.close()


def close_all() -> None:
    with _sessions_lock:
        sessions = list(_sessions.values())
        _sessions.clear()
    for session in sessions:
        try:
            session.close()
        except Exception:
            log.debug("closing session failed", exc_info=True)
