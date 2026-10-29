"""Check that an old (v3) vault database is upgraded to the row-order column.

    python tools/test_schema_migration.py

The v4 schema adds records.sort_order. Opening a v3 file must not fail while the
index is created (that was the trap: CREATE INDEX in the schema script runs
before the ALTER TABLE), the existing row order must survive, and reordering has
to work right after the upgrade.
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

service.reorder_records(page_id, list(reversed(ids)))
check("reorder works after upgrade",
      [r["id"] for r in service.list_records(page_id)["rows"]] == list(reversed(ids)))
service.undo()
check("undo works after upgrade",
      [r["id"] for r in service.list_records(page_id)["rows"]] == ids)
service.close()

print()
if FAILURES:
    print(f"{len(FAILURES)} check(s) failed: {', '.join(FAILURES)}")
    raise SystemExit(1)
print("All schema-migration checks passed.")
