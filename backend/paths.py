"""Filesystem helpers that work both in development and in a PyInstaller bundle."""
from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "MedSafeVault"


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def project_root() -> Path:
    if is_frozen():
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent.parent


def resource_path(relative: str) -> Path:
    """Locate a bundled read-only resource (web assets, icons...)."""
    return project_root() / relative


def data_dir() -> Path:
    """Writable application data directory (never next to the exe by default)."""
    override = os.environ.get("MEDSAFE_DATA_DIR", "").strip()
    if override:
        path = Path(override).expanduser()
    else:
        base = os.environ.get("APPDATA") or os.environ.get("LOCALAPPDATA")
        if base:
            path = Path(base) / APP_NAME
        else:
            path = Path.home() / f".{APP_NAME.lower()}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def db_path() -> Path:
    return data_dir() / "vault.db"


def log_path() -> Path:
    return data_dir() / "app.log"


def web_dir() -> Path:
    return resource_path("web/dist")
