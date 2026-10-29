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

# --------------------------------------------------- picking individual rows
# Export a multi-row sheet, then import only two of the rows by index.
for index in range(4):
    picked_values = {column["key"]: f"p{index}-{column['key']}" for column in columns}
    for column in columns:
        if column["type"] == "password":
            picked_values[column["key"]] = f"Pick#{index}2026"
    service.save_record(page["id"], picked_values)
multi = WORKDIR / "multi.xlsx"
service.export_excel(page["id"], str(multi))
multi_preview = service.preview_excel(page["id"], str(multi))
assert multi_preview["rows"] >= 5, multi_preview
assert len(multi_preview["samples"]) == multi_preview["rows"], "preview lists every row"
assert multi_preview["selectable"] is True and multi_preview["preview_limit"] >= 300
print("preview ->", multi_preview["rows"], "rows listed,", "selectable:", multi_preview["selectable"])

titles = [sample[columns[0]["key"]] for sample in multi_preview["samples"]]
before_pick = service.list_records(page["id"])["total"]
picked = service.import_excel(page["id"], str(multi), "", [3, 0, 3, 99, -1])
assert picked["count"] == 2, picked
after_rows = service.list_records(page["id"])["rows"]
assert len(after_rows) == before_pick + 2
new_titles = [row["cells"][columns[0]["key"]]["value"] for row in after_rows][-2:]
# indices are de-duplicated, clamped and kept in file order -> [0, 3]
assert new_titles == [titles[0], titles[3]], (new_titles, titles)
print("picked rows [3,0] ->", picked["count"], "records:", new_titles)

rejected = ""
for bad in ([], ["x"], [42], [99]):
    try:
        service.import_excel(page["id"], str(multi), "", bad)
        raise AssertionError(f"无效勾选应该被拒绝: {bad}")
    except VaultError as err:
        assert "至少勾选一行" in str(err), err
        rejected = str(err)
print("empty / non-numeric / out-of-range selection ->", rejected)

# No indices at all still means "the whole file".
whole = service.import_excel(page["id"], str(multi))
assert whole["count"] == multi_preview["rows"], (whole, multi_preview)
print("no selection -> whole file:", whole["count"], "rows")
service.undo()

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

# ------------------------------------------------------- file dialog filters
# pywebview parses every filter with ^([\w ]+)\(\*(...)\)$ *before* showing the
# dialog, so "Excel / CSV (*.xlsx;...)" used to abort the import menu with
# "… is not a valid file filter". backend.api.file_filter now sanitises labels.
import re  # noqa: E402

from backend.api import file_filter  # noqa: E402

try:
    from webview.util import parse_file_type  # noqa: E402
except Exception:  # pywebview missing (should not happen in the venv)
    parse_file_type = None

LABELS = [
    ("Excel 和 CSV 工作簿", "*.xlsx;*.xls;*.csv"),
    ("Excel 文件", "*.xlsx"),
    ("恢复密钥文件", "*.msvkey;*.json"),
    ("加密备份", "*.msvbackup"),
    ("加密备份", "*.msvbackup;*.json"),
    ("所有文件", "*.*"),
    ("SecureCRT 程序", "*.exe"),
    ("PuTTY 程序", "*.exe"),
    ("Excel / CSV", "*.xlsx"),          # slash has to go
    ("WinSCP ( portable )", "*.exe"),   # brackets have to go
    ("///", "*.xls"),                   # nothing left -> 文件
]
for description, patterns in LABELS:
    text = file_filter(description, patterns)
    if parse_file_type:
        label, parsed = parse_file_type(text)
        assert parsed == patterns, (text, parsed)
        assert re.fullmatch(r"[\w ]+", label), (text, label)
    assert text.endswith(f"({patterns})"), text
assert file_filter("Excel / CSV", "*.xlsx") == "Excel CSV (*.xlsx)", file_filter("Excel / CSV", "*.xlsx")
assert file_filter("///", "*.xls") == "文件 (*.xls)"
print("file filters ->", len(LABELS), "labels accepted by pywebview")

# No call site may hand-write a filter again.
api_src = (Path(__file__).resolve().parent.parent / "backend" / "api.py").read_text(encoding="utf-8")
handwritten = re.findall(r'"[^"\n]*\(\*\.[^"\n]*"', api_src)
assert not handwritten, f"api.py 里还有手写过滤器：{handwritten}"
assert api_src.count("file_filter(") >= 12, api_src.count("file_filter(")
print("api.py -> every dialog filter goes through file_filter")

print("\nALL EXCEL CHECKS PASSED")
service.close()
