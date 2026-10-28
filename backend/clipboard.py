"""Clipboard helpers with optional auto-clear (Windows)."""
from __future__ import annotations

import logging
import threading
import time

log = logging.getLogger(__name__)

try:  # pragma: no cover - platform specific
    import ctypes
    from ctypes import wintypes

    _user32 = ctypes.WinDLL("user32", use_last_error=True)
    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _user32.OpenClipboard.argtypes = [wintypes.HWND]
    _user32.OpenClipboard.restype = wintypes.BOOL
    _user32.CloseClipboard.restype = wintypes.BOOL
    _user32.EmptyClipboard.restype = wintypes.BOOL
    _user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
    _user32.SetClipboardData.restype = wintypes.HANDLE
    _user32.GetClipboardData.argtypes = [wintypes.UINT]
    _user32.GetClipboardData.restype = wintypes.HANDLE
    _kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    _kernel32.GlobalAlloc.restype = wintypes.HANDLE
    _kernel32.GlobalLock.argtypes = [wintypes.HANDLE]
    _kernel32.GlobalLock.restype = ctypes.c_void_p
    _kernel32.GlobalUnlock.argtypes = [wintypes.HANDLE]
    _kernel32.GlobalFree.argtypes = [wintypes.HANDLE]
    _HAS_WIN32 = True
except Exception:  # pragma: no cover
    _HAS_WIN32 = False

CF_UNICODETEXT = 13
GMEM_MOVEABLE = 0x0002
GMEM_ZEROINIT = 0x0040


def _open_clipboard() -> bool:
    for _ in range(20):
        if _user32.OpenClipboard(None):
            return True
        time.sleep(0.03)
    return False


def set_text(text: str) -> bool:
    if not _HAS_WIN32:
        return False
    if not _open_clipboard():
        log.warning("Could not open clipboard")
        return False
    try:
        _user32.EmptyClipboard()
        payload = (text or "").encode("utf-16-le") + b"\x00\x00"
        handle = _kernel32.GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, len(payload))
        if not handle:
            return False
        pointer = _kernel32.GlobalLock(handle)
        if not pointer:
            _kernel32.GlobalFree(handle)
            return False
        try:
            ctypes.memmove(pointer, payload, len(payload))
        finally:
            _kernel32.GlobalUnlock(handle)
        if not _user32.SetClipboardData(CF_UNICODETEXT, handle):
            _kernel32.GlobalFree(handle)
            return False
        return True
    finally:
        _user32.CloseClipboard()


def get_text() -> str:
    if not _HAS_WIN32:
        return ""
    if not _open_clipboard():
        return ""
    try:
        handle = _user32.GetClipboardData(CF_UNICODETEXT)
        if not handle:
            return ""
        pointer = _kernel32.GlobalLock(handle)
        if not pointer:
            return ""
        try:
            return ctypes.wstring_at(pointer)
        finally:
            _kernel32.GlobalUnlock(handle)
    finally:
        _user32.CloseClipboard()


def copy_with_autoclear(text: str, seconds: int = 30) -> None:
    if not set_text(text):
        raise RuntimeError("无法写入剪贴板")
    if seconds <= 0 or not text:
        return

    def clear_later() -> None:
        time.sleep(seconds)
        try:
            if get_text() == text:
                set_text("")
        except Exception:
            pass

    threading.Thread(target=clear_later, daemon=True).start()
