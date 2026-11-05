"""更新服务公用的极小工具：版本号、sha256、JSON 原子写。

`server.py`（HTTP 层）、`admin.py`（管理后台）和 `make_release.py`（命令行登记）
都要用这几样，放在一起可以避免互相 import 造成循环。全部只用标准库。
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from datetime import date
from pathlib import Path
from typing import Any

VERSION_RE = re.compile(r"^\d+(\.\d+){0,3}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
# 只允许这些后缀被登记成分发文件；管理页面上传其它后缀时会被拒绝。
ALLOWED_SUFFIXES = (".exe", ".msi", ".zip", ".7z", ".rar", ".gz", ".tar")


class AdminError(Exception):
    """管理接口的业务错误：带 HTTP 状态码和一句能直接显示给用户的话。"""

    def __init__(self, status: int, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.extra = extra


def parse_version(text: Any) -> tuple[int, ...]:
    """Keep in sync with backend/updater.py — the test asserts they agree."""
    parts = str(text or "").strip().split("-")[0].split("+")[0]
    if not VERSION_RE.match(parts):
        raise ValueError(f"版本号格式不正确：{text}")
    numbers = [int(item) for item in parts.split(".")]
    while len(numbers) < 4:
        numbers.append(0)
    return tuple(numbers[:4])


def version_or_zero(text: Any) -> tuple[int, ...]:
    """Zero tuple for a blank/odd version so sorting never explodes."""
    try:
        return parse_version(text)
    except ValueError:
        return (0, 0, 0, 0)


def is_newer(candidate: Any, current: Any) -> bool:
    try:
        return parse_version(candidate) > parse_version(current)
    except ValueError:
        return False


def sha256_of(path: Path, chunk: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(chunk), b""):
            digest.update(block)
    return digest.hexdigest()


def today() -> str:
    return date.today().isoformat()


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json_atomic(path: Path, payload: Any) -> None:
    """写临时文件再 replace，避免服务端被 kill 时留下半个 versions.json。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    handle = tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=str(path.parent),
        prefix=f".{path.name}.", suffix=".tmp", delete=False)
    try:
        with handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(handle.name, path)
    except Exception:
        try:
            os.unlink(handle.name)
        except OSError:
            pass
        raise


def human_size(size: int) -> str:
    value = float(size or 0)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.2f} {unit}"
        value /= 1024
    return f"{value:.2f} GB"
