"""Where MedSafeVault keeps its files — and how that location is changed.

Layout of responsibilities
--------------------------
``app_dir()``      Folder holding the executable (the repository when running
                   from source). The location config lives here.
``config_path()``  ``<app_dir>/MedSafeVault.json``, created on first start.
``data_dir()``     The vault folder: database, log, backups, browser profile.

The config decides which data directory is used::

    {
      "version": 1,
      "data_location": {"mode": "appdata" | "portable" | "custom", "path": "..."},
      "pending_location": {"mode": "...", "path": "...", "requested_at": "..."}
    }

``MEDSAFE_DATA_DIR`` always wins over the config so tests and scripted
deployments stay predictable; while it is set the config is never rewritten.

A location change is only applied on purpose: the UI stores it as
``pending_location`` and :func:`apply_location_request` runs while the app is
shutting down, after the database connection is closed. The copy is verified
(SQLite integrity check on the *new* file) before the config is repointed, and
the old folder is renamed instead of deleted, so an interrupted move can never
destroy the only copy of the vault.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

log = logging.getLogger(__name__)

APP_NAME = "MedSafeVault"
CONFIG_NAME = "MedSafeVault.json"
PORTABLE_DIR_NAME = "MedSafeVaultData"
CONFIG_VERSION = 1

MODES = ("appdata", "portable", "custom")
# The WebView2 profile is a browser cache: re-creating it is cheaper and safer
# than copying hundreds of locked files, so it is not migrated.
SKIP_NAMES = {"webview"}


class LocationError(RuntimeError):
    """Raised when a data directory cannot be resolved, validated or moved."""


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def project_root() -> Path:
    if is_frozen():
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent.parent


def resource_path(relative: str) -> Path:
    """Locate a bundled read-only resource (web assets, icons...)."""
    return project_root() / relative


def app_dir() -> Path:
    """Writable folder next to the program; the config file lives here."""
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def default_data_root() -> Path:
    base = os.environ.get("APPDATA") or os.environ.get("LOCALAPPDATA")
    if base:
        return Path(base) / APP_NAME
    return Path.home() / f".{APP_NAME.lower()}"


def portable_data_root() -> Path:
    return app_dir() / PORTABLE_DIR_NAME


def env_override() -> str:
    return os.environ.get("MEDSAFE_DATA_DIR", "").strip()


# ------------------------------------------------------------------- config
_CONFIG_FALLBACK_NAME = "MedSafeVault-location.json"
_config_path_cache: Path | None = None
_config_cache: dict | None = None


def _writable(dir_path: Path) -> bool:
    try:
        dir_path.mkdir(parents=True, exist_ok=True)
        probe = dir_path / ".msv-write-test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return True
    except OSError:
        return False


def config_path() -> Path:
    """``<app dir>/MedSafeVault.json``, or an AppData twin when read-only.

    Installing the exe into ``C:\\Program Files`` is common in hospitals; there
    the program folder cannot be written without elevation, so the same file is
    kept under ``%APPDATA%\\MedSafeVault`` instead. Nothing is ever written to
    the registry.
    """
    global _config_path_cache
    if _config_path_cache is not None:
        return _config_path_cache
    primary = app_dir() / CONFIG_NAME
    if primary.parent.exists() and _writable(primary.parent):
        _config_path_cache = primary
    else:
        fallback_dir = default_data_root()
        fallback_dir.mkdir(parents=True, exist_ok=True)
        _config_path_cache = fallback_dir / _CONFIG_FALLBACK_NAME
        log.warning("Program folder is not writable; config lives at %s", _config_path_cache)
    return _config_path_cache


def read_config() -> dict:
    """Return the config, creating a default file on first start."""
    global _config_cache
    if _config_cache is not None:
        return _config_cache
    path = config_path()
    data: dict | None = None
    if path.exists():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                data = loaded
        except Exception:
            log.exception("Could not read %s; falling back to defaults", path)
    if data is None:
        data = {
            "version": CONFIG_VERSION,
            "data_location": {"mode": "appdata", "path": str(default_data_root())},
        }
        _store(data, path, create=True)
    _config_cache = data
    return data


def _store(data: dict, path: Path, create: bool = False) -> None:
    data.setdefault("version", CONFIG_VERSION)
    if create or not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    global _config_cache
    _config_cache = data


def write_config(data: dict) -> None:
    _store(data, config_path())


# ------------------------------------------------------------- data location
def location_for(mode: str, path: str | None = None) -> Path:
    mode = (mode or "appdata").strip().lower()
    if mode not in MODES:
        raise LocationError("未知的数据目录模式")
    if mode == "appdata":
        return default_data_root()
    if mode == "portable":
        return portable_data_root()
    text = str(path or "").strip()
    if not text:
        raise LocationError("请填写自定义目录的完整路径")
    return resolve_custom(text)


def resolve_custom(text: str) -> Path:
    path = Path(text).expanduser()
    if not path.is_absolute():
        path = (app_dir() / path).resolve()
    return path


def current_location() -> dict:
    """The effective (not pending) location as a plain dict."""
    override = env_override()
    if override:
        return {"mode": "env", "path": str(resolve_custom(override))}
    entry = read_config().get("data_location") or {}
    mode = str(entry.get("mode") or "appdata")
    try:
        path = location_for(mode, entry.get("path"))
    except LocationError:
        mode, path = "appdata", default_data_root()
    return {"mode": mode, "path": str(path)}


def data_dir() -> Path:
    """Writable application data directory; created on demand."""
    entry = current_location()
    path = Path(entry["path"])
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise LocationError(f"无法创建数据目录：{exc}") from exc
    return path


def db_path() -> Path:
    return data_dir() / "vault.db"


def log_path() -> Path:
    return data_dir() / "app.log"


def web_dir() -> Path:
    return resource_path("web/dist")


# ------------------------------------------------------- location requests
def pending_location() -> dict | None:
    entry = read_config().get("pending_location")
    return entry if isinstance(entry, dict) and entry.get("mode") else None


def location_summary() -> dict:
    """Everything the settings page needs to render the data-directory card."""
    current = current_location()
    path = config_path()
    return {
        "mode": current["mode"],
        "path": current["path"],
        "pending": pending_location(),
        "defaults": {
            "appdata": str(default_data_root()),
            "portable": str(portable_data_root()),
        },
        "app_dir": str(app_dir()),
        "config_path": str(path),
        "config_writable": _writable(path.parent),
        "frozen": is_frozen(),
        "env_override": env_override(),
        "size_bytes": directory_size(data_dir()),
    }


def request_location(mode: str, path: str | None = None) -> dict:
    """Validate a new location and remember it for the next shutdown."""
    mode = (mode or "").strip().lower()
    if mode not in MODES:
        raise LocationError("未知的数据目录模式")
    if env_override():
        raise LocationError("当前由环境变量 MEDSAFE_DATA_DIR 指定数据目录，请先取消该变量")
    target = location_for(mode, path)
    if mode == "custom":
        _validate_custom_target(str(target))
    config = read_config()
    try:
        same = target.exists() and target.resolve() == Path(current_location()["path"]).resolve()
    except OSError:
        same = False
    if same:
        # Already there: adopt the requested mode and drop any pending request.
        config.pop("pending_location", None)
        config["data_location"] = {"mode": mode, "path": str(target)}
        write_config(config)
        return {"pending": None, "location": current_location(), "already_there": True}
    # Fail here rather than silently at shutdown: an occupied folder cannot
    # receive the vault, and the user should hear that before closing the app.
    if _has_vault_files(target):
        raise LocationError(f"目标目录里已经有密码库文件，请换一个空目录：{target}")
    config["pending_location"] = {
        "mode": mode,
        "path": str(target),
        "requested_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    write_config(config)
    return {"pending": config["pending_location"], "location": current_location()}


def cancel_location_request() -> dict:
    config = read_config()
    if config.pop("pending_location", None) is not None:
        write_config(config)
    return {"pending": None}


def _validate_custom_target(text: str) -> None:
    target = Path(text)
    if len(str(target)) > 240:
        raise LocationError("目录路径过长，请缩短后重试")
    if any(ch in target.name for ch in '<>:"|?*'):
        raise LocationError("目录名包含不允许的字符")
    try:
        resolved = target.resolve()
    except OSError as exc:
        raise LocationError(f"目录路径无效：{exc}") from exc
    if target.drive and resolved == Path(str(target.drive) + os.sep):
        raise LocationError("不能直接使用盘符根目录作为数据目录")
    source = data_dir()
    if _is_within(source, resolved) or _is_within(resolved, source):
        raise LocationError("新目录不能与当前数据目录相互嵌套")
    # Find the deepest existing ancestor: that is what has to be writable.
    probe = resolved
    while not probe.exists() and probe.parent != probe:
        probe = probe.parent
    if not probe.exists() or not _writable(probe):
        raise LocationError("目标目录不可写，请换一个位置或联系信息科授权")


def _is_within(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except (ValueError, OSError):
        return False


def _has_vault_files(path: Path) -> bool:
    if not path.exists():
        return False
    for name in ("vault.db", "vault.db-wal"):
        if (path / name).exists():
            return True
    try:
        return any(p.name == "app.log" for p in path.iterdir())
    except OSError:
        return False


def directory_size(path: Path) -> int:
    total = 0
    if not path.exists():
        return 0
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in SKIP_NAMES]
        for name in files:
            try:
                total += (Path(root) / name).stat().st_size
            except OSError:
                pass
    return total


def _copy_tree(source: Path, target: Path) -> int:
    copied = 0
    for root, dirs, files in os.walk(source):
        root_path = Path(root)
        dirs[:] = [d for d in dirs if d not in SKIP_NAMES]
        rel = root_path.relative_to(source)
        (target / rel).mkdir(parents=True, exist_ok=True)
        for name in files:
            src = root_path / name
            dst = target / rel / name
            shutil.copy2(src, dst)
            copied += 1
    return copied


def _verify_database(path: Path) -> None:
    if not path.exists():
        return
    uri = f"file:{path.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=15)
    try:
        result = str(conn.execute("PRAGMA integrity_check").fetchone()[0])
    finally:
        conn.close()
    if result != "ok":
        raise LocationError(f"新目录中的数据库校验失败：{result}")


def apply_location_request() -> dict:
    """Move the data directory if the user asked for it. Returns a report."""
    pending = pending_location()
    if not pending or env_override():
        return {"moved": False}
    mode = str(pending.get("mode") or "")
    target = Path(str(pending.get("path") or ""))
    source = data_dir()
    if not mode or not str(target):
        cancel_location_request()
        return {"moved": False, "error": "待生效的数据目录设置不完整，已取消"}
    if target.exists() and source.exists() and target.resolve() == source.resolve():
        config = read_config()
        config.pop("pending_location", None)
        config["data_location"] = {"mode": mode, "path": str(target)}
        write_config(config)
        return {"moved": False, "note": "目标目录与当前目录相同，无需移动"}
    if _has_vault_files(target):
        return {
            "moved": False,
            "error": f"目标目录 {target} 已存在密码库文件，请先清空或换一个目录",
            "kept_request": True,
        }
    try:
        target.mkdir(parents=True, exist_ok=True)
        copied = _copy_tree(source, target)
        _verify_database(target / "vault.db")
    except Exception as exc:  # noqa: BLE001 - report, keep the old location
        log.exception("Data directory move failed")
        return {"moved": False, "error": f"未能移动数据目录：{exc}"}
    config = read_config()
    config.pop("pending_location", None)
    config["data_location"] = {"mode": mode, "path": str(target)}
    write_config(config)
    report: dict = {"moved": True, "from": str(source), "to": str(target), "files": copied}
    # Keep the old folder as a safety net; renaming beats deleting because the
    # user can always roll back by hand. The browser process can hold a handle
    # for a moment after the window closes, so retry briefly before giving up.
    archive: Path | None = None
    for attempt in range(8):
        candidate = source.parent / f"{source.name}-旧数据-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        if archive is None:
            archive = candidate
        try:
            source.rename(archive)
            break
        except OSError as exc:
            if attempt == 7:
                log.warning("Could not archive the old data directory: %s", exc)
                report = {
                    "moved": True,
                    "from": str(source),
                    "to": str(target),
                    "files": copied,
                    "warning": (
                        f"新目录已生效，但旧目录 {source} 未能改名（文件仍被占用），"
                        "请手动确认后再删除"
                    ),
                }
                archive = None
            else:
                time.sleep(0.5)
    if archive is not None:
        report["archived"] = str(archive)
    return report
