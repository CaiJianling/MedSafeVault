"""把一个构建产物登记进 update/versions.json，供 update/server.py 分发。

    python update/make_release.py --exe dist/MedSafeVault.exe --version 2.1.0 \
        --notes "修复列表首行提示被表头遮挡；新增两步验证"

默认把 exe 复制到 `update/files/MedSafeVault-<version>.exe`，算好 size/sha256
写进 versions.json，并把 latest 指向新版本（`--no-latest` 只登记不置为最新）。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from server import parse_version  # noqa: E402  (same folder, stdlib only)

VERSION_RE = re.compile(r"^\d+(\.\d+){0,3}$")


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def order(text: object) -> tuple[int, ...]:
    """Zero tuple for a blank/odd version so comparisons never explode."""
    try:
        return parse_version(text)
    except ValueError:
        return (0, 0, 0, 0)


def load_config(config: Path) -> dict:
    if not config.exists():
        return {"_readme": "MedSafeVault 更新服务版本表；releases 按版本从新到旧排列",
                "latest": "", "releases": []}
    payload = json.loads(config.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("releases"), list):
        raise SystemExit(f"配置文件结构不正确：{config}")
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="登记 MedSafeVault 更新包")
    parser.add_argument("--exe", required=True, help="构建产物路径，例如 dist/MedSafeVault.exe")
    parser.add_argument("--version", required=True, help="版本号，例如 2.1.0")
    parser.add_argument("--notes", default="", help="更新说明，显示在应用的更新提示里")
    parser.add_argument("--root", default=str(HERE), help="服务根目录（默认 update/）")
    parser.add_argument("--config", default="", help="versions.json 路径（默认 <root>/versions.json）")
    parser.add_argument("--file", default="", help="存放的相对路径，默认 files/MedSafeVault-<version>.exe")
    parser.add_argument("--mandatory", action="store_true", help="标记为必须更新")
    parser.add_argument("--no-latest", action="store_true", help="只登记，不把 latest 指向该版本")
    parser.add_argument("--dry-run", action="store_true", help="只打印将要写入的内容")
    args = parser.parse_args(argv)

    if not VERSION_RE.match(args.version.strip()):
        raise SystemExit(f"版本号格式不正确：{args.version}")
    root = Path(args.root).resolve()
    config_path = Path(args.config).resolve() if args.config else root / "versions.json"
    source = Path(args.exe).resolve()
    if not source.is_file():
        raise SystemExit(f"找不到构建产物：{source}")

    relative = args.file.strip() or f"files/{source.stem}-{args.version}{source.suffix}"
    target = root / relative
    digest = sha256_of(source)
    payload = load_config(config_path)
    releases = [r for r in payload["releases"] if str(r.get("version")) != args.version]
    entry = {
        "version": args.version,
        "file": relative.replace("\\", "/"),
        "notes": args.notes,
        "mandatory": bool(args.mandatory),
        "released_at": date.today().isoformat(),
        "size": source.stat().st_size,
        "sha256": digest,
    }
    releases.append(entry)
    releases.sort(key=lambda r: order(r["version"]), reverse=True)
    declared = str(payload.get("latest") or "")
    if args.no_latest:
        latest = declared or entry["version"]
    elif not declared or order(entry["version"]) >= order(declared):
        latest = entry["version"]
    else:
        latest = declared

    result = {**payload, "latest": latest, "releases": releases}
    text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.dry_run:
        print(text)
        print(f"[dry-run] 会复制 {source} → {target}")
        return 0

    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and sha256_of(target) == digest:
        print(f"文件已就位（sha256 相同，跳过复制）：{relative}")
    else:
        shutil.copyfile(source, target)
        print(f"已复制：{source} → {target}")
    config_path.write_text(text, encoding="utf-8")
    print(f"已写入：{config_path}")
    print(f"  latest = {latest}，共 {len(releases)} 个版本")
    print(f"  size   = {entry['size']:,} 字节")
    print(f"  sha256 = {digest}")
    print("\n启动服务：python update/server.py --port 8000")
    print(f"应用里填写的更新服务地址：http://<这台机器的IP>:8000/")
    print(f"自测：curl http://127.0.0.1:8000/api/version?current={entry['version']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
