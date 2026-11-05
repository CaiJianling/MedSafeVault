"""Check that an old (v3) vault database is upgraded to the row-order column.

    python tools/test_schema_migration.py

v4 added records.sort_order, v5 added pages.color and the two row colours.
Opening an old file must not fail while the index is created (that was the trap:
CREATE INDEX in the schema script runs before the ALTER TABLE), the existing row
order must survive, reordering has to work right after the upgrade, and the new
colour columns must appear with empty defaults.
"""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

TMP = Path(tempfile.mkdtemp(prefix="msv-migrate-"))
os.environ["MEDSAFE_DATA_DIR"] = str(TMP)

from backend.store import SCHEMA_VERSION, VaultService  # noqa: E402

MASTER = "Migrate#2026demo"
FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'} {name} {detail}")
    if not ok:
        FAILURES.append(name)


service = VaultService()
service.initialize(MASTER)
page_id = service.get_pages()[0]["id"]
ids = [int(service.save_record(page_id, {"app": name})["record"]["id"]) for name in "ABC"]
service.close()

# Pretend the file was written by the previous schema version.
db = TMP / "vault.db"
conn = sqlite3.connect(db)
conn.execute("DROP INDEX IF EXISTS idx_records_order")
conn.execute("ALTER TABLE records DROP COLUMN sort_order")
conn.execute("ALTER TABLE records DROP COLUMN row_bg")
conn.execute("ALTER TABLE records DROP COLUMN row_fg")
conn.execute("ALTER TABLE pages DROP COLUMN color")
conn.execute("DELETE FROM meta WHERE k='schema_version'")
conn.commit()
columns = [row[1] for row in conn.execute("PRAGMA table_info(records)").fetchall()]
conn.close()
check("fixture really has no sort_order", "sort_order" not in columns, f"{columns}")

service = VaultService()
service.unlock(MASTER)
rows = service.list_records(page_id)["rows"]
check("v3 file opens", True)
check("order survives the upgrade", [r["id"] for r in rows] == ids, f"{[r['id'] for r in rows]} vs {ids}")
check("slots backfilled from id", [r["sort_order"] for r in rows] == ids, f"{[r['sort_order'] for r in rows]}")
check("schema_version bumped", service._meta_get("schema_version") == SCHEMA_VERSION,
      f"{service._meta_get('schema_version')}")
conn = sqlite3.connect(db)
indexes = {row[1] for row in conn.execute("PRAGMA index_list(records)").fetchall()}
conn.close()
check("order index created", "idx_records_order" in indexes, f"{sorted(indexes)}")
conn = sqlite3.connect(db)
records_columns = {row[1] for row in conn.execute("PRAGMA table_info(records)").fetchall()}
pages_columns = {row[1] for row in conn.execute("PRAGMA table_info(pages)").fetchall()}
conn.close()
check("v5 colour columns added",
      {"row_bg", "row_fg"} <= records_columns and "color" in pages_columns,
      f"{sorted(records_columns)} / {sorted(pages_columns)}")
check("colour columns default to empty",
      all(r.get("row_bg", "") == "" and r.get("row_fg", "") == ""
          for r in service.list_records(page_id)["rows"]),
      "")
check("page colour defaults to empty", service.get_pages()[0].get("color") == "",
      f"{service.get_pages()[0].get('color')}")



service.reorder_records(page_id, list(reversed(ids)))
check("reorder works after upgrade",
      [r["id"] for r in service.list_records(page_id)["rows"]] == list(reversed(ids)))
service.undo()
check("undo works after upgrade",
      [r["id"] for r in service.list_records(page_id)["rows"]] == ids)

# Colors are validated and round-trip through save_record / update_page.
saved = service.save_record(page_id, {"app": "colour test", "row_bg": "#fee2e2",
                                      "row_fg": "#b91c1c"})["record"]
detail = service.get_record(saved["id"])
check("row colours saved",
      detail["values"]["row_bg"] == "#fee2e2" and detail["values"]["row_fg"] == "#b91c1c",
      f"{detail['values'].get('row_bg')} / {detail['values'].get('row_fg')}")
try:
    service.save_record(page_id, {"app": "bad", "row_bg": "red"})
    check("invalid colour rejected", False)
except Exception as exc:
    check("invalid colour rejected", "颜色" in str(exc), str(exc))
page = service.get_pages()[0]
updated = service.update_page(page["id"], {**page, "color": "#14b8a6"})
check("page colour saved", updated.get("color") == "#14b8a6", f"{updated.get('color')}")

# 自定义强调色与行/页颜色同一套校验
settings = service.set_settings({"accent_color": "#fde047"})
check("custom accent saved", settings.get("accent_color") == "#fde047",
      f"{settings.get('accent_color')}")
settings = service.set_settings({"accent_color": ""})
check("custom accent cleared", settings.get("accent_color") == "", f"{settings.get('accent_color')}")
try:
    service.set_settings({"accent_color": "yellow"})
    check("invalid accent rejected", False)
except Exception as exc:
    check("invalid accent rejected", "颜色" in str(exc), str(exc))

service.close()

print()
if FAILURES:
    print(f"{len(FAILURES)} check(s) failed: {', '.join(FAILURES)}")
    raise SystemExit(1)
print("All schema-migration checks passed.")
