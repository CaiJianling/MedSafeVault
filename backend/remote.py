"""Remote connection helpers: RDP for Windows hosts, SSH through SecureCRT."""
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


def find_securecrt(configured: str = "") -> str | None:
    if configured and os.path.isfile(configured):
        return configured
    for path in _SECURECRT_CANDIDATES:
        if os.path.isfile(path):
            return path
    found = shutil.which("SecureCRT.exe") or shutil.which("SecureCRT")
    return found


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


def launch_rdp(address: str, username: str, port_text: str | None, temp_dir: str) -> str:
    port = parse_port(port_text, 3389)
    target = address.strip()
    if ":" in target and not target.startswith("["):
        # A user supplied host:port already.
        host, _, maybe_port = target.rpartition(":")
        if maybe_port.isdigit():
            target = host
            port = int(maybe_port)
    content = (
        f"full address:s:{target}:{port}\r\n"
        f"username:s:{username}\r\n"
        "prompt for credentials:i:1\r\n"
        "authentication level:i:2\r\n"
        "screen mode id:i:2\r\n"
        "smart sizing:i:1\r\n"
        "redirectclipboard:i:1\r\n"
    )
    os.makedirs(temp_dir, exist_ok=True)
    fd, path = tempfile.mkstemp(prefix="msv-", suffix=".rdp", dir=temp_dir)
    os.close(fd)
    with open(path, "w", encoding="utf-16") as handle:
        handle.write(content)
    subprocess.Popen(["mstsc", path], shell=False)

    def cleanup() -> None:
        time.sleep(20)
        try:
            os.remove(path)
        except OSError:
            pass

    threading.Thread(target=cleanup, daemon=True).start()
    return f"{target}:{port}"


def launch_ssh(exe: str, address: str, username: str, password: str,
               port_text: str | None) -> str:
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
