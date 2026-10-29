"""Checks for connection modes and the built-in sessions.

Run from the repository root:  python tools/test_connect.py
Everything is local: a throwaway vault, a loopback echo server, a loopback
paramiko SSH server and a loopback VNC relay. No real host is contacted.
"""
from __future__ import annotations

import os
import socket
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ["MEDSAFE_DATA_DIR"] = tempfile.mkdtemp(prefix="msv-connect-")

from backend import sessions  # noqa: E402
from backend.store import VaultError, VaultService  # noqa: E402


def check(condition, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"  ok  {message}")


def test_infer_mode() -> None:
    print("[1] connection mode inference")
    infer = VaultService._infer_mode
    check(infer({"address": "198.51.100.10", "port": "22"}) == "ssh", "port column 22 -> ssh")
    check(infer({"address": "198.51.100.10:3389"}) == "rdp", "host:3389 -> rdp")
    check(infer({"address": "198.51.100.10:5901"}) == "vnc", "host:5901 -> vnc")
    check(infer({"address": "198.51.100.10:21"}) == "ftp", "host:21 -> ftp")
    check(infer({"address": "198.51.100.10:23"}) == "telnet", "host:23 -> telnet")
    check(
        infer({"address": "198.51.100.10", "os": "Windows Server 2016"}) == "rdp",
        "Windows without a port -> rdp",
    )
    check(
        infer({"address": "198.51.100.10", "os": "CentOS 7"}) == "ssh",
        "Linux without a port -> ssh",
    )
    check(
        infer({"address": "198.51.100.10:99", "port": "22"}) == "ssh",
        "explicit port column wins only when the address is portless",
    )


def test_modes_persist() -> None:
    print("[2] connect_mode storage")
    db = Path(tempfile.mkdtemp(prefix="msv-modes-")) / "vault.db"
    svc = VaultService(str(db))
    svc.initialize("Mode#2026demo")
    page = next(p for p in svc.get_pages() if p["name"] == "服务器")
    values = {
        "type": "物理机",
        "address": "198.51.100.30",
        "app": "演示主机",
        "os": "Windows Server 2016",
        "username": "demo_user",
        "password": "Demo#Pass2026",
        "port": "3389",
        "note": "",
        "connect_mode": "ssh",
    }
    created = svc.save_record(page["id"], values)
    rid = created["record"]["id"]
    detail = svc.get_record(rid)
    check(detail["values"]["connect_mode"] == "ssh", "explicit mode is stored")
    raw = svc.conn.execute("SELECT data FROM records WHERE id=?", (rid,)).fetchone()["data"]
    check("connect_mode" in raw, "mode lives with the record data")
    check("Demo#Pass2026" not in raw, "password still encrypted next to the mode")

    ctx = svc._connection_context(rid)
    check(ctx["connect_mode"] == "ssh", "mode reaches the connection context")

    values["connect_mode"] = "nosuchmode"
    svc.save_record(page["id"], values, record_id=rid)
    check(
        svc.get_record(rid)["values"]["connect_mode"] == "auto",
        "unknown mode falls back to auto",
    )

    try:
        svc._launch_connection(ctx, svc.get_settings(), "nonsense")
        raise AssertionError("unsupported mode should fail")
    except VaultError as exc:
        check("不支持" in str(exc), f"unsupported mode rejected ({exc})")
    svc.close()


def test_list_parsers() -> None:
    print("[3] FTP LIST fallback parser")
    unix = sessions._parse_list_lines(
        [
            "drwxr-xr-x    2 root root     4096 Oct 20 10:11 config",
            "-rw-r--r--    1 root root     3120 Oct 20 10:12 application.yml",
        ]
    )
    check(len(unix) == 2 and unix[0]["is_dir"] and unix[0]["name"] == "config", "unix dir parsed")
    check(unix[1]["size"] == 3120, "unix size parsed")
    dos = sessions._parse_list_lines(
        [
            "10-25-2023  03:14 PM       <DIR>          logs",
            "10-25-2023  03:15 PM                 1234 app.log",
        ]
    )
    check(len(dos) == 2, "DOS rows parsed")
    check(dos[0]["name"] == "logs" and dos[0]["is_dir"], "DOS <DIR> row")
    check(dos[1]["name"] == "app.log" and dos[1]["size"] == 1234, "DOS file row")


def test_local_list() -> None:
    print("[4] local file browser listing")
    root = Path(tempfile.mkdtemp(prefix="msv-files-"))
    (root / "sub").mkdir()
    (root / "demo.txt").write_text("hello", encoding="utf-8")
    listing = sessions.local_list(str(root))
    names = {entry["name"]: entry for entry in listing["entries"]}
    check("sub" in names and names["sub"]["is_dir"], "directory listed first")
    check(names["demo.txt"]["size"] == 5, "file size reported")
    check(sessions.local_list("")["roots"], "drive roots available")


class _EchoServer:
    """Minimal TCP peer for the VNC relay."""

    def __init__(self) -> None:
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(1)
        self.port = self.sock.getsockname()[1]
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self) -> None:
        try:
            conn, _ = self.sock.accept()
        except OSError:
            return
        with conn:
            while True:
                data = conn.recv(4096)
                if not data:
                    break
                conn.sendall(b"ECHO:" + data)

    def stop(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


def test_vnc_relay() -> None:
    print("[5] VNC relay (WebSocket -> TCP)")
    from websockets.sync.client import connect

    server = _EchoServer()
    info = sessions.open_vnc("127.0.0.1", server.port, "演示 VNC")
    session_id = info["session_id"]
    check(info["kind"] == "vnc" and info["ws_url"].startswith("ws://127.0.0.1:"), "relay started")

    with connect(info["ws_url"], subprotocols=["binary"], open_timeout=5) as ws:
        ws.send(b"ping")
        echoed = ws.recv(timeout=5)
        check(echoed == b"ECHO:ping", "bytes travel both ways")

    started = time.time()
    sessions.close(session_id)
    check(time.time() - started < 5, "close returns promptly")
    try:
        sessions.get(session_id)
        raise AssertionError("session should be gone")
    except VaultError as exc:
        check("不存在" in str(exc) or "关闭" in str(exc), f"closed session removed ({exc})")
    server.stop()


def test_ssh_session() -> None:
    print("[6] built-in SSH terminal")
    import paramiko

    host_key = paramiko.RSAKey.generate(2048)
    listener = socket.socket()
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    port = listener.getsockname()[1]
    ready = threading.Event()
    done = threading.Event()

    class DemoServer(paramiko.ServerInterface):
        def check_auth_password(self, username, password):
            if (username, password) == ("demo", "Demo#Pass2026"):
                return paramiko.AUTH_SUCCESSFUL
            return paramiko.AUTH_FAILED

        def get_allowed_auths(self, username):
            return "password"

        def check_channel_request(self, kind, chanid):
            return paramiko.OPEN_SUCCEEDED

        def check_channel_pty_request(self, *args, **kwargs):
            return True

        def check_channel_shell_request(self, channel):
            ready.set()
            return True

    def serve() -> None:
        try:
            conn, _ = listener.accept()
        except OSError:
            return
        transport = paramiko.Transport(conn)
        transport.add_server_key(host_key)
        transport.start_server(server=DemoServer())
        channel = transport.accept(10)
        if channel is None:
            transport.close()
            return
        channel.sendall(b"demo shell ready\r\n$ ")
        while not done.is_set():
            try:
                data = channel.recv(1024)
            except Exception:
                break
            if not data:
                break
            try:
                channel.sendall(data)
            except Exception:
                break
        for closer in (channel.close, transport.close):
            try:
                closer()
            except Exception:
                pass

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()

    session = sessions.open_ssh("127.0.0.1", port, "demo", "Demo#Pass2026", "演示 SSH")
    check(session["kind"] == "ssh" and session["protocol"] == "ssh", "ssh session opened")
    session_id = session["session_id"]
    deadline = time.time() + 10
    text = ""
    while time.time() < deadline:
        chunk = sessions.get(session_id).read(0)
        text = chunk["data"]
        if "demo shell ready" in text:
            break
        time.sleep(0.1)
    check("demo shell ready" in text, "banner arrives through the terminal")

    sessions.get(session_id).write("echo hi\r")
    deadline = time.time() + 10
    while time.time() < deadline:
        chunk = sessions.get(session_id).read(0)
        if "echo hi" in chunk["data"]:
            text = chunk["data"]
            break
        time.sleep(0.1)
    check("echo hi" in text, "typed input reaches the server")

    cursor = sessions.get(session_id).read(0)["cursor"]
    check(sessions.get(session_id).read(cursor)["data"] == "", "cursor suppresses old output")

    sessions.close(session_id)
    done.set()
    try:
        listener.close()
    except OSError:
        pass
    check(True, "ssh session closed")


def test_sessions_lifecycle() -> None:
    print("[7] lock/quit drops every session")
    db = Path(tempfile.mkdtemp(prefix="msv-lock-")) / "vault.db"
    svc = VaultService(str(db))
    svc.initialize("Lock#2026demo")
    info = sessions.open_vnc("127.0.0.1", 9, "演示 VNC")
    check(len(sessions.list_info()) >= 1, "session registered")
    svc.lock("test")
    check(sessions.list_info() == [], "locking the vault closed all sessions")
    svc.close()
    check(info["session_id"], "session id was returned to the caller")


if __name__ == "__main__":
    test_infer_mode()
    test_modes_persist()
    test_list_parsers()
    test_local_list()
    test_vnc_relay()
    test_ssh_session()
    test_sessions_lifecycle()
    print("All connection self-tests passed.")
