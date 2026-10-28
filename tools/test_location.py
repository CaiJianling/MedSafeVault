"""Exercise the data-directory relocation logic against throwaway folders.

Run from the repository root:  python tools/test_location.py
It never touches %APPDATA%: every path is patched to a temp folder first.
"""
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.pop("MEDSAFE_DATA_DIR", None)

from backend import paths  # noqa: E402

root = Path(tempfile.mkdtemp(prefix="msv-location-"))
app = root / "app"
appdata = root / "appdata" / "MedSafeVault"
app.mkdir(parents=True)
appdata.mkdir(parents=True)

paths.app_dir = lambda: app  # type: ignore[assignment]
paths.default_data_root = lambda: appdata  # type: ignore[assignment]


def reset_cache() -> None:
    paths._config_path_cache = None
    paths._config_cache = None


def make_vault(folder: Path) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    db = folder / "vault.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)")
    conn.execute("INSERT OR REPLACE INTO meta VALUES('vault_id','abc123')")
    conn.commit()
    conn.close()
    (folder / "app.log").write_text("hello", encoding="utf-8")
    (folder / "MedSafeVault-备份-20260101.msvbackup").write_text("{}", encoding="utf-8")
    cache = folder / "webview" / "Default"
    cache.mkdir(parents=True, exist_ok=True)
    (cache / "Local Storage").write_text("cache", encoding="utf-8")
    return db


def show(label: str) -> dict:
    summary = paths.location_summary()
    print(f"  {label}: mode={summary['mode']} path={Path(summary['path']).name} pending={bool(summary['pending'])}")
    return summary


make_vault(appdata)
reset_cache()
print("== defaults ==")
summary = show("startup")
assert summary["mode"] == "appdata", summary
config_file = app / "MedSafeVault.json"
assert config_file.exists(), "config file should be auto-created next to the app"
print("  config:", config_file.relative_to(root))
print("  content:", json.dumps(json.loads(config_file.read_text(encoding="utf-8")), ensure_ascii=False))

print("== request portable ==")
result = paths.request_location("portable")
assert result["pending"]["mode"] == "portable", result
show("pending")
report = paths.apply_location_request()
print("  report:", {k: report[k] for k in report if k != "error"})
assert report["moved"], report
portable = app / "MedSafeVaultData"
assert (portable / "vault.db").exists(), "database should be at the new place"
assert not (portable / "webview").exists(), "browser profile must not be copied"
assert (portable / "MedSafeVault-备份-20260101.msvbackup").exists()
assert not appdata.exists(), "old folder should be renamed away"
assert list(appdata.parent.glob("MedSafeVault-旧数据-*")), "archive kept under a new name"
reset_cache()
summary = show("after move")
assert summary["mode"] == "portable"

print("== integrity of the copy ==")
conn = sqlite3.connect(portable / "vault.db")
print("  rows:", conn.execute("SELECT * FROM meta").fetchall())
conn.close()

print("== request custom ==")
custom = root / "d" / "vaultfiles"
paths.request_location("custom", str(custom))
report = paths.apply_location_request()
assert report["moved"], report
reset_cache()
assert paths.data_dir() == custom, paths.data_dir()
show("after custom")

print("== refuses a dirty target ==")
make_vault(root / "occupied")
try:
    paths.request_location("custom", str(root / "occupied"))
    report = paths.apply_location_request()
    assert not report["moved"] and report.get("error"), report
    print("  refused:", report["error"][:60])
except paths.LocationError as exc:  # also acceptable
    print("  refused at request time:", exc)
reset_cache()
assert paths.data_dir() == custom, "failed move must leave the location untouched"

print("== refuses nested and root paths ==")
for bad in [str(custom / "inner"), "D:\\"]:
    try:
        paths.request_location("custom", bad)
        print("  NOT REFUSED:", bad)
    except paths.LocationError as exc:
        print("  refused:", str(exc)[:50])

print("== env override wins and blocks changes ==")
os.environ["MEDSAFE_DATA_DIR"] = str(root / "envdir")
reset_cache()
assert paths.data_dir() == root / "envdir"
try:
    paths.request_location("appdata")
    print("  NOT REFUSED: change while env override is set")
except paths.LocationError as exc:
    print("  refused:", str(exc)[:50])
os.environ.pop("MEDSAFE_DATA_DIR")
reset_cache()

print("== read-only program folder falls back to AppData config ==")
paths.app_dir = lambda: Path("Z:/not-reachable")  # type: ignore[assignment]
reset_cache()
cfg = paths.config_path()
assert "MedSafeVault" in str(cfg) and str(appdata) in str(cfg), cfg
print("  config:", cfg)

paths.app_dir = lambda: app  # type: ignore[assignment]
reset_cache()
shutil.rmtree(root, ignore_errors=True)
print("\nALL LOCATION CHECKS PASSED")
