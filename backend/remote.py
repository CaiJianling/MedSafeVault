"""Remote connection helpers: RDP, SSH/Telnet clients and VNC viewers.

The built-in terminal lives in ``sessions.py``; this module only launches
external programs the user has configured.
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import webbrowser

log = logging.getLogger(__name__)

_SECURECRT_CANDIDATES = [
    os.path.join(base, sub)
    for base in (
        r"C:\Program Files",
        r"C:\Program Files (x86)",
        r"D:\Program Files",
        r"D:\Program Files (x86)",
    )
    for sub in (
        r"VanDyke Software\SecureCRT\SecureCRT.exe",
        r"VanDyke Software\Clients\SecureCRT.exe",
        r"SecureCRT\SecureCRT.exe",
    )
]


_PROGRAM_CANDIDATES: dict[str, tuple[list[str], list[str]]] = {
    "putty": (
        [
            os.path.join(base, sub)
            for base in (
                r"C:\Program Files",
                r"C:\Program Files (x86)",
                r"D:\Program Files",
                r"D:\Program Files (x86)",
                os.path.expanduser(r"~\AppData\Local\Programs"),
            )
            for sub in ("PuTTY\\putty.exe", "PuTTY\\PUTTY.EXE")
        ],
        ["putty.exe", "putty"],
    ),
    "xshell": (
        [
            os.path.join(base, sub)
            for base in (
                r"C:\Program Files",
                r"C:\Program Files (x86)",
                r"D:\Program Files",
                r"D:\Program Files (x86)",
            )
            for sub in ("NetSarang\\Xshell 7\\Xshell.exe", "NetSarang\\Xshell 8\\Xshell.exe",
                        "NetSarang\\Xshell 6\\Xshell.exe", "NetSarang\\Xshell\\Xshell.exe")
        ],
        ["Xshell.exe", "Xshell"],
    ),
    "winscp": (
        [
            os.path.join(base, sub)
            for base in (r"C:\Program Files", r"C:\Program Files (x86)", r"D:\Program Files")
            for sub in ("WinSCP\\WinSCP.exe", "WinSCP\\WinSCP.com")
        ],
        ["WinSCP.exe", "WinSCP.com", "WinSCP"],
    ),
    "vncviewer": (
        [
            os.path.join(base, sub)
            for base in (r"C:\Program Files", r"C:\Program Files (x86)", r"D:\Program Files")
            for sub in (
                r"RealVNC\VNC Viewer\vncviewer.exe",
                r"TightVNC\tvnviewer.exe",
                r"UltraVNC\vncviewer.exe",
                r"uvnc bvba\UltraVNC\vncviewer.exe",
            )
        ],
        ["vncviewer.exe", "tvnviewer.exe", "vncviewer"],
    ),
    "openssh": ([], ["ssh.exe", "ssh"]),
    "telnet": ([], ["telnet.exe", "telnet"]),
}


def find_securecrt(configured: str = "") -> str | None:
    return _find_program(configured, "securecrt")


def _find_program(configured: str, name: str) -> str | None:
    if configured and os.path.isfile(configured):
        return configured
    candidates, names = _PROGRAM_CANDIDATES.get(name, ([], []))
    if name == "securecrt":
        candidates, names = _SECURECRT_CANDIDATES, ["SecureCRT.exe", "SecureCRT"]
    for path in candidates:
        if os.path.isfile(path):
            return path
    for exe in names:
        found = shutil.which(exe)
        if found:
            return found
    return None


def find_program(configured: str, name: str) -> str | None:
    return _find_program(configured, name)


def parse_port(text: str | None, default: int) -> int:
    if not text:
        return default
    match = re.search(r"\b(\d{2,5})\b", str(text))
    if match:
        try:
            port = int(match.group(1))
            if 0 < port < 65536:
                return port
        except ValueError:
            pass
    return default


def is_windows_host(os_text: str | None) -> bool:
    text = (os_text or "").lower()
    return "windows" in text or ("win" in text and "darwin" not in text)


def is_web_address(address: str) -> bool:
    text = (address or "").strip().lower()
    return text.startswith("http://") or text.startswith("https://")


def open_web(address: str) -> None:
    webbrowser.open(address, new=2)


def split_host_port(address: str, port_text: str | None, default: int) -> tuple[str, int]:
    port = parse_port(port_text, default)
    target = (address or "").strip()
    # https://host or http://host are web links, not hosts.
    if "://" in target:
        target = target.split("://", 1)[1].rstrip("/")
    if ":" in target and not target.startswith("["):
        host, _, maybe_port = target.rpartition(":")
        if maybe_port.isdigit():
            target = host
            port = int(maybe_port)
    return target, port


def launch_rdp(
    address: str,
    username: str,
    port_text: str | None,
    temp_dir: str,
    fill: str = "user",
    password: str = "",
) -> dict:
    """Start mstsc; *fill* is ``user``, ``password`` or ``none``.

    mstsc cannot read a password from .rdp, so ``password`` stores a temporary
    Windows credential (cmdkey), removes it as soon as mstsc exits, and never
    writes the password to the .rdp file.
    """
    target, port = split_host_port(address, port_text, 3389)
    lines = [
        f"full address:s:{target}:{port}",
        "authentication level:i:2",
        "screen mode id:i:2",
        "smart sizing:i:1",
        "redirectclipboard:i:1",
    ]
    fill = (fill or "user").lower()
    if username and fill in ("user", "password"):
        lines.append(f"username:s:{username}")
    if fill == "password" and username and password:
        lines.append("prompt for credentials:i:0")
        _store_credential(target, username, password)
    else:
        lines.append("prompt for credentials:i:1")
    content = "\r\n".join(lines) + "\r\n"

    os.makedirs(temp_dir, exist_ok=True)
    fd, path = tempfile.mkstemp(prefix="msv-", suffix=".rdp", dir=temp_dir)
    os.close(fd)
    with open(path, "w", encoding="utf-16") as handle:
        handle.write(content)
    process = subprocess.Popen(["mstsc", path], shell=False)

    def cleanup() -> None:
        # Keep the .rdp around while the window lives: mstsc reads it on start.
        try:
            process.wait(timeout=6 * 3600)
        except Exception:
            pass
        if fill == "password" and username and password:
            _delete_credential(target)
        try:
            os.remove(path)
        except OSError:
            pass

    threading.Thread(target=cleanup, daemon=True).start()
    return {"target": f"{target}:{port}", "pid": process.pid}


def _store_credential(host: str, username: str, password: str) -> None:
    try:
        subprocess.run(
            ["cmdkey", f"/generic:TERMSRV/{host}", f"/user:{username}", f"/pass:{password}"],
            shell=False,
            capture_output=True,
            timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception:
        log.debug("cmdkey store failed", exc_info=True)


def _delete_credential(host: str) -> None:
    try:
        subprocess.run(
            ["cmdkey", f"/delete:TERMSRV/{host}"],
            shell=False,
            capture_output=True,
            timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception:
        log.debug("cmdkey delete failed", exc_info=True)


def launch_ssh(
    exe: str, address: str, username: str, password: str,
    port_text: str | None,
) -> str:
    port = parse_port(port_text, 22)
    target = address.strip()
    if ":" in target and not target.startswith("["):
        host, _, maybe_port = target.rpartition(":")
        if maybe_port.isdigit():
            target = host
            port = int(maybe_port)
    args = [exe, "/SSH2", "/N", f"MSV-{target}"]
    if username:
        args += ["/L", username]
    args += ["/P", str(port)]
    if password:
        args += ["/PASSWORD", password]
    args.append(target)
    subprocess.Popen(args, shell=False)
    return f"{target}:{port}"


def launch_client(
    client: str,
    exe: str,
    address: str,
    username: str,
    password: str,
    port_text: str | None,
    protocol: str = "ssh",
) -> str:
    """Start an external SSH/Telnet client; returns the host:port summary."""
    target, port = split_host_port(
        address, port_text, 23 if protocol == "telnet" else 22
    )
    client = (client or "").lower()
    if client == "securecrt":
        if protocol == "telnet":
            args = [exe, "/TELNET", "/N", f"MSV-{target}", "/P", str(port)]
            if username:
                args += ["/L", username]
            args.append(target)
        else:
            args = [exe, "/SSH2", "/N", f"MSV-{target}"]
            if username:
                args += ["/L", username]
            args += ["/P", str(port)]
            if password:
                args += ["/PASSWORD", password]
            args.append(target)
        subprocess.Popen(args, shell=False)
    elif client == "putty":
        args = [exe, "-telnet" if protocol == "telnet" else "-ssh", target, "-P", str(port)]
        if username:
            args += ["-l", username]
        if password and protocol != "telnet":
            args += ["-pw", password]
        subprocess.Popen(args, shell=False)
    elif client == "xshell":
        scheme = "telnet" if protocol == "telnet" else "ssh"
        user = f"{username}@" if username else ""
        subprocess.Popen([exe, "-url", f"{scheme}://{user}{target}:{port}"], shell=False)
    elif client == "openssh":
        args = [exe, "-p", str(port)]
        if username:
            args += ["-l", username]
        args.append(target)
        subprocess.Popen(args, shell=False, creationflags=subprocess.CREATE_NEW_CONSOLE)
    elif client == "telnet":
        subprocess.Popen([exe, target, str(port)], shell=False,
                         creationflags=subprocess.CREATE_NEW_CONSOLE)
    else:
        raise ValueError(f"unknown client {client}")
    return f"{target}:{port}"


def launch_winscp(exe: str, protocol: str, address: str, username: str,
                  password: str, port_text: str | None) -> str:
    target, port = split_host_port(address, port_text, 22 if protocol == "sftp" else 21)
    from urllib.parse import quote

    user = quote(username or "", safe="")
    secret = f":{quote(password, safe='')}" if password else ""
    url = f"{protocol}://{user}{secret}@{target}:{port}/"
    subprocess.Popen([exe, url], shell=False)
    return f"{target}:{port}"


def launch_vnc_viewer(exe: str, address: str, port_text: str | None) -> str:
    target, port = split_host_port(address, port_text, 5900)
    subprocess.Popen([exe, f"{target}:{port}"], shell=False)
    return f"{target}:{port}"


def _is_rdp_process(pid: int) -> bool:
    if os.name != "nt" or not pid:
        return False
    try:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x1000, False, pid)  # QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        try:
            size = wintypes.DWORD(1024)
            buffer = ctypes.create_unicode_buffer(1024)
            if not kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
                return False
            return os.path.basename(buffer.value).lower() == "mstsc.exe"
        finally:
            kernel32.CloseHandle(handle)
    except Exception:
        return False


def focus_window(pid: int) -> bool:
    if not _is_rdp_process(pid):
        return False
    try:
        import ctypes

        user32 = ctypes.windll.user32
        found: list[int] = []

        @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
        def callback(hwnd, _param):
            owner = ctypes.c_ulong()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
            if owner.value == pid and user32.IsWindowVisible(hwnd):
                found.append(hwnd)
            return True

        user32.EnumWindows(callback, 0)
        for hwnd in found:
            user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        if found:
            user32.SetForegroundWindow(found[0])
        return bool(found)
    except Exception:
        return False


def close_window(pid: int) -> bool:
    if not _is_rdp_process(pid):
        return False
    try:
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            shell=False,
            capture_output=True,
            timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return True
    except Exception:
        return False
