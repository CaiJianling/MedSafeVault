"""Excel import/export helpers."""
from __future__ import annotations

import csv
import os
import unicodedata
from typing import Any

from .store import HEADER_ALIASES, MASK

HEADER_FILL = "1E293B"
HEADER_FONT = "FFFFFF"
ACCENT_FILL = "0E7490"


def _normalize(text: Any) -> str:
    value = unicodedata.normalize("NFKC", str(text or ""))
    value = value.strip().lower()
    for ch in " \t\r\n_-:/:：()（）[]【】.":
        value = value.replace(ch, "")
    return value


def read_table(path: str) -> tuple[list[str], list[list[Any]]]:
    ext = os.path.splitext(path)[1].lower()
    if ext == ".xlsx" or ext == ".xlsm":
        from openpyxl import load_workbook

        workbook = load_workbook(path, data_only=True, read_only=True)
        sheet = workbook.active
        rows = list(sheet.iter_rows(values_only=True))
        workbook.close()
    elif ext == ".csv":
        for encoding in ("utf-8-sig", "gb18030", "utf-16"):
            try:
                with open(path, "r", encoding=encoding, newline="") as handle:
                    rows = [tuple(row) for row in csv.reader(handle)]
                break
            except UnicodeError:
                continue
        else:
            raise RuntimeError("无法识别 CSV 编码")
    elif ext == ".xls":
        try:
            import xlrd  # type: ignore
        except ImportError as exc:
            raise RuntimeError("读取 .xls 需要安装 xlrd，建议另存为 .xlsx") from exc
        sheet = xlrd.open_workbook(path).sheet_by_index(0)
        rows = [tuple(sheet.row_values(i)) for i in range(sheet.nrows)]
    else:
        raise RuntimeError("仅支持 .xlsx / .xls / .csv 文件")

    # Find the most likely header row within the first 10 rows.
    header_index = 0
    for index, row in enumerate(rows[:10]):
        joined = " ".join(str(cell) for cell in row if cell is not None).lower()
        if any(key in joined for key in ("地址", "ip", "应用", "用户名", "密码", "名称")):
            header_index = index
            break
    if not rows:
        return [], []
    headers = [str(cell).strip() if cell is not None else "" for cell in rows[header_index]]
    body: list[list[Any]] = []
    for row in rows[header_index + 1:]:
        if row is None:
            continue
        if all(cell is None or str(cell).strip() == "" for cell in row):
            continue
        body.append(list(row))
    return headers, body


def map_headers(headers: list[str], columns: list[dict]) -> dict[str, int]:
    """Map column key -> header index using labels, keys and legacy aliases."""
    normalized = [_normalize(h) for h in headers]
    mapping: dict[str, int] = {}
    for col in columns:
        key = col["key"]
        label = _normalize(col["label"])
        candidates = [label, _normalize(key)]
        for alias in HEADER_ALIASES.get(key, []):
            candidates.append(_normalize(alias))
        for candidate in candidates:
            if not candidate:
                continue
            if candidate in normalized:
                mapping[key] = normalized.index(candidate)
                break
        if key in mapping:
            continue
        # Tolerant contains-match for descriptive headers such as "服务器IP地址"
        for candidate in candidates:
            if len(candidate) < 2:
                continue
            for index, header in enumerate(normalized):
                if candidate in header or (len(header) >= 2 and header in candidate):
                    mapping[key] = index
                    break
            if key in mapping:
                break
    return mapping


def preview(path: str, columns: list[dict], max_sample: int = 5) -> dict:
    headers, body = read_table(path)
    if not headers:
        raise RuntimeError("没有读取到表头")
    mapping = map_headers(headers, columns)
    if not mapping:
        raise RuntimeError("无法把 Excel 表头与当前页面的列对应起来")
    samples = []
    for row in body[:max_sample]:
        cells = {}
        for col in columns:
            index = mapping.get(col["key"])
            value = ""
            if index is not None and index < len(row) and row[index] is not None:
                value = row[index]
                if isinstance(value, float) and value.is_integer():
                    value = int(value)
                value = str(value).strip()
            if col.get("masked") and value:
                value = MASK
            cells[col["key"]] = value
        samples.append(cells)
    mapped_headers = {headers[i] for i in mapping.values() if i < len(headers)}
    return {
        "headers": headers,
        "mapped": [
            {"key": col["key"], "label": col["label"], "header": headers[mapping[col["key"]]]}
            for col in columns if col["key"] in mapping
        ],
        "unmatched": [h for h in headers if h and h not in mapped_headers],
        "rows": len(body),
        "samples": samples,
    }


def read_rows(path: str, columns: list[dict]) -> list[dict[str, str]]:
    headers, body = read_table(path)
    mapping = map_headers(headers, columns)
    rows: list[dict[str, str]] = []
    for raw in body:
        values: dict[str, str] = {}
        for col in columns:
            index = mapping.get(col["key"])
            if index is None or index >= len(raw) or raw[index] is None:
                continue
            value = raw[index]
            if isinstance(value, float) and value.is_integer():
                value = int(value)
            text = str(value).strip()
            if text:
                values[col["key"]] = text
        if values:
            rows.append(values)
    return rows


def _style_sheet(sheet, columns: list[dict], widths: dict[str, int] | None = None) -> None:
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    header_fill = PatternFill("solid", fgColor=HEADER_FILL)
    header_font = Font(color=HEADER_FONT, bold=True, size=11)
    for index, col in enumerate(columns, start=1):
        cell = sheet.cell(row=1, column=index)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
        width = (widths or {}).get(col["key"]) or max(12, min(40, int(col.get("width", 160) / 9)))
        sheet.column_dimensions[get_column_letter(index)].width = width
    sheet.row_dimensions[1].height = 26
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions


def write_template(path: str, columns: list[dict]) -> None:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "密码导入模板"
    sheet.append([col["label"] for col in columns])
    example = {
        "type": "物理机",
        "subtype": "示例",
        "address": "203.0.113.10",
        "app": "示例应用",
        "os": "CentOS 7",
        "username": "root",
        "password": "示例密码",
        "port": "22",
        "note": "这是一条示例数据，导入前请删除",
        "oob": "192.0.2.10",
        "oob_user": "admin",
        "oob_pass": "示例密码",
    }
    sheet.append([example.get(col["key"], "") for col in columns])
    _style_sheet(sheet, columns)
    for cell in sheet[2]:
        cell.font = Font(color="64748B", italic=True)
        cell.alignment = Alignment(vertical="center")
    sheet.row_dimensions[2].height = 22
    workbook.save(path)


def write_export(path: str, columns: list[dict], rows: list[dict[str, str]], sheet_name: str) -> int:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment

    workbook = Workbook()
    sheet = workbook.active
    safe_name = "".join(ch for ch in (sheet_name or "导出") if ch not in r"[]:*?/\\")[:30]
    sheet.title = safe_name or "导出"
    sheet.append([col["label"] for col in columns])
    for row in rows:
        sheet.append([row.get(col["key"], "") for col in columns])
    _style_sheet(sheet, columns)
    for line in sheet.iter_rows(min_row=2):
        for cell in line:
            cell.alignment = Alignment(vertical="center")
    workbook.save(path)
    return len(rows)
