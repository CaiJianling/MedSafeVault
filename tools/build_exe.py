"""Build the single-file Windows executable.

Usage (from the repository root, inside the project venv):
    python tools/build_exe.py            # front end + exe
    python tools/build_exe.py --skip-web # reuse the existing web/dist

Steps:
  1. npm run build in web/ (Vite output in web/dist)
  2. pyinstaller --noconfirm --clean MedSafeVault.spec
  3. report the produced exe size and a sha256 for distribution notes
"""
from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXE = ROOT / "dist" / "MedSafeVault.exe"


def run(cmd: list[str], cwd: Path) -> None:
    print("+ " + " ".join(str(part) for part in cmd), flush=True)
    completed = subprocess.run(cmd, cwd=cwd, shell=False)
    if completed.returncode != 0:
        raise SystemExit(f"command failed with exit code {completed.returncode}: {cmd}")


def build_web() -> None:
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    if not npm:
        raise SystemExit("npm not found on PATH; install Node.js or pass --skip-web")
    run([npm, "run", "build"], ROOT / "web")


def build_exe() -> None:
    target = EXE if EXE.exists() else None
    if target:
        target.unlink()  # never trust a stale artefact
    run(
        [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "MedSafeVault.spec"],
        ROOT,
    )


def report() -> None:
    if not EXE.exists():
        raise SystemExit(f"build finished but {EXE} is missing")
    digest = hashlib.sha256(EXE.read_bytes()).hexdigest()
    size_mb = EXE.stat().st_size / 1024 / 1024
    print()
    print(f"  output : {EXE}")
    print(f"  size   : {size_mb:.1f} MB")
    print(f"  sha256 : {digest}")


def main() -> int:
    if "--skip-web" not in sys.argv:
        build_web()
    build_exe()
    report()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
