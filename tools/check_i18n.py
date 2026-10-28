"""Report UI strings that have no English dictionary entry.

Usage:  python tools/check_i18n.py
Exit code 1 when something is missing, so it can gate a build.
"""
import re
import sys
from pathlib import Path

SRC = Path("web/src")
DICT = SRC / "lib" / "i18n.tsx"
CJK = re.compile(r"[\u3400-\u9fff]")


def unescape(raw: str) -> str:
    return raw.replace("\\'", "'").replace('\\\\', "\\").replace("\\n", "\n")


dict_text = DICT.read_text(encoding="utf-8")
keys = {unescape(match) for match in re.findall(r"^  '((?:[^'\\]|\\.)*)':", dict_text, re.M)}

pattern = re.compile(r"""t\(\s*'((?:[^'\\]|\\.)*)'""", re.S)

missing: dict[str, list[str]] = {}
for path in sorted(SRC.rglob("*.tsx")) + sorted(SRC.rglob("*.ts")):
    if path == DICT:
        continue
    text = path.read_text(encoding="utf-8")
    for match in pattern.finditer(text):
        key = unescape(match.group(1))
        if not CJK.search(key) or key in keys:
            continue
        line = text[: match.start()].count("\n") + 1
        missing.setdefault(key, []).append(f"{path.name}:{line}")

out = sys.stdout
print(f"dictionary keys: {len(keys)}")
print(f"missing english entries: {len(missing)}")
for key, where in missing.items():
    print(f"  {key!r}\n      <- {', '.join(where[:3])}")
sys.exit(1 if missing else 0)
