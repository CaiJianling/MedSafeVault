"""Remember where the main window sat when the user last closed the app.

Rules (from the hospital pilot feedback):

* first start  -> open maximized;
* every later start -> reopen at the position and size the window had when it
  was last closed (that includes "was maximized");
* if the monitor resolution differs from the one recorded at close time, or the
  saved coordinates no longer fit on screen, fall back to maximized so the
  window is never invisible or half off the desktop;
* the restored rectangle is clamped into the monitor work area, so no content
  can end up outside the screen or under the taskbar.

Everything is stored in physical pixels straight from Win32, which avoids the
DPI round-trip the pywebview helpers do. Coordinates come from
``GetWindowPlacement``: its ``rcNormalPosition`` is the *restore* bounds, so a
maximized window still records the size it would go back to.

The state lives in ``<data dir>/window.json`` next to the vault; it is plain UI
state, never encrypted, and holds no secrets.
"""
from __future__ import annotations

import ctypes
import json
import logging
import os
import time
from pathlib import Path

from backend.paths import data_dir

log = logging.getLogger("medsafe")

STATE_FILE = "window.json"

# How much of the window must still overlap the work area for the saved
# position to count as "visible"; anything less and we open maximized instead.
MIN_VISIBLE = 60

# Matches create_window(min_size=...) in main.py; the restored rectangle can
# never be smaller than this, so the clamp has to plan for it.
MIN_LOGICAL = (1140, 700)

SW_SHOWNORMAL = 1
SW_SHOWMAXIMIZED = 3
MONITOR_DEFAULTTONEAREST = 2
SM_CXSCREEN = 0
SM_CYSCREEN = 1
SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010
SWP_FRAMECHANGED = 0x0020


class _RECT(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


class _POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


class _WINDOWPLACEMENT(ctypes.Structure):
    _fields_ = [
        ("length", ctypes.c_uint),
        ("flags", ctypes.c_uint),
        ("showCmd", ctypes.c_uint),
        ("ptMinTrackSize", _POINT),
        ("ptMaxTrackSize", _POINT),
        ("rcNormalPosition", _RECT),
    ]


class _MONITORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", ctypes.c_uint),
        ("rcMonitor", _RECT),
        ("rcWork", _RECT),
        ("dwFlags", ctypes.c_uint),
    ]


def enabled() -> bool:
    return os.name == "nt"


def hwnd_of(window) -> int | None:
    """Native handle of a pywebview window (WinForms keeps it on .native)."""
    native = getattr(window, "native", None)
    handle = getattr(native, "Handle", None)
    if handle is None:
        return None
    try:
        return int(handle.ToInt32())
    except Exception:
        try:
            return int(handle)
        except Exception:
            return None


def wait_hwnd(window, timeout: float = 10.0) -> int | None:
    """pywebview assigns .native while the form is being built; wait for it."""
    try:
        window.events.shown.wait(min(timeout, 15))
    except Exception:
        pass
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        handle = hwnd_of(window)
        if handle:
            return handle
        time.sleep(0.1)
    return hwnd_of(window)


# --------------------------------------------------------------------- file
def state_path() -> Path:
    return data_dir() / STATE_FILE


def load() -> dict | None:
    try:
        path = state_path()
        if not path.exists():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        log.debug("window state unreadable", exc_info=True)
        return None


def save(state: dict) -> None:
    try:
        path = state_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, path)
    except Exception:
        log.debug("window state not saved", exc_info=True)


# ------------------------------------------------------------------- win32
def _monitor_info(handle: int | None) -> tuple[tuple[int, int], tuple[int, int]] | None:
    """Return ((monitor left, top, w, h), (work left, top, w, h)) in px."""
    user32 = ctypes.windll.user32
    info = _MONITORINFO()
    info.cbSize = ctypes.sizeof(info)
    if handle:
        monitor = user32.MonitorFromWindow(handle, MONITOR_DEFAULTTONEAREST)
    else:
        monitor = user32.MonitorFromPoint(_POINT(0, 0), MONITOR_DEFAULTTONEAREST)
    if not monitor or not user32.GetMonitorInfoW(monitor, ctypes.byref(info)):
        return None
    mon, work = info.rcMonitor, info.rcWork
    return (
        (mon.left, mon.top, mon.right - mon.left, mon.bottom - mon.top),
        (work.left, work.top, work.right - work.left, work.bottom - work.top),
    )


def _monitor_for_point(x: int, y: int) -> tuple[tuple[int, int], tuple[int, int]] | None:
    """Metrics of the monitor that owns a desktop point (multi-monitor safe)."""
    try:
        user32 = ctypes.windll.user32
        info = _MONITORINFO()
        info.cbSize = ctypes.sizeof(info)
        monitor = user32.MonitorFromPoint(_POINT(int(x), int(y)), MONITOR_DEFAULTTONEAREST)
        if not monitor or not user32.GetMonitorInfoW(monitor, ctypes.byref(info)):
            return None
        mon, work = info.rcMonitor, info.rcWork
        return (
            (mon.left, mon.top, mon.right - mon.left, mon.bottom - mon.top),
            (work.left, work.top, work.right - work.left, work.bottom - work.top),
        )
    except Exception:
        return None


def _primary_resolution() -> tuple[int, int] | None:
    try:
        user32 = ctypes.windll.user32
        return (user32.GetSystemMetrics(SM_CXSCREEN), user32.GetSystemMetrics(SM_CYSCREEN))
    except Exception:
        return None


def dpi_scale(handle: int | None) -> float:
    """Pixels-per-logical-pixel for the window (1.0 at 96 DPI, 1.25 at 125%).

    GetDpiForWindow is Win10 1607+, GetDpiForSystem is Win10; both are missing
    on Win7, where the display DC is the only source. Everything is wrapped so
    a missing entry point just falls through to the next option.
    """
    user32 = ctypes.windll.user32
    dpi = 0
    if handle:
        try:
            dpi = int(user32.GetDpiForWindow(int(handle), 0))
        except Exception:
            dpi = 0
    if not dpi:
        try:
            dpi = int(user32.GetDpiForSystem())
        except Exception:
            dpi = 0
    if not dpi:
        try:
            gdi32 = ctypes.windll.gdi32
            hdc = gdi32.CreateDCW("DISPLAY", None, None, None)
            try:
                dpi = int(gdi32.GetDeviceCaps(hdc, 88))  # LOGPIXELSX
            finally:
                gdi32.DeleteDC(hdc)
        except Exception:
            dpi = 0
    return (dpi or 96) / 96.0


def capture(handle: int | None) -> dict | None:
    """Snapshot the window's restore bounds plus the monitor it lives on."""
    if not enabled() or not handle:
        return None
    try:
        placement = _WINDOWPLACEMENT()
        placement.length = ctypes.sizeof(placement)
        if not ctypes.windll.user32.GetWindowPlacement(handle, ctypes.byref(placement)):
            return None
        rect = placement.rcNormalPosition
        width = rect.right - rect.left
        height = rect.bottom - rect.top
        if width <= 0 or height <= 0:
            return None
        monitors = _monitor_info(handle)
        resolution = monitors[0][2:] if monitors else _primary_resolution()
        if not resolution:
            return None
        return {
            "x": int(rect.left),
            "y": int(rect.top),
            "width": int(width),
            "height": int(height),
            "maximized": placement.showCmd == SW_SHOWMAXIMIZED,
            "resolution": [int(resolution[0]), int(resolution[1])],
        }
    except Exception:
        log.debug("window state capture failed", exc_info=True)
        return None


def plan(state: dict | None, handle: int | None) -> tuple[str, tuple[int, int, int, int] | None]:
    """Decide how to open: ("maximize", None) or ("restore", (x, y, w, h))."""
    if not enabled():
        return ("restore", None)
    if not state:
        return ("maximize", None)
    if state.get("maximized"):
        return ("maximize", None)
    try:
        x, y = int(state["x"]), int(state["y"])
        w, h = int(state["width"]), int(state["height"])
    except (KeyError, TypeError, ValueError):
        return ("maximize", None)
    if w <= 0 or h <= 0:
        return ("maximize", None)
    saved_res = state.get("resolution")
    if not isinstance(saved_res, (list, tuple)) or len(saved_res) != 2:
        return ("maximize", None)
    # Judge the saved rectangle against the monitor it claims to sit on, so a
    # two-screen desk restores on the right one instead of snapping back.
    monitors = _monitor_for_point(x + w // 2, y + h // 2) or _monitor_info(handle)
    if not monitors:
        return ("maximize", None)
    mon, work = monitors
    work_left, work_top, work_w, work_h = work
    resolution = mon[2:]
    if (int(saved_res[0]), int(saved_res[1])) != (int(resolution[0]), int(resolution[1])):
        # Different monitor/desktop resolution than at close time.
        return ("maximize", None)
    # The saved rectangle has to overlap the work area enough to be reachable.
    overlap_x = min(x + w, work_left + work_w) - max(x, work_left)
    overlap_y = min(y + h, work_top + work_h) - max(y, work_top)
    if overlap_x < MIN_VISIBLE or overlap_y < MIN_VISIBLE:
        return ("maximize", None)
    # Keep the whole window on screen: honour the minimum size first, then
    # shrink to the work area, then slide the rectangle inside it.
    scale = dpi_scale(handle)
    min_w = int(MIN_LOGICAL[0] * scale)
    min_h = int(MIN_LOGICAL[1] * scale)
    w = min(max(w, min_w), work_w)
    h = min(max(h, min_h), work_h)
    x = max(work_left, min(x, work_left + work_w - w))
    y = max(work_top, min(y, work_top + work_h - h))
    return ("restore", (x, y, w, h))


def apply(handle: int | None, rect: tuple[int, int, int, int]) -> None:
    if not enabled() or not handle:
        return
    x, y, w, h = rect
    try:
        ctypes.windll.user32.SetWindowPos(
            handle, 0, int(x), int(y), int(w), int(h),
            SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        )
        log.info("window restored to %sx%s at %s,%s", w, h, x, y)
    except Exception:
        log.debug("window restore bounds failed", exc_info=True)


def maximize(handle: int | None) -> None:
    if not enabled() or not handle:
        return
    try:
        ctypes.windll.user32.ShowWindow(handle, SW_SHOWMAXIMIZED)
    except Exception:
        log.debug("window maximize failed", exc_info=True)


def remember(window) -> None:
    """Persist the current window placement (called on closing/hiding)."""
    if not enabled():
        return
    handle = hwnd_of(window)
    state = capture(handle)
    if state:
        save(state)
        log.info("window placement saved: %s", state)
    else:
        log.info("window placement not saved (handle=%s window=%s)", handle, window)
