"""MedSafeVault application entry point."""
from __future__ import annotations

import ctypes
import logging
import logging.handlers
import os
import sys
import threading
import traceback
from pathlib import Path

import webview

from backend import __version__, paths
from backend.api import Api
from backend.paths import data_dir, log_path, resource_path, web_dir
from backend.store import VaultService
from backend import window_state
from backend.tray import TrayIcon

log = logging.getLogger("medsafe")
_MUTEX_HANDLE = None
_SHOW_EVENT = None
_SHOW_EVENT_NAME = "MedSafeVault.ShowWindow.v2"


def setup_logging() -> None:
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    try:
        handler = logging.handlers.RotatingFileHandler(
            log_path(), maxBytes=1_500_000, backupCount=3, encoding="utf-8"
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    except Exception:
        pass
    console = logging.StreamHandler()
    console.setFormatter(formatter)
    logger.addHandler(console)


def ensure_single_instance() -> bool:
    global _MUTEX_HANDLE
    if os.name != "nt":
        return True
    try:
        kernel32 = ctypes.windll.kernel32
        _MUTEX_HANDLE = kernel32.CreateMutexW(None, False, "MedSafeVault.SingleInstance.v2")
        if kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
            return False
    except Exception:
        return True
    return True


def create_show_event() -> None:
    """Named event that a second launch uses to bring the window back."""
    global _SHOW_EVENT
    if os.name != "nt":
        return
    try:
        _SHOW_EVENT = ctypes.windll.kernel32.CreateEventW(
            None, False, False, _SHOW_EVENT_NAME
        )
    except Exception:
        _SHOW_EVENT = None


def signal_existing_instance() -> bool:
    """Ask the already running copy to show its window (e.g. from the tray)."""
    if os.name != "nt":
        return False
    try:
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenEventW(0x0002, False, _SHOW_EVENT_NAME)  # EVENT_MODIFY_STATE
        if not handle:
            return False
        try:
            return bool(kernel32.SetEvent(handle))
        finally:
            kernel32.CloseHandle(handle)
    except Exception:
        return False


def watch_show_event(window: webview.Window, api: Api) -> None:
    """Background thread: show the hidden window when an event arrives."""
    if not _SHOW_EVENT:
        return

    def loop() -> None:
        try:
            while True:
                result = ctypes.windll.kernel32.WaitForSingleObject(_SHOW_EVENT, 0xFFFFFFFF)
                if result != 0:  # WAIT_OBJECT_0
                    return
                try:
                    api.show_window()
                except Exception:
                    log.debug("show from second instance failed", exc_info=True)
        except Exception:
            log.debug("show-event watcher stopped", exc_info=True)

    threading.Thread(target=loop, name="show-event", daemon=True).start()


def fit_window_to_screen(window: webview.Window) -> None:
    """Shrink the default window when the desktop (or its scale) is smaller.

    1460x930 is comfortable on a 1920x1200 desktop, but at 125% scaling a
    1366x768 laptop only has about 1093x614 to give — the bottom bar would sit
    behind the taskbar. Runs on the start() worker thread, so resize() is safe.
    """
    try:
        screens = webview.screens
    except Exception:
        return
    if not screens:
        return
    screen = screens[0]
    frame = getattr(screen, "frame", None)
    avail_w = int(getattr(frame, "Width", 0) or screen.width)
    avail_h = int(getattr(frame, "Height", 0) or screen.height)
    width = max(1140, min(1460, avail_w - 40))
    height = max(700, min(930, avail_h - 40))
    if width >= 1460 and height >= 930:
        return
    try:
        window.resize(width, height)
        log.info("window resized to %sx%s (screen %sx%s)", width, height, avail_w, avail_h)
    except Exception:
        log.debug("window resize failed", exc_info=True)


def apply_window_geometry(window: webview.Window) -> None:
    """Open where the user left the window last time, or maximized.

    Runs on the start() worker thread once the native handle exists, so the
    placement can be read and set through Win32 in physical pixels. Anything
    that does not clearly fit the current desktop falls back to maximized —
    a window the user cannot see or reach is worse than a maximized one.
    """
    handle = window_state.wait_hwnd(window)
    state = window_state.load()
    kind, rect = window_state.plan(state, handle)
    log.info("window geometry: handle=%s plan=%s rect=%s saved=%s", handle, kind, rect, state)
    if kind == "restore" and rect:
        window_state.apply(handle, rect)
        return
    if kind == "restore":
        # Non-Windows dev fallback: nothing to plan from, keep the default size.
        fit_window_to_screen(window)
        return
    window_state.maximize(handle)
    log.info("window opened maximized (%s)", "first run" if not state else "saved state")


def message_box(title: str, text: str, error: bool = False) -> None:
    try:
        flags = 0x10 if error else 0x40
        ctypes.windll.user32.MessageBoxW(None, text, title, flags | 0x00040000)
    except Exception:
        print(f"{title}: {text}")


def main() -> int:
    setup_logging()
    log.info("Starting MedSafeVault %s (frozen=%s)", __version__, getattr(sys, "frozen", False))
    log.info("Config file: %s", paths.config_path())
    if not ensure_single_instance():
        if not signal_existing_instance():
            message_box("MedSafeVault", "MedSafeVault 已经在运行中。\n请在任务栏或小图标区中找到已打开的窗口。")
        return 1
    create_show_event()
    try:
        if os.name == "nt":
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("MedSafeVault.App.2")
    except Exception:
        pass
    try:
        location = paths.current_location()
        log.info(
            "Data directory: %s (mode=%s)", location["path"], location["mode"]
        )
        data_dir().mkdir(parents=True, exist_ok=True)
    except paths.LocationError as exc:
        message_box("MedSafeVault 启动失败", f"{exc}\n\n配置文件：{paths.config_path()}", error=True)
        return 1

    index = web_dir() / "index.html"
    dev_url = os.environ.get("MSV_DEV_URL", "").strip()
    if not dev_url and not index.exists():
        message_box(
            "MedSafeVault 启动失败",
            f"未找到前端资源：\n{index}\n\n请先在 web 目录执行 npm run build。",
            error=True,
        )
        return 1

    service = VaultService()
    api = Api(service)
    icon_path = resource_path("assets/app.ico")
    debug = os.environ.get("MSV_DEBUG", "").strip() in ("1", "true", "yes")
    if debug:
        # Dev only: expose the WebView2 inspector so UI tests can drive the
        # real window over CDP (MSV_DEBUG_PORT defaults to 9222).
        try:
            webview.settings["REMOTE_DEBUGGING_PORT"] = int(
                os.environ.get("MSV_DEBUG_PORT", "9222")
            )
            # The inspector window would cover the app during screenshot tests.
            webview.settings["OPEN_DEVTOOLS_IN_DEBUG"] = False
        except (KeyError, ValueError):
            log.warning("invalid MSV_DEBUG_PORT, remote debugging stays off")

    # pywebview 6 keeps the serving/storage options on start(); create_window()
    # only takes window geometry, behaviour and the js_api bridge.
    # First run opens maximized; later runs reopen at the last closed position
    # (applied in apply_window_geometry once the native handle exists).
    first_run = window_state.load() is None
    window = webview.create_window(
        "MedSafeVault · 医安密管平台",
        url=dev_url or str(index),
        js_api=api,
        width=1460,
        height=930,
        maximized=first_run,
        min_size=(1140, 700),
        background_color="#0a0e17",
        text_select=True,
        confirm_close=False,
    )
    if window is None:
        message_box("MedSafeVault 启动失败", "无法创建应用窗口。", error=True)
        return 1
    api._attach(window)
    window.events.closing += lambda: api.on_window_closing()

    tray = None
    try:
        tray = TrayIcon(
            str(icon_path) if icon_path.exists() else "",
            api.show_window,
            api.tray_lock,
            api.tray_quit,
        )
        tray.start()
        api._attach_tray(tray)
    except Exception:
        log.exception("Tray icon is unavailable; the close button will quit instead")
        tray = None
    watch_show_event(window, api)

    try:
        webview.start(
            func=apply_window_geometry,
            args=(window,),
            debug=debug,
            http_server=not dev_url,
            private_mode=False,
            storage_path=str(data_dir() / "webview"),
            icon=str(icon_path) if icon_path.exists() else None,
        )
    except Exception:
        log.exception("Fatal error in GUI loop")
        traceback.print_exc()
        message_box("MedSafeVault 运行错误", traceback.format_exc(), error=True)
        return 1
    finally:
        if tray is not None:
            tray.stop()
        service.close()
        close_file_logging()
        finish_location_move()
    return 0


def close_file_logging() -> None:
    """Release app.log so the old data directory can be renamed on exit."""
    for handler in list(logging.getLogger().handlers):
        if isinstance(handler, logging.FileHandler):
            try:
                handler.flush()
                handler.close()
            except Exception:
                pass
            logging.getLogger().removeHandler(handler)


def finish_location_move() -> None:
    """Apply a pending data-directory change now that the database is closed."""
    try:
        report = paths.apply_location_request()
    except Exception:  # pragma: no cover - defensive
        log.exception("Data directory move crashed")
        return
    if not report.get("moved"):
        if report.get("error"):
            log.error("%s", report["error"])
            message_box("MedSafeVault 数据目录未移动", str(report["error"]), error=True)
        return
    log.info("Data directory moved from %s to %s", report.get("from"), report.get("to"))
    text = f"数据目录已移动到：\n{report.get('to')}"
    if report.get("archived"):
        text += f"\n\n原目录已保留为：\n{report['archived']}\n确认无误后可以删除。"
    if report.get("warning"):
        text += f"\n\n注意：{report['warning']}"
    message_box("MedSafeVault 数据目录已更新", text)


if __name__ == "__main__":
    raise SystemExit(main())
