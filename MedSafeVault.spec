# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the MedSafeVault single-file Windows executable.

Build with tools/build_exe.py, which compiles the React front end first and then
runs:  pyinstaller --noconfirm --clean MedSafeVault.spec
"""
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

ROOT = Path(SPECPATH)

# The front end is loaded from web/dist through backend.paths.web_dir(), which
# resolves against sys._MEIPASS when frozen, so the folder layout is preserved.
datas = [
    (str(ROOT / "web" / "dist"), str(Path("web") / "dist")),
    (str(ROOT / "assets"), "assets"),
]

hiddenimports = [
    "webview.platforms.edgechromium",
    "webview.platforms.winforms",
    "webview.js.css",
    "clr",
    "PythonNET",
    "bottle",
    "proxy_tools",
    "openpyxl",
    "xlrd",
    "olefile",
    "paramiko",
    "bcrypt",
    "nacl",
    "pystray",
    "PIL.Image",
    "PIL.ImageDraw",
] + (
    collect_submodules("webview")
    + collect_submodules("msoffcrypto")
    + collect_submodules("paramiko")
    + collect_submodules("websockets")
    + collect_submodules("pystray")
)

a = Analysis(
    [str(ROOT / "MedSafeVault.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Nothing here is used; dropping them keeps the one-file payload small.
    excludes=[
        "tkinter",
        "unittest",
        "pydoc_data",
        "matplotlib",
        "numpy",
        "scipy",
        "PyQt5",
        "PySide6",
        "cef",
        "qtwebengine",
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=None)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="MedSafeVault",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # UPX trips smart-screen heuristics and is not worth it here
    runtime_tmpdir=None,
    console=False,  # windowed: no console behind the vault window
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(ROOT / "assets" / "app.ico"),
    version=str(ROOT / "packaging" / "version_info.txt"),
)
