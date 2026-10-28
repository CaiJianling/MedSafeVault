"""Round-trip checks for password-sealed backups.

Run from the repository root:  python tools/test_backup.py
Everything happens in a throwaway MEDSAFE_DATA_DIR, so no real vault is touched.
"""
import json
import os
import tempfile
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ["MEDSAFE_DATA_DIR"] = tempfile.mkdtemp(prefix="msv-backup-")

from backend.crypto import BACKUP_FORMAT  # noqa: E402
from backend.store import VaultError, VaultService  # noqa: E402

MASTER = "Master#2026demo"
BACKUP_PW = "Backup#2026secret"

service = VaultService()
service.initialize(MASTER)
page = service.get_pages()[0]
columns = service.get_page(page["id"])["columns"]
values = {}
for column in columns:
    values[column["key"]] = "secret-value-xyz" if column["type"] == "password" else f"v-{column['key']}"
service.save_record(page["id"], values)

envelope = service.export_backup(BACKUP_PW)
assert envelope["format"] == BACKUP_FORMAT, envelope.keys()
text = json.dumps(envelope, ensure_ascii=False)
for leak in ("v-secret", "secret-value-xyz", "MedSafeVault.Backup", page["name"]):
    assert leak not in text, f"备份封套泄露了内容：{leak}"
print("envelope seals structure and values:", len(text), "bytes")

try:
    service.inspect_backup(envelope)
    raise AssertionError("缺少密码也应该报错")
except VaultError as exc:
    print("no password ->", exc)

try:
    service.inspect_backup(envelope, "wrong-password")
    raise AssertionError("错误密码也应该报错")
except VaultError as exc:
    print("wrong password ->", exc)

info = service.inspect_backup(envelope, BACKUP_PW)
assert info["sealed"] and info["records"] >= 1 and info["pages"] >= 1, info
print("right password ->", {k: info[k] for k in ("sealed", "pages", "records")})

# Restore into a locked service: the backup password alone must be enough.
service.lock("test")
result = service.restore_backup(envelope, BACKUP_PW)
assert not result["state"]["locked"], result["state"]
rows = service.list_records(page["id"])["rows"]
found = any("v-" in json.dumps(row, ensure_ascii=False) for row in rows)
assert found, rows
print("restored from envelope, records readable:", len(rows))

# The vault keeps using its original open password afterwards.
service.lock("test")
service.unlock(MASTER)
print("master password still works after restore")

# Legacy (unsealed) backups must still restore with the open password.
legacy = service.build_backup()
service.lock("test")
try:
    service.restore_backup(legacy, "nope")
    raise AssertionError("错误主密码也应该报错")
except VaultError as exc:
    print("legacy wrong master ->", exc)
result = service.restore_backup(legacy, MASTER)
assert not result["state"]["locked"]
print("legacy backup still restores")

# An empty backup password is rejected up front.
try:
    service.export_backup("")
    raise AssertionError("空密码应该被拒绝")
except VaultError as exc:
    print("empty backup password ->", exc)

service.close()
print("\nALL BACKUP CHECKS PASSED")
