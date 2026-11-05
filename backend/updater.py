"""Client side of the intranet update service.

The operator runs `update/server.py` on a file server inside the hospital
network and points the app at it from Settings → 数据与更新 → 更新服务地址.
Nothing here talks to the internet by itself: every request goes to the URL the
operator typed, and a release is only accepted when its sha256 matches what the
service declared.

Replacing a running Windows executable is the tricky part, so the work is split:

* this process downloads the new exe next to the vault data, verifies it, then
* spawns a detached copy of itself with `--apply-update <new> <target> [pid]`
  and quits, and
* that helper waits for the old process to let go of the file, keeps the old
  binary as `<target>.old`, moves the new one into place and starts it again.

The helper runs without a console window, so it appends to
`<target directory>/update-apply.log` instead of printing.
"""
from __future__ import annotations

import ctypes
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

from . import __version__
from .paths import data_dir

MAX_DOWNLOAD_BYTES = 1 << 30  # 1 GiB sanity ceiling for a declared size
CONNECT_TIMEOUT = 6.0
READ_TIMEOUT = 60.0
CHUNK = 64 * 1024
USER_AGENT = f"MedSafeVault/{__version__} updater"

STATE_IDLE = "idle"
STATE_CHECKING = "checking"
STATE_DOWNLOADING = "downloading"
STATE_VERIFYING = "verifying"
STATE_READY = "ready"
STATE_RESTARTING = "restarting"
STATE_ERROR = "error"


class UpdateError(Exception):
    """Anything the operator can act on: bad URL, unreachable service, ..."""


_VERSION_RE = re.compile(r"^\d+(\.\d+){0,3}$")


def parse_version(text: Any) -> tuple[int, ...]:
    """`2.1` and `2.1.0.3` become comparable tuples of ints."""
    parts = str(text or "").strip().split("-")[0].split("+")[0]
    if not _VERSION_RE.match(parts):
        raise UpdateError(f"版本号格式不正确：{text}")
    numbers = [int(item) for item in parts.split(".")]
    while len(numbers) < 4:
        numbers.append(0)
    return tuple(numbers[:4])


def is_newer(candidate: Any, current: Any) -> bool:
    """True when `candidate` is a later release than `current`."""
    try:
        return parse_version(candidate) > parse_version(current)
    except UpdateError:
        return False


def version_endpoint(base: str) -> str:
    """Accept a bare host, a folder, or the endpoint itself."""
    url = str(base or "").strip()
    if not url:
        raise UpdateError("尚未填写更新服务地址")
    if not re.match(r"^https?://", url, re.I):
        raise UpdateError("更新服务地址需要以 http:// 或 https:// 开头")
    parsed = urllib.parse.urlsplit(url)
    path = parsed.path.rstrip("/")
    if path.endswith("/api/version"):
        return url
    if path.endswith("/api"):
        path = path + "/version"
    else:
        path = (path + "/api/version") if path else "/api/version"
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


def _opener() -> urllib.request.OpenerDirector:
    # An intranet file server is reached directly; a system proxy would only
    # get in the way (and hospital terminals usually carry one).
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _request(url: str, timeout: float) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        return _opener().open(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        raise UpdateError(f"更新服务返回 {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise UpdateError(f"无法连接更新服务：{exc.reason}") from exc
    except OSError as exc:
        raise UpdateError(f"无法连接更新服务：{exc}") from exc


def check(base_url: str, current: str | None = None,
          timeout: float = CONNECT_TIMEOUT) -> dict:
    """Ask the service for the newest release and compare it with this build."""
    running = current or __version__
    endpoint = version_endpoint(base_url)
    split = urllib.parse.urlsplit(endpoint)
    query = urllib.parse.parse_qs(split.query)
    query.setdefault("current", [running])
    url = urllib.parse.urlunsplit((
        split.scheme, split.netloc, split.path,
        urllib.parse.urlencode({k: v[0] for k, v in query.items()}), ""))
    with _request(url, timeout) as response:
        body = response.read(200_000)
    try:
        payload = json.loads(body.decode("utf-8"))
    except Exception as exc:
        raise UpdateError("更新服务返回的不是有效 JSON") from exc
    if not isinstance(payload, dict):
        raise UpdateError("更新服务返回格式不正确")
    latest = str(payload.get("latest") or "").strip()
    if not latest:
        raise UpdateError("更新服务没有声明最新版本")
    update = payload.get("update") or {}
    info = {
        "checked_url": url,
        "current": running,
        "latest": latest,
        # The comparison is decided here rather than trusted from the service:
        # the build number this process runs is the only version that matters.
        "available": is_newer(latest, running),
        "version": str(update.get("version") or latest),
        "notes": str(update.get("notes") or ""),
        "size": int(update.get("size") or 0),
        "sha256": str(update.get("sha256") or "").lower(),
        "mandatory": bool(update.get("mandatory")),
        "released_at": str(update.get("released_at") or ""),
        "download": _absolute(url, str(update.get("download") or "")),
        "filename": str(update.get("filename") or "MedSafeVault.exe"),
    }
    if info["available"] and not info["download"]:
        raise UpdateError("更新服务没有提供下载地址")
    if info["available"] and not re.fullmatch(r"[0-9a-f]{64}", info["sha256"] or ""):
        raise UpdateError("更新服务没有提供有效的 sha256")
    return info


def _absolute(endpoint: str, href: str) -> str:
    if not href:
        return ""
    if re.match(r"^https?://", href, re.I):
        return href
    base = urllib.parse.urlsplit(endpoint)
    path = href if href.startswith("/") else "/".join(
        base.path.rstrip("/").split("/")[:-1] + [href])
    return urllib.parse.urlunsplit((base.scheme, base.netloc, path, "", ""))


def update_dir() -> Path:
    folder = data_dir() / "updates"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def download(info: dict, on_progress: Callable[[dict], None] | None = None,
             stop: threading.Event | None = None, dest_dir: Path | None = None) -> Path:
    """Stream the release to disk, refusing anything but the declared digest."""
    url = info.get("download") or ""
    if not url:
        raise UpdateError("缺少下载地址")
    want = (info.get("sha256") or "").lower()
    declared = int(info.get("size") or 0)
    if declared and declared > MAX_DOWNLOAD_BYTES:
        raise UpdateError("更新包大小超出预期")
    folder = dest_dir or update_dir()
    folder.mkdir(parents=True, exist_ok=True)
    name = re.sub(r"[^0-9A-Za-z._-]", "_", str(info.get("filename") or "MedSafeVault.exe"))
    stem, suffix = Path(name).stem, Path(name).suffix or ".exe"
    version = str(info.get("version") or "")
    # The release file usually already carries its version in the name.
    if not version or not stem.endswith(version):
        stem = f"{stem}-{version}" if version else stem
    final = folder / f"{stem}{suffix}"
    partial = folder / (final.name + ".part")
    digest = hashlib.sha256()
    received = 0
    try:
        with _request(url, READ_TIMEOUT) as response, open(partial, "wb") as fh:
            total = int(response.headers.get("Content-Length") or declared or 0)
            while True:
                if stop is not None and stop.is_set():
                    raise UpdateError("已取消下载")
                block = response.read(CHUNK)
                if not block:
                    break
                fh.write(block)
                digest.update(block)
                received += len(block)
                if received > MAX_DOWNLOAD_BYTES:
                    raise UpdateError("更新包过大，已中止")
                if on_progress:
                    on_progress({
                        "state": STATE_DOWNLOADING,
                        "received": received,
                        "total": total,
                        "percent": round(received * 100 / total, 1) if total else 0.0,
                    })
        if on_progress:
            on_progress({"state": STATE_VERIFYING, "received": received,
                         "total": received, "percent": 100.0})
        actual = digest.hexdigest()
        if want and actual != want:
            raise UpdateError(f"校验不通过：期望 {want[:12]}…，实际 {actual[:12]}…")
        if declared and received != declared:
            raise UpdateError(f"大小不符：期望 {declared}，实际 {received}")
        os.replace(partial, final)
    finally:
        if partial.exists():
            try:
                partial.unlink()
            except OSError:
                pass
    return final


def target_exe() -> Path | None:
    """The file to overwrite — the packaged exe, or None when running from source."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable)
    return None


def apply_cli(argv: list[str]) -> int:
    """`--apply-update <new-file> <target> [wait-pid] [--no-relaunch]`."""
    log_file: Callable[[str], None] = _logger(argv)
    try:
        if len(argv) < 2:
            log_file("usage: --apply-update <new-file> <target> [wait-pid]")
            return 2
        new_file = Path(argv[0])
        target = Path(argv[1])
        wait_pid = int(argv[2]) if len(argv) > 2 and re.fullmatch(r"\d+", argv[2] or "") else 0
        relaunch = "--no-relaunch" not in argv[3:]
        if not new_file.exists():
            log_file(f"missing download: {new_file}")
            return 1
        result = apply_update(new_file, target, wait_pid=wait_pid, on_log=log_file)
        log_file(f"replaced {result['target']} ({result['bytes']} bytes)")
        if wait_pid:
            # Relaunching while the old process still holds the single-instance
            # mutex makes the new one quit silently, so wait it out first.
            gone = wait_for_exit(wait_pid)
            log_file(
                f"pid {wait_pid} exited" if gone else f"pid {wait_pid} still alive after 60s")
        if relaunch:
            time.sleep(0.6)  # let the mutex, the debug port and the db lock go
            relaunch_process(target, log_file)
            log_file(f"new build at {target} is {target.stat().st_size} bytes")
        return 0
    except Exception as exc:  # the helper has no UI, so everything lands in the log
        log_file(f"FAILED: {exc}")
        return 1


def _logger(argv: list[str]) -> Callable[[str], None]:
    def write(line: str) -> None:
        try:
            folder = Path(argv[1]).parent if len(argv) > 1 else Path(".")
            with open(folder / "update-apply.log", "a", encoding="utf-8") as fh:
                fh.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {line}\n")
        except Exception:
            pass

    return write


def wait_for_exit(pid: int, timeout: float = 60.0) -> bool:
    """The single-instance mutex is only free once the old process is gone."""
    if not pid:
        return True
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not _process_alive(pid):
            return True
        time.sleep(0.3)
    return not _process_alive(pid)


def wait_for_release(target: Path, pid: int = 0, timeout: float = 90.0) -> None:
    """Wait until the running exe lets go of the file."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if pid and not _process_alive(pid):
            # The process is gone; the OS may still hold the name for a
            # moment, so keep probing until the rename actually works.
            pid = 0
        if _swappable(target):
            return
        time.sleep(0.4)
    raise UpdateError(f"{target.name} 仍被占用，无法替换")


def _swappable(path: Path) -> bool:
    """Can this name be renamed right now?

    Windows refuses to overwrite or delete a running image but does allow
    renaming it, which is exactly the trick used below — so the probe is a
    rename, not an open.
    """
    if not path.exists():
        return True
    probe = path.with_name(path.name + ".msv-probe")
    try:
        os.rename(path, probe)
    except OSError:
        return False
    try:
        os.rename(probe, path)
    except OSError:
        return False
    return True


def _process_alive(pid: int) -> bool:
    if os.name != "nt":
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    STILL_ACTIVE = 259
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
    if not handle:
        return False
    try:
        code = ctypes.c_ulong()
        if kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
            return code.value == STILL_ACTIVE
        return True
    finally:
        kernel32.CloseHandle(handle)


def apply_update(new_file: Path, target: Path, wait_pid: int = 0,
                 on_log: Callable[[str], None] | None = None,
                 timeout: float = 90.0) -> dict:
    """Swap the running binary for the downloaded one, keeping the old copy."""
    note = on_log or (lambda _line: None)
    wait_for_release(target, wait_pid, timeout=timeout)
    backup = target.with_name(target.name + ".old")
    if backup.exists():
        try:
            backup.unlink()
        except OSError:
            backup = target.with_name(
                f"{target.stem}-{time.strftime('%Y%m%d%H%M%S')}.old.exe")
            note(f"previous .old is busy, using {backup.name}")
    staged = target.with_name(target.name + ".new")
    shutil.copyfile(new_file, staged)
    os.replace(target, backup)
    note(f"kept the previous build as {backup.name}")
    try:
        os.replace(staged, target)
    except Exception:
        os.replace(backup, target)
        note("restore after a failed replace")
        raise
    try:
        new_file.unlink()
    except OSError:
        pass
    return {"target": str(target), "backup": str(backup),
            "bytes": target.stat().st_size}


def launch_env() -> dict:
    """Environment for a fresh copy of this exe.

    PyInstaller 6's one-file bootloader tells its child "you are already
    extracted" through a set of `_PYI_*` variables — the important ones are
    `_PYI_PARENT_PROCESS_LEVEL=1` and `_PYI_APPLICATION_HOME_DIR=<...>\\_MEIxxxxx`
    (the older bootloaders used `_MEIPASS2` for the same purpose). A grandchild
    started from inside the updater inherits them, skips its own extraction and
    then loads `python313.dll` out of the *parent's* `_MEIxxxxx` folder, which
    the parent deletes on exit. What the user sees is a modal

        Failed to load Python DLL '…\\Temp\\_MEIxxxxx\\python313.dll'.
        LoadLibrary: 找不到指定的模块。

    so every one of those keys has to go. The debug switches are dropped for a
    similar reason: a WebView2 instance from the previous process can still hold
    `MSV_DEBUG_PORT`, and the new window then fails to create at all.
    """
    env = dict(os.environ)
    for key in [name for name in env if name.startswith("_PYI_")]:
        env.pop(key, None)
    for key in ("_MEIPASS", "_MEIPASS2", "PYINSTALLER_RESET_ENVIRONMENT",
                "MSV_DEBUG", "MSV_DEBUG_PORT", "MSV_DEV_URL"):
        env.pop(key, None)
    return env


def relaunch_after_cli(args: list[str], settle: float = 6.0) -> int:
    """Helper mode (`--relaunch-after <秒> <目标 exe>`): wait, then start the new build.

    This runs as a windowed copy of the app, so nothing flashes on screen.
    A batch file would work too, but `cmd.exe`/`timeout` are console programs:
    depending on how they are started they either pop a black window for the
    whole wait or fail to wait at all, so the delay lives in our own GUI
    process instead. The helper takes no single-instance mutex and never
    creates a window (it returns before that code in main()).
    """
    if len(args) < 2:
        return 2
    try:
        delay = max(0.0, float(args[0]))
    except ValueError:
        delay = 4.0
    target = Path(args[1])

    def note(message: str) -> None:
        # 写到自己继承的 stdout：调用方已经把 stdout 指向 update-relaunch.log，
        # 这样只有一条句柄，不会和父进程的追加句柄在 Windows 上打架（再 open 一次
        # 会因为共享冲突被拒绝，之前的实现就是这么把日志写丢的）。
        try:
            print(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}", flush=True)
        except OSError:
            pass

    note(f"waiting {delay:.1f}s before starting {target.name}")
    time.sleep(delay)
    flags = 0
    if os.name == "nt":
        flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    try:
        process = subprocess.Popen([str(target)], cwd=str(target.parent),
                                   creationflags=flags, stdin=subprocess.DEVNULL,
                                   env=launch_env())
    except OSError as exc:
        note(f"cannot start {target.name}: {exc}")
        return 1
    deadline = time.time() + settle
    while time.time() < deadline:
        if process.poll() is None:
            note(f"started {target.name} (pid {process.pid})")
            return 0
        time.sleep(0.3)
    note(f"{target.name} exited right away (code {process.poll()})")
    return 1


def relaunch_process(target: Path, on_log: Callable[[str], None] | None = None,
                     capture: Path | None = None, settle: float = 6.0,
                     delay: int = 4) -> None:
    """Start the replaced exe again.

    Packaged: hand the job to a detached copy of this same exe in
    `--relaunch-after` mode. It waits a few seconds (so this process — and its
    extraction folder — is long gone), then starts the new build. Nothing is
    written next to the exe and no console window appears, unlike the batch
    file this replaced. From source (nothing to replace): start it directly
    and check that it stays up, retrying once if it dies immediately.
    """
    note = on_log or (lambda _line: None)
    flags = 0
    if os.name == "nt":
        flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    log_path = capture or (target.parent / "update-relaunch.log")
    if os.name == "nt" and getattr(sys, "frozen", False):
        args = [sys.executable, "--relaunch-after", str(delay), str(target)]
        with open(log_path, "ab") as out:
            subprocess.Popen(args, cwd=str(target.parent), creationflags=flags,
                             stdin=subprocess.DEVNULL, stdout=out, stderr=out,
                             env=launch_env())
        note(f"scheduled a restart in {delay}s via --relaunch-after")
        return
    process = subprocess.Popen([str(target)], cwd=str(target.parent), creationflags=flags,
                               stdin=subprocess.DEVNULL, env=launch_env())
    note(f"restarted {target.name} (pid {process.pid})")
    deadline = time.time() + settle
    while time.time() < deadline:
        if process.poll() is None:
            return
        time.sleep(0.3)
    code = process.poll()
    if code is None:
        return
    raise UpdateError(f"重启失败（退出码 {code}）")


def spawn_apply(new_file: Path, target: Path, pid: int | None = None) -> None:
    """Hand the swap over to a detached copy of this very executable."""
    args = [sys.executable, "--apply-update", str(new_file), str(target),
            str(pid or os.getpid())]
    flags = 0
    if os.name == "nt":
        flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    with open(os.devnull, "rb+") as devnull:
        subprocess.Popen(args, cwd=str(Path(sys.executable).parent),
                         creationflags=flags, close_fds=True,
                         stdin=devnull, stdout=devnull, stderr=devnull,
                         env=launch_env())


class UpdateJob:
    """Small state holder the API polls, mirroring the terminal session pattern."""

    def __init__(self, dest_dir: Path | None = None) -> None:
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.dest_dir = dest_dir
        self.state = STATE_IDLE
        self.info: dict = {}
        self.progress: dict = {}
        self.error = ""
        self.downloaded: Path | None = None

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "state": self.state,
                "info": self.info,
                "progress": self.progress,
                "error": self.error,
                "ready": bool(self.downloaded is not None),
                "file": str(self.downloaded) if self.downloaded else "",
            }

    def _set(self, **kwargs: Any) -> None:
        with self._lock:
            for key, value in kwargs.items():
                setattr(self, key, value)

    def check(self, base_url: str) -> dict:
        self._set(state=STATE_CHECKING, error="", progress={})
        try:
            info = check(base_url)
        except UpdateError as exc:
            self._set(state=STATE_ERROR, error=str(exc))
            raise
        except Exception as exc:  # defensive: never leave the job stuck
            self._set(state=STATE_ERROR, error=f"检查更新失败：{exc}")
            raise UpdateError(f"检查更新失败：{exc}") from exc
        self._set(state=STATE_IDLE, info=info, error="")
        return info

    def start_download(self, info: dict | None = None) -> dict:
        release = info or self.info
        if not release:
            raise UpdateError("请先检查更新")
        if target_exe() is None:
            raise UpdateError("开发模式下不替换程序，请手动更新 web/dist 与后端文件")
        with self._lock:
            if self._thread and self._thread.is_alive():
                raise UpdateError("更新正在下载中")
            self._stop = threading.Event()
            self.state = STATE_DOWNLOADING
            self.info = release
            self.progress = {}
            self.error = ""
            self.downloaded = None
            stop = self._stop
        thread = threading.Thread(target=self._run_download, args=(release, stop),
                                  name="msv-update", daemon=True)
        self._thread = thread
        thread.start()
        return self.snapshot()

    def _run_download(self, release: dict, stop: threading.Event) -> None:
        try:
            path = download(release, on_progress=self._on_progress, stop=stop,
                           dest_dir=self.dest_dir)
        except UpdateError as exc:
            self._set(state=STATE_ERROR, error=str(exc))
            return
        except Exception as exc:
            self._set(state=STATE_ERROR, error=f"下载失败：{exc}")
            return
        self._set(state=STATE_READY, downloaded=path,
                  progress={"percent": 100.0, "received": path.stat().st_size,
                            "total": path.stat().st_size})

    def _on_progress(self, data: dict) -> None:
        self._set(state=data.get("state", STATE_DOWNLOADING), progress=data)

    def cancel(self) -> dict:
        self._stop.set()
        self._set(state=STATE_IDLE, error="")
        return self.snapshot()

    def install_and_restart(self) -> dict:
        """Swap the binary here, then let the caller quit and the batch restart.

        Doing the swap in this process (rather than in a detached copy of
        itself) keeps the process tree flat: a running Windows image can be
        renamed, so the old build moves aside and the new one lands in its
        place before this process exits. Only the launch has to wait for us,
        and that is what the self-deleting batch is for. If the rename is
        refused — a scanner holding the image, say — fall back to the helper.
        """
        with self._lock:
            if self.state != STATE_READY or not self.downloaded:
                raise UpdateError("还没有下载完成")
            target = target_exe()
            if target is None:
                raise UpdateError("开发模式下不替换程序")
            new_file = self.downloaded
            self.state = STATE_RESTARTING
        digest = hashlib.sha256()
        with open(new_file, "rb") as fh:
            for block in iter(lambda: fh.read(CHUNK), b""):
                digest.update(block)
        want = (self.info.get("sha256") or "").lower()
        if want and digest.hexdigest() != want:
            self._set(state=STATE_ERROR, error="下载文件已损坏，请重新下载")
            raise UpdateError("下载文件已损坏，请重新下载")
        try:
            apply_update(new_file, target, wait_pid=0, timeout=10.0)
            relaunch_process(target)
        except Exception:
            # fall back: a detached helper does the same after we are gone
            spawn_apply(new_file, target)
        return {"target": str(target), "version": self.info.get("version", "")}


job = UpdateJob()
