"""Update service checks: version maths, the HTTP endpoint, download, replace.

Run:  .venv\\Scripts\\python.exe tools\\test_updater.py
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(1, str(ROOT / "update"))

from backend import updater  # noqa: E402

import make_release  # noqa: E402
import server as update_server  # noqa: E402


def serve_until_ready(root: Path, _tmp: Path):
    """Start update/server.py in-process on an ephemeral port and wait for it."""
    catalog = update_server.Catalog(root, root / "versions.json")
    httpd = update_server.build_server("127.0.0.1", 0, catalog)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True,
                              name="msv-update-test")
    thread.start()
    port = httpd.server_address[1]
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=2):
                return httpd, port
        except Exception:
            time.sleep(0.05)
    httpd.shutdown()
    raise AssertionError("update server did not come up")


def check(condition, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"  ok  {message}")


def expect_error(fn, needle: str, message: str) -> None:
    try:
        fn()
    except updater.UpdateError as exc:
        check(needle in str(exc), f"{message} (got: {exc})")
        return
    raise AssertionError(f"{message}: no error raised")


def test_versions() -> None:
    print("[1] version maths, client and server agree")
    pairs = [
        ("2.1.0", "2.0.0", True),
        ("2.0.1", "2.1.0", False),
        ("2.1", "2.1.0", False),
        ("2.1.1", "2.1", True),
        ("10.0.0", "9.9.9", True),
        ("2.0.0.1", "2.0.0", True),
        ("2.0.0", "2.0.0.1", False),
        ("v2.1.0", "2.0.0", False),
        ("2.1.0-beta", "2.0.0", True),
        ("", "2.0.0", False),
        ("abc", "2.0.0", False),
    ]
    for candidate, current, want in pairs:
        got = updater.is_newer(candidate, current)
        check(got is want, f"is_newer({candidate!r}, {current!r}) == {want}")
        server_want = update_server.is_newer(candidate, current)
        check(server_want == want, f"server agrees on {candidate!r}")
    check(updater.parse_version("2.1") == update_server.parse_version("2.1.0"),
          "both pad to four segments")
    for base, want in (
        ("http://10.0.0.5:8000", "http://10.0.0.5:8000/api/version"),
        ("http://10.0.0.5:8000/", "http://10.0.0.5:8000/api/version"),
        ("http://10.0.0.5:8000/updates", "http://10.0.0.5:8000/updates/api/version"),
        ("http://10.0.0.5:8000/api", "http://10.0.0.5:8000/api/version"),
        ("http://10.0.0.5:8000/api/version", "http://10.0.0.5:8000/api/version"),
    ):
        check(updater.version_endpoint(base) == want, f"endpoint from {base}")
    expect_error(lambda: updater.version_endpoint("ftp://x/y"), "http://", "ftp refused")
    expect_error(lambda: updater.version_endpoint(""), "尚未填写", "empty refused")


def make_release_file(folder: Path, payload: bytes) -> tuple[Path, str]:
    exe = folder / "MedSafeVault.exe"
    exe.write_bytes(payload)
    return exe, hashlib.sha256(payload).hexdigest()


def test_server_roundtrip(tmp: Path) -> None:
    print("[2] live server: version, download, digest, range")
    root = tmp / "srv"
    (root / "files").mkdir(parents=True)
    payload = bytes(range(256)) * 400  # 102400 bytes
    exe, digest = make_release_file(tmp, payload)
    rc = make_release.main([
        "--exe", str(exe), "--version", "9.9.0", "--notes", "演示更新说明",
        "--root", str(root),
    ])
    check(rc == 0, "make_release returned 0")
    config = json.loads((root / "versions.json").read_text(encoding="utf-8"))
    check(config["latest"] == "9.9.0", "latest points at the new release")
    check(config["releases"][0]["sha256"] == digest, "sha256 recorded")
    check(config["releases"][0]["size"] == len(payload), "size recorded")
    check((root / "files" / "MedSafeVault-9.9.0.exe").read_bytes() == payload,
          "binary copied into files/")

    httpd, port = serve_until_ready(root, tmp)
    base = f"http://127.0.0.1:{port}/"
    try:
        with urllib.request.urlopen(base + "healthz", timeout=5) as response:
            health = json.loads(response.read())
        check(health["ok"] and health["latest"] == "9.9.0", "healthz reports the latest")

        info = updater.check(base, current="9.8.0")
        check(info["available"] is True, "older build sees an update")
        check(info["version"] == "9.9.0", "update carries the version")
        check(info["notes"] == "演示更新说明", "update carries the notes")
        check(info["sha256"] == digest, "update carries the declared digest")
        check(info["download"] == f"http://127.0.0.1:{port}/download/9.9.0",
              "download URL is absolute")
        check(updater.check(base, current="9.9.0")["available"] is False,
              "same version is not an update")
        check(updater.check(base, current="9.10.0")["available"] is False,
              "a newer local build is not an update")

        seen: list[dict] = []
        dest = updater.download(info, on_progress=seen.append, dest_dir=tmp / "dl")
        check(dest.read_bytes() == payload, "downloaded bytes match")
        check(seen and seen[-1]["percent"] == 100.0, "progress reached 100%")
        percents = [item["percent"] for item in seen]
        check(percents == sorted(percents), "progress never goes backwards")
        check(not list((tmp / "dl").glob("*.part")), "no .part left behind")

        broken = dict(info, sha256="0" * 64)
        expect_error(lambda: updater.download(broken, dest_dir=tmp / "dl2"),
                     "校验不通过", "a wrong digest is refused")
        check(not list((tmp / "dl2").glob("*")), "the bad download left nothing behind")
        short = dict(info, size=len(payload) - 1)
        expect_error(lambda: updater.download(short, dest_dir=tmp / "dl3"),
                     "大小不符", "a size mismatch is refused")

        request = urllib.request.Request(
            info["download"], headers={"Range": "bytes=100-199"})
        with urllib.request.urlopen(request, timeout=5) as response:
            chunk = response.read()
            check(response.status == 206, "range request answers 206")
            check(response.headers["Content-Range"] == f"bytes 100-199/{len(payload)}",
                  "content-range echoes the window")
        check(chunk == payload[100:200], "range body is the requested slice")

        with urllib.request.urlopen(base + "api/releases", timeout=5) as response:
            releases = json.loads(response.read())
        check(len(releases["releases"]) == 1, "releases lists one entry")

        try:
            urllib.request.urlopen(base + "download/8.0.0", timeout=5)
            raise AssertionError("unregistered version was served")
        except urllib.error.HTTPError as exc:
            check(exc.code == 404, "unregistered version answers 404")
        try:
            urllib.request.urlopen(base + "nope", timeout=5)
            raise AssertionError("unknown path answered")
        except urllib.error.HTTPError as exc:
            check(exc.code == 404, "unknown path answers 404")
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_missing_and_escape(tmp: Path) -> None:
    print("[3] missing files and directory escape")
    root = tmp / "srv"
    root.mkdir(parents=True)
    (root / "secret.txt").write_text("not for download", encoding="utf-8")
    (root / "versions.json").write_text(json.dumps({
        "latest": "1.0.0",
        "releases": [
            {"version": "1.0.0", "file": "../secret.txt"},
            {"version": "0.9.0", "file": "files/absent.exe"},
        ],
    }), encoding="utf-8")
    catalog = update_server.Catalog(root, root / "versions.json")
    check(catalog.latest() is None, "nothing usable is offered")
    check(catalog.public(catalog.find("1.0.0"))["sha256"] == "",
          "an escaped path yields no digest")
    check(catalog.path_for(catalog.find("1.0.0")) is None,
          "paths outside the root are refused")
    payload = b"MEDSAFEVAULT-UPDATE-TEST-PAYLOAD"
    exe, digest = make_release_file(tmp, payload)
    rc = make_release.main(["--exe", str(exe), "--version", "1.2.0", "--root", str(root),
                            "--no-latest", "--notes", "只登记"])
    check(rc == 0, "make_release --no-latest returned 0")
    config = json.loads((root / "versions.json").read_text(encoding="utf-8"))
    check(config["latest"] == "1.0.0", "--no-latest keeps the declared latest")
    check([r["version"] for r in config["releases"]] == ["1.2.0", "1.0.0", "0.9.0"],
          "releases stay sorted newest first")
    make_release.main(["--exe", str(exe), "--version", "1.2.0", "--root", str(root),
                       "--notes", "同版本覆盖"])
    config = json.loads((root / "versions.json").read_text(encoding="utf-8"))
    check(len(config["releases"]) == 3, "re-registering a version replaces it")
    check(config["releases"][0]["notes"] == "同版本覆盖", "the newer note wins")
    check(digest == config["releases"][0]["sha256"], "digest is stable")

    httpd, port = serve_until_ready(root, tmp)
    try:
        info = updater.check(f"http://127.0.0.1:{port}/", current="0.1.0")
        check(info["version"] == "1.2.0", "the newest usable release wins")
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_apply(tmp: Path) -> None:
    print("[4] replacing the running binary")
    folder = tmp / "app"
    folder.mkdir()
    target = folder / "MedSafeVault.exe"
    target.write_bytes(b"OLD-BINARY")
    new = tmp / "downloaded.exe"
    new.write_bytes(b"NEW-BINARY-BIGGER")

    check(updater._swappable(target) is True, "a free file can be renamed")
    check(updater._swappable(tmp / "not-here.exe") is True, "a missing target is swappable")
    check(sorted(p.name for p in folder.iterdir()) == ["MedSafeVault.exe"],
          "the probe leaves nothing behind")

    # The retry loop: the name only frees up after two probes.
    real_swappable = updater._swappable
    probes = {"n": 0}

    def flaky(_path: Path) -> bool:
        probes["n"] += 1
        return probes["n"] > 2

    updater._swappable = flaky
    try:
        started = time.time()
        updater.wait_for_release(target, pid=0, timeout=10.0)
        check(probes["n"] >= 3, f"wait_for_release retried ({probes['n']} probes)")
        check(time.time() - started < 5, "it returns as soon as the name frees up")
        updater._swappable = lambda _path: False
        expect_error(lambda: updater.wait_for_release(target, timeout=1.2), "仍被占用",
                     "a permanently busy name gives up with a clear error")
    finally:
        updater._swappable = real_swappable

    result = updater.apply_update(new, target, wait_pid=0, timeout=5.0)
    check(target.read_bytes() == b"NEW-BINARY-BIGGER", "target now carries the new build")
    check((folder / "MedSafeVault.exe.old").read_bytes() == b"OLD-BINARY",
          "the previous build is kept as .old")
    check(not new.exists(), "the downloaded file is consumed")
    check(result["bytes"] == target.stat().st_size, "result reports the size")
    check(not list(folder.glob("*.new")), "no staging file left behind")

    # a second update rotates .old away
    new2 = tmp / "second.exe"
    new2.write_bytes(b"THIRD-BUILD")
    updater.apply_update(new2, target, wait_pid=0, timeout=5.0)
    check(target.read_bytes() == b"THIRD-BUILD", "second replace works")

    # busy target: the helper gives up after the timeout instead of hanging
    busy = tmp / "busy"
    busy.mkdir()
    busy_target = busy / "app.exe"
    busy_target.write_bytes(b"A")
    stall = tmp / "busy.exe"
    stall.write_bytes(b"B")
    updater._swappable = lambda _path: False
    try:
        started = time.time()
        try:
            updater.apply_update(stall, busy_target, wait_pid=0, timeout=1.5)
            raise AssertionError("a busy target must not be replaced")
        except updater.UpdateError as exc:
            check("仍被占用" in str(exc), f"busy target is reported: {exc}")
        check(1.0 <= time.time() - started < 10, "it gives up promptly")
    finally:
        updater._swappable = real_swappable
    check(busy_target.read_bytes() == b"A", "the busy target was left alone")

    # apply_cli path, with relaunch suppressed
    log_dir = tmp / "cli"
    log_dir.mkdir()
    cli_target = log_dir / "MedSafeVault.exe"
    cli_target.write_bytes(b"OLD")
    cli_new = tmp / "cli-new.exe"
    cli_new.write_bytes(b"NEW-VIA-CLI")
    code = updater.apply_cli([str(cli_new), str(cli_target), "0", "--no-relaunch"])
    check(code == 0, "apply_cli exited 0")
    check(cli_target.read_bytes() == b"NEW-VIA-CLI", "apply_cli swapped the binary")
    log_text = (log_dir / "update-apply.log").read_text(encoding="utf-8")
    check("replaced" in log_text, "the helper logged the swap")
    check(updater.apply_cli(["only-one-arg"]) == 2, "apply_cli needs its arguments")


def test_job(tmp: Path) -> None:
    print("[5] job state machine and restart handover")
    root = tmp / "srv2"
    (root / "files").mkdir(parents=True)
    payload = b"JOB-PAYLOAD" * 500
    exe, digest = make_release_file(tmp, payload)
    make_release.main(["--exe", str(exe), "--version", "7.7.7", "--root", str(root)])
    httpd, port = serve_until_ready(root, tmp)
    base = f"http://127.0.0.1:{port}/"
    real_target = updater.target_exe
    updater.target_exe = lambda: tmp / "app" / "MedSafeVault.exe"
    try:
        job = updater.UpdateJob(dest_dir=tmp / "job-dl")
        info = job.check(base)
        check(info["available"] is True, "job found the update")
        check(job.snapshot()["state"] == updater.STATE_IDLE, "job idles after a check")
        expect_error(lambda: job.install_and_restart(), "还没有下载完成",
                     "install before download is refused")
        job.start_download(info)
        deadline = time.time() + 15
        while time.time() < deadline and job.snapshot()["state"] != updater.STATE_READY:
            time.sleep(0.1)
        snap = job.snapshot()
        check(snap["state"] == updater.STATE_READY, f"job reached ready ({snap['error']})")
        check(snap["progress"]["percent"] == 100.0, "job progress hit 100")
        check(snap["ready"] and Path(snap["file"]).is_file(), "job keeps the downloaded file")
        check(str(tmp) in snap["file"], f"the download stayed in the temp dir: {snap['file']}")

        calls: list[tuple] = []
        swaps: list[tuple] = []
        launches: list[tuple] = []
        real_spawn = updater.spawn_apply
        real_apply = updater.apply_update
        real_relaunch = updater.relaunch_process
        updater.spawn_apply = lambda new_file, target, pid=None: calls.append(
            (new_file, target, pid))
        updater.apply_update = lambda new_file, target, **kw: (
            swaps.append((new_file, target)), {"target": str(target), "bytes": 7,
                                               "backup": "x"})[1]
        updater.relaunch_process = lambda target, **kw: launches.append((target,))
        real_target = updater.target_exe
        updater.target_exe = lambda: tmp / "app" / "MedSafeVault.exe"
        try:
            result = job.install_and_restart()
        finally:
            updater.spawn_apply = real_spawn
            updater.apply_update = real_apply
            updater.relaunch_process = real_relaunch
            updater.target_exe = real_target
        check(len(swaps) == 1, "the swap happens in this process")
        check(len(launches) == 1, "the restart is scheduled by the batch")
        check(not calls, "no detached helper is needed on the happy path")
        check(result["version"] == "7.7.7", "restart reports the version")
        check(job.snapshot()["state"] == updater.STATE_RESTARTING, "job says restarting")

        # and when the in-process swap is refused, the helper takes over
        calls2: list[tuple] = []

        def refuse(new_file, target, **kw):
            raise updater.UpdateError("仍被占用")

        updater.apply_update = refuse  # type: ignore
        updater.spawn_apply = lambda new_file, target, pid=None: calls2.append(  # type: ignore
            (new_file, target))
        updater.relaunch_process = lambda target, **kw: None  # type: ignore
        updater.target_exe = lambda: tmp / "app" / "MedSafeVault.exe"  # type: ignore
        try:
            job2 = updater.UpdateJob(dest_dir=tmp / "job-dl")
            job2.check(base)
            job2.state = updater.STATE_READY
            job2.downloaded = Path(swaps[0][0])
            job2.info = job.info
            job2.install_and_restart()
        finally:
            updater.apply_update = real_apply  # type: ignore
            updater.spawn_apply = real_spawn  # type: ignore
            updater.relaunch_process = real_relaunch  # type: ignore
            updater.target_exe = real_target  # type: ignore
        check(len(calls2) == 1, "a refused swap falls back to the detached helper")

        broken = updater.UpdateJob(dest_dir=tmp / "job-bad")
        broken.check(base)
        broken.info = dict(broken.info, sha256="f" * 64)
        broken.start_download(broken.info)
        deadline = time.time() + 15
        while time.time() < deadline and broken.snapshot()["state"] not in (
                updater.STATE_ERROR, updater.STATE_READY):
            time.sleep(0.1)
        check(broken.snapshot()["state"] == updater.STATE_ERROR,
              "a bad digest lands in error")
        check("校验不通过" in broken.snapshot()["error"], "the error text is actionable")
        expect_error(lambda: updater.UpdateJob().check("http://127.0.0.1:1/"),
                     "无法连接", "an unreachable service is reported")
        expect_error(lambda: updater.UpdateJob().check(""), "尚未填写",
                     "an empty URL is reported")
    finally:
        updater.target_exe = real_target
        httpd.shutdown()
        httpd.server_close()


def test_frozen_paths(tmp: Path | None = None) -> None:
    print("[6] spawn arguments and dev mode")
    sandbox = tmp or Path(tempfile.mkdtemp(prefix="msv-update-cmd-"))
    calls: list[list] = []
    real = updater.subprocess.Popen
    updater.subprocess.Popen = lambda args, **kwargs: calls.append(list(args))  # type: ignore
    try:
        new_file, target = Path("/tmp/new.exe"), Path("/tmp/app.exe")
        updater.spawn_apply(new_file, target, pid=4242)
        check(calls and calls[0][:4] == [sys.executable, "--apply-update",
                                         str(new_file), str(target)],
              f"helper argv: {calls[0]}")
        check(calls[0][4] == "4242", "the old pid is handed over")
    finally:
        updater.subprocess.Popen = real  # type: ignore
    os.environ["_MEIPASS2"] = "C:\\Users\\x\\AppData\\Local\\Temp\\_MEI000000fake"
    # PyInstaller 6 还会给子进程留下这几组变量；孙进程继承后会以为已经解包，
    # 去父进程已经删掉的 _MEIxxxxx 里加载 python313.dll，弹「Failed to load Python DLL」。
    os.environ["_MEIPASS"] = os.environ["_MEIPASS2"]
    os.environ["_PYI_APPLICATION_HOME_DIR"] = os.environ["_MEIPASS2"]
    os.environ["_PYI_PARENT_PROCESS_LEVEL"] = "1"
    os.environ["_PYI_ARCHIVE_FILE"] = "C:\\Users\\x\\MedSafeVault.exe"
    os.environ["_PYI_SPLASH_IPC"] = "0"
    os.environ["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
    os.environ["MSV_PROBE_KEEP"] = "kept"
    os.environ["MSV_DEBUG"] = "1"
    os.environ["MSV_DEBUG_PORT"] = "9248"
    try:
        env = updater.launch_env()
        leaked = sorted(key for key in env if key.startswith(("_PYI", "_MEI")))
        check(not leaked, f"no bootloader marker reaches the fresh copy of the exe ({leaked})")
        check("PYINSTALLER_RESET_ENVIRONMENT" not in env,
              "the outer launcher's reset switch is dropped too")
        check("MSV_DEBUG" not in env and "MSV_DEBUG_PORT" not in env,
              "the debug port is not inherited by the relaunched instance")
        check(env.get("MSV_PROBE_KEEP") == "kept", "ordinary variables survive")
    finally:
        for key in ("_MEIPASS2", "_MEIPASS", "_PYI_APPLICATION_HOME_DIR",
                    "_PYI_PARENT_PROCESS_LEVEL", "_PYI_ARCHIVE_FILE", "_PYI_SPLASH_IPC",
                    "PYINSTALLER_RESET_ENVIRONMENT", "MSV_PROBE_KEEP", "MSV_DEBUG",
                    "MSV_DEBUG_PORT"):
            os.environ.pop(key, None)
    check(updater.target_exe() is None, "running from source refuses to self-replace")
    # when frozen, the new instance must not be a child of the updater process
    started: list[list] = []

    class Proc:
        pid = 1

        def wait(self, timeout=None):
            return 0

        def poll(self):
            return None

    def capture_popen(args, **kwargs):
        started.append(list(args))
        return Proc()

    real_popen = updater.subprocess.Popen
    updater.subprocess.Popen = capture_popen  # type: ignore
    updater.sys.frozen = True  # type: ignore[attr-defined]
    fake_target = sandbox / "MedSafeVault.exe"
    try:
        updater.relaunch_process(fake_target)
    finally:
        updater.subprocess.Popen = real_popen  # type: ignore
        del updater.sys.frozen
    check(started and started[0][1:4] == ["--relaunch-after", "4", str(fake_target)],
          f"packaged relaunch hands the delay to a windowed helper copy: {started}")
    check(not (fake_target.parent / "update-relaunch.bat").exists(),
          "no batch file is written next to the exe (no console window)")
    # 助手模式：睡够时间、拉起新 exe、盯着它别立刻退出
    slept: list[float] = []
    real_sleep = updater.time.sleep
    real_popen_second = updater.subprocess.Popen
    second: list[list] = []

    class Alive:
        pid = 4321

        def poll(self):
            return None

    def fake_popen(args, **kwargs):
        second.append(list(args))
        return Alive()

    updater.time.sleep = lambda value: slept.append(value)
    updater.subprocess.Popen = fake_popen  # type: ignore
    import io
    captured = io.StringIO()
    real_stdout = sys.stdout
    sys.stdout = captured
    try:
        code = updater.relaunch_after_cli(["3", str(fake_target)])
    finally:
        sys.stdout = real_stdout
        updater.time.sleep = real_sleep
        updater.subprocess.Popen = real_popen_second  # type: ignore
    check(code == 0 and slept and slept[0] == 3.0, f"helper waits then exits 0 ({slept})")
    check(second and second[0] == [str(fake_target)], f"helper starts the new build: {second}")
    out = captured.getvalue()
    check("waiting 3.0s" in out and "started MedSafeVault.exe" in out,
          "helper writes its steps to the inherited log handle")
    check(updater.relaunch_after_cli(["1"]) == 2, "helper without a target refuses to run")
    expect_error(lambda: updater.UpdateJob().start_download({"version": "1"}),
                 "开发模式", "dev mode cannot install")


def test_wait_for_exit(tmp: Path) -> None:
    print("[7] the helper waits for the old process before relaunching")
    real_alive = updater._process_alive
    calls = {"n": 0}

    def dying(pid: int) -> bool:
        calls["n"] += 1
        return calls["n"] < 3

    updater._process_alive = dying
    try:
        check(updater.wait_for_exit(4321, timeout=10.0) is True,
              "wait_for_exit returns once the pid is gone")
        check(calls["n"] >= 3, f"it polled until the process died ({calls['n']} checks)")
        updater._process_alive = lambda pid: True
        check(updater.wait_for_exit(4321, timeout=1.0) is False,
              "a process that never dies times out instead of hanging")
        check(updater.wait_for_exit(0) is True, "no pid means nothing to wait for")
    finally:
        updater._process_alive = real_alive

    # the full handover: swap, wait, relaunch — with the spawn intercepted
    folder = tmp / "handover"
    folder.mkdir()
    target = folder / "MedSafeVault.exe"
    target.write_bytes(b"OLD")
    new = tmp / "handover-new.exe"
    new.write_bytes(b"NEW")
    launched: list[list] = []

    class FakeProcess:
        pid = 987654

        def __init__(self, alive=True, code=None):
            self.alive, self.code = alive, code

        def poll(self):
            return None if self.alive else self.code

        def wait(self, timeout=None):
            return self.code if self.code is not None else 0

    real_popen = updater.subprocess.Popen
    real_alive = updater._process_alive
    alive_calls = {"n": 0}

    def fake_popen(args, **kwargs):
        launched.append(list(args))
        return FakeProcess()

    def alive_once(pid: int) -> bool:
        alive_calls["n"] += 1
        return alive_calls["n"] <= 1

    updater.subprocess.Popen = fake_popen  # type: ignore
    updater._process_alive = alive_once  # type: ignore
    try:
        check(updater.apply_cli([str(new), str(target), "4242"]) == 0,
              "apply_cli completed")
    finally:
        updater.subprocess.Popen = real_popen  # type: ignore
        updater._process_alive = real_alive
    check(target.read_bytes() == b"NEW", "the binary was replaced")
    check(launched and launched[0][0] == str(target), f"relaunched: {launched}")
    check(alive_calls["n"] >= 2, "it checked the old pid before relaunching")
    check((folder / "update-relaunch.log").exists() is False,
          "the development path does not create the relaunch log")

    # a child that dies at once is reported instead of hanging
    class Dead:
        pid = 2

        def poll(self):
            return 3

    real_popen2 = updater.subprocess.Popen
    updater.subprocess.Popen = lambda args, **kwargs: Dead()  # type: ignore
    try:
        expect_error(lambda: updater.relaunch_process(target, settle=0.3),
                     "重启失败", "a relaunch that dies immediately is reported")
    finally:
        updater.subprocess.Popen = real_popen2  # type: ignore


def main() -> None:
    test_versions()
    frozen_dir = Path(tempfile.mkdtemp(prefix="msv-update-frozen-"))
    try:
        test_frozen_paths(frozen_dir)
    finally:
        shutil.rmtree(frozen_dir, ignore_errors=True)
    for name in ("roundtrip", "escape", "apply", "job", "handover"):
        tmp = Path(tempfile.mkdtemp(prefix=f"msv-update-{name}-"))
        try:
            {"roundtrip": test_server_roundtrip, "escape": test_missing_and_escape,
             "apply": test_apply, "job": test_job,
             "handover": test_wait_for_exit}[name](tmp)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    print("\nAll updater checks passed.")


if __name__ == "__main__":
    main()
