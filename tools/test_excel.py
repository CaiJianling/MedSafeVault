"""Checks for Excel export/import with an opening password ("xlsx 密码").

Run from the repository root:  python tools/test_excel.py
Everything happens in throwaway folders, so no real vault is touched.
"""
import os
import tempfile
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ["MEDSAFE_DATA_DIR"] = tempfile.mkdtemp(prefix="msv-excel-data-")
WORKDIR = Path(tempfile.mkdtemp(prefix="msv-excel-files-"))

from backend import excelio  # noqa: E402
from backend.store import VaultError, VaultService  # noqa: E402

MASTER = "Master#2026demo"
XLSX_PW = "Excel#2026secret"

service = VaultService()
service.initialize(MASTER)
page = service.get_pages()[0]
columns = service.get_page(page["id"])["columns"]
values = {column["key"]: f"v-{column['key']}" for column in columns}
for column in columns:
    if column["type"] == "password":
        values[column["key"]] = "secret-value-xyz"
service.save_record(page["id"], values)

# ---------------------------------------------------------------- plain export
plain = WORKDIR / "plain.xlsx"
result = service.export_excel(page["id"], str(plain))
assert result["sealed"] is False and result["count"] >= 1, result
assert not excelio.is_encrypted(str(plain))
print("plain export:", result["count"], "rows,", plain.stat().st_size, "bytes")

# ------------------------------------------------------------ encrypted export
sealed = WORKDIR / "sealed.xlsx"
result = service.export_excel(page["id"], str(sealed), XLSX_PW)
assert result["sealed"] is True and result["count"] >= 1, result
assert excelio.is_encrypted(str(sealed)), "导出的工作簿没有加密"
raw = sealed.read_bytes()
for leak in (b"secret-value-xyz", b"PK\x03\x04"):
    assert leak not in raw, f"加密文件中仍能看到明文片段：{leak!r}"
print("encrypted export:", sealed.stat().st_size, "bytes; no readable zip/plaintext")

leftovers = [p.name for p in WORKDIR.iterdir() if p.name.startswith("msv-export-")]
assert not leftovers, f"清理失败，残留临时文件：{leftovers}"

# ------------------------------------------------------------- preview / import
try:
    service.preview_excel(page["id"], str(sealed))
    raise AssertionError("没有密码时应该提示输入密码")
except excelio.ExcelPasswordRequired as exc:
    print("no password ->", exc)

try:
    service.preview_excel(page["id"], str(sealed), "wrong-password")
    raise AssertionError("错误密码应该被拒绝")
except excelio.ExcelPasswordInvalid as exc:
    print("wrong password ->", exc)

preview = service.preview_excel(page["id"], str(sealed), XLSX_PW)
assert preview["rows"] >= 1 and preview["mapped"], preview
assert all(
    value == excelio.MASK or value.startswith("v-")
    for sample in preview["samples"]
    for value in sample.values()
), preview["samples"]
print("right password -> preview", preview["rows"], "rows /", len(preview["mapped"]), "columns")

before = service.list_records(page["id"])["total"]
imported = service.import_excel(page["id"], str(sealed), XLSX_PW)
assert imported["count"] == preview["rows"], imported
assert service.list_records(page["id"])["total"] == before + imported["count"]
print("import with password:", imported["count"], "rows")

# ------------------------------------------------------------------ validation
short = WORKDIR / "short.xlsx"
try:
    service.export_excel(page["id"], str(short), "1234567")
    raise AssertionError("过短的密码应该被拒绝")
except VaultError as exc:
    print("short password ->", exc)
assert not short.exists(), "校验失败时不应该留下文件"

# ------------------------------------------------ encrypted legacy .xls
# tools/fixtures/encrypted-legacy.xls was saved by Excel as BIFF8 with the
# opening password below; it holds two clearly fictional demo rows.
XLS_PW = "XlsPass#2026"
xls_fixture = Path(__file__).resolve().parent / "fixtures" / "encrypted-legacy.xls"
assert excelio.is_encrypted(str(xls_fixture)), "样本 .xls 应该是加密的"

try:
    excelio.read_table(str(xls_fixture))
    raise AssertionError("加密 .xls 没有密码时应该提示输入密码")
except excelio.ExcelPasswordRequired as exc:
    print("xls no password ->", exc)

try:
    excelio.read_table(str(xls_fixture), "wrong-password")
    raise AssertionError("加密 .xls 错误密码应该被拒绝")
except excelio.ExcelPasswordInvalid as exc:
    print("xls wrong password ->", exc)

xls_headers, xls_body = excelio.read_table(str(xls_fixture), XLS_PW)
assert "服务器地址" in xls_headers and len(xls_body) == 2, (xls_headers, xls_body)
assert xls_body[0][1] == "192.0.2.10", xls_body[0]

xls_preview = service.preview_excel(page["id"], str(xls_fixture), XLS_PW)
assert xls_preview["rows"] == 2 and xls_preview["mapped"], xls_preview
assert xls_preview["samples"][0]["password"] == excelio.MASK, xls_preview["samples"][0]

before_xls = service.list_records(page["id"])["total"]
xls_imported = service.import_excel(page["id"], str(xls_fixture), XLS_PW)
assert xls_imported["count"] == 2, xls_imported
assert service.list_records(page["id"])["total"] == before_xls + 2
print("xls right password -> preview 2 rows, import", xls_imported["count"], "rows")

# A damaged .xls that merely looks like an OLE container must fail loudly.
fake_xls = WORKDIR / "fake.xls"
fake_xls.write_bytes(b"\xd0\xcf\x11\xe0not a real xls")
try:
    excelio.read_table(str(fake_xls))
    raise AssertionError("损坏的 .xls 不应该被当成空表")
except Exception:
    pass

print("\nALL EXCEL CHECKS PASSED")
service.close()
