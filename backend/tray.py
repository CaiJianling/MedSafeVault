"""System tray icon for "minimize to the notification area"."""
from __future__ import annotations

import logging
import os

log = logging.getLogger(__name__)


def _load_image(icon_path: str):
    from PIL import Image, ImageDraw

    try:
        if icon_path and os.path.isfile(icon_path):
            return Image.open(icon_path)
    except Exception:
        log.debug("could not load tray icon", exc_info=True)
    # Fallback: a simple shield so the tray still works without assets.
    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.polygon(
        [(32, 4), (58, 14), (58, 30), (32, 60), (6, 30), (6, 14)],
        fill=(20, 184, 166, 255),
    )
    draw.polygon(
        [(32, 12), (50, 19), (50, 30), (32, 49), (14, 30), (14, 19)],
        fill=(9, 15, 24, 255),
    )
    return image


class TrayIcon:
    """Thin wrapper around pystray; all callbacks run on the tray thread."""

    def __init__(self, icon_path: str, on_open, on_lock, on_quit) -> None:
        import pystray

        self._icon = pystray.Icon(
            "MedSafeVault",
            _load_image(icon_path),
            "MedSafeVault · 医安密管平台",
            pystray.Menu(
                pystray.MenuItem("打开主界面", lambda _icon, _item: on_open(), default=True),
                pystray.MenuItem("锁定密码库", lambda _icon, _item: on_lock()),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("退出 MedSafeVault", lambda _icon, _item: on_quit()),
            ),
        )

    def start(self) -> None:
        self._icon.run_detached()

    def stop(self) -> None:
        try:
            self._icon.stop()
        except Exception:
            log.debug("stopping tray icon failed", exc_info=True)
