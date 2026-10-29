"""Check the window placement rules without opening a real window.

    python tools/test_window_state.py

backend/window_state.py decides between "reopen where it was" and "open
maximized". The decision only needs the saved JSON and the current desktop
metrics, so the monitor calls are faked here and every branch can be covered.
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import window_state  # noqa: E402

FAILURES: list[str] = []


def check(name: str, got, want) -> None:
    if got == want:
        print(f"  ok  {name}")
    else:
        print(f"  FAIL {name}: got {got!r}, want {want!r}")
        FAILURES.append(name)


class fake_desktop:
    """Patch the Win32 lookups used by plan().

    `monitors` is either one (monitor, work) pair or a list of
    (monitor_rect, pair) for a multi-screen desk; the pair matching the saved
    rectangle's centre is the one plan() has to pick.
    """

    def __init__(self, monitor, work, scale=1.0, extra=None):
        self.monitor = monitor
        self.work = work
        self.scale = scale
        self.extra = extra or []

    def _pick(self, x, y):
        for rect, pair in self.extra:
            if rect[0] <= x < rect[0] + rect[2] and rect[1] <= y < rect[1] + rect[3]:
                return pair
        return (self.monitor, self.work)

    def __enter__(self):
        self._enabled = window_state.enabled
        self._monitor = window_state._monitor_info
        self._orig_for_point = window_state._monitor_for_point
        self._dpi = window_state.dpi_scale
        window_state.enabled = lambda: True
        window_state._monitor_info = lambda handle: (self.monitor, self.work)
        window_state._monitor_for_point = self._pick
        window_state.dpi_scale = lambda handle: self.scale
        return self

    def __exit__(self, *exc):
        window_state.enabled = self._enabled
        window_state._monitor_info = self._monitor
        window_state._monitor_for_point = self._orig_for_point
        window_state.dpi_scale = self._dpi
        return False


def state(**overrides):
    base = {
        "x": 120,
        "y": 90,
        "width": 1460,
        "height": 930,
        "maximized": False,
        "resolution": [1920, 1080],
    }
    base.update(overrides)
    return base


FULL = (0, 0, 1920, 1080)
WORK = (0, 0, 1920, 1040)  # 40px taskbar


def main() -> int:
    print("[1] first start opens maximized")
    with fake_desktop(FULL, WORK):
        check("no saved state", window_state.plan(None, 1)[0], "maximize")

    print("[2] saved state is replayed")
    with fake_desktop(FULL, WORK):
        kind, rect = window_state.plan(state(), 1)
        check("restore", kind, "restore")
        check("bounds", rect, (120, 90, 1460, 930))
    with fake_desktop(FULL, WORK):
        check("was maximized", window_state.plan(state(maximized=True), 1)[0], "maximize")

    print("[3] different desktop resolution falls back to maximized")
    with fake_desktop((0, 0, 1366, 768), (0, 0, 1366, 728)):
        check("smaller monitor", window_state.plan(state(), 1)[0], "maximize")

    print("[4] saved coordinates off screen fall back to maximized")
    with fake_desktop(FULL, WORK):
        check("far right", window_state.plan(state(x=2600), 1)[0], "maximize")
        check("below taskbar", window_state.plan(state(y=1500), 1)[0], "maximize")
        check("negative corner", window_state.plan(state(x=-1500, y=-900), 1)[0], "maximize")
    with fake_desktop((-1920, 0, 1920, 1080), (-1920, 0, 1920, 1040)):
        # Left-hand second monitor: a saved position on the primary only shows a
        # sliver, which counts as unreachable.
        check("barely visible", window_state.plan(state(x=1880), 1)[0], "maximize")

    print("[5] restored window stays inside the work area")
    with fake_desktop(FULL, WORK):
        # Bottom-right corner hangs 300px past both edges: shrink and slide in.
        kind, rect = window_state.plan(state(x=1700, y=850), 1)
        check("kept as restore", kind, "restore")
        check("clamped", rect, (460, 110, 1460, 930))
    with fake_desktop((0, 0, 1366, 768), (0, 0, 1366, 728)):
        # Same resolution recorded, but a smaller work area than the window.
        kind, rect = window_state.plan(state(resolution=[1366, 768]), 1)
        check("small desktop restore", kind, "restore")
        check("fits work area", (rect[2], rect[3]), (1366, 728))
        check("inside", (rect[0] >= 0 and rect[1] >= 0), True)

    print("[5b] minimum window size is respected at 125% scaling")
    # 1140x700 logical minimum == 1425x875 physical at 125%.
    with fake_desktop(FULL, WORK, scale=1.25):
        kind, rect = window_state.plan(state(x=1840, y=960, width=1200, height=700), 1)
        check("restored", kind, "restore")
        check("grown to the minimum", rect[2:], (1425, 875))
        check("still inside the work area", (rect[0] + rect[2] <= 1920 and rect[1] + rect[3] <= 1040), True)
        check("top-left moved in", rect[:2], (495, 165))
    with fake_desktop((0, 0, 1280, 1024), (0, 0, 1280, 984), scale=1.0):
        # Work area narrower than the minimum: the screen wins, the window may
        # be clipped by WinForms but never pushed off screen.
        kind, rect = window_state.plan(state(width=1460, height=930, resolution=[1280, 1024]), 1)
        check("narrow desktop restore", kind, "restore")
        check("width capped by work area", rect[2], 1280)

    print("[5c] two screens: the saved monitor wins")
    second_rect = (1920, 0, 2560, 1440)
    second = (second_rect, (second_rect, (1920, 0, 2560, 1400)))
    with fake_desktop(FULL, WORK, extra=[second]):
        kind, rect = window_state.plan(
            state(x=2100, y=200, width=1400, height=900, resolution=[2560, 1440]), 1
        )
        check("restores on the second screen", kind, "restore")
        check("keeps the saved corner", rect, (2100, 200, 1400, 900))
    with fake_desktop(FULL, WORK):
        # The second screen is gone: the saved resolution no longer matches.
        check("screen unplugged -> maximize",
              window_state.plan(state(x=2100, y=200, width=1400, height=900,
                                     resolution=[2560, 1440]), 1)[0],
              "maximize")

    print("[6] broken records are ignored")
    with fake_desktop(FULL, WORK):
        check("garbage", window_state.plan({"x": "abc"}, 1)[0], "maximize")
        check("no size", window_state.plan({"width": 0, "height": 0, "resolution": [1920, 1080]}, 1)[0], "maximize")
        check("no resolution", window_state.plan({"x": 0, "y": 0, "width": 800, "height": 600}, 1)[0], "maximize")

    print("[7] state file round-trip")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "window.json"
        original_path = window_state.state_path
        window_state.state_path = lambda: path
        try:
            check("missing file", window_state.load(), None)
            window_state.save(state())
            check("written", json.loads(path.read_text(encoding="utf-8"))["width"], 1460)
            check("read back", window_state.load()["x"], 120)
            path.write_text("{not json", encoding="utf-8")
            check("unreadable file", window_state.load(), None)
        finally:
            window_state.state_path = original_path

    print()
    if FAILURES:
        print(f"{len(FAILURES)} check(s) failed: {', '.join(FAILURES)}")
        return 1
    print("All window-state checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
