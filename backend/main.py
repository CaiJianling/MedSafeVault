"""MedSafeVault application entry point."""
from __future__ import annotations

import ctypes
import logging
import logging.handlers
import os
import sys
import traceback
from pathlib import Path

import webview

from backend import __version__
from backend.api import Api
from backend.paths import data_dir, log_path, resource_path, web_dir
from backend.store import VaultService

log = logging.getLogger("medsafe")
_MUTEX_HANDLE = None


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


def message_box(title: str, text: str, error: bool = False) -> None:
    try:
        flags = 0x10 if error else 0x40
        ctypes.windll.user32.MessageBoxW(None, text, title, flags | 0x00040000)
    except Exception:
        print(f"{title}: {text}")


def main() -> int:
    setup_logging()
    log.info("Starting MedSafeVault %s (frozen=%s)", __version__, getattr(sys, "frozen", False))
    if not ensure_single_instance():
        message_box("MedSafeVault", "MedSafeVault 已经在运行中。\n请在任务栏中找到已打开的窗口。")
        return 1
    try:
        if os.name == "nt":
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("MedSafeVault.App.2")
    except Exception:
        pass
    data_dir().mkdir(parents=True, exist_ok=True)

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

    # pywebview 6 keeps the serving/storage options on start(); create_window()
    # only takes window geometry, behaviour and the js_api bridge.
    window = webview.create_window(
        "MedSafeVault · 医安密管平台",
        url=dev_url or str(index),
        js_api=api,
        width=1460,
        height=930,
        min_size=(1140, 700),
        background_color="#0a0e17",
        text_select=True,
        confirm_close=False,
    )
    if window is None:
        message_box("MedSafeVault 启动失败", "无法创建应用窗口。", error=True)
        return 1
    api._attach(window)
    try:
        webview.start(
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
        service.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
