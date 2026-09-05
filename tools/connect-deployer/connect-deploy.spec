# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules

root = Path(SPECPATH)
src = root / "src"
payload = src / "connect_deployer" / "payload" / "install-connect.py"

build_info = src / "connect_deployer" / "build-info.json"
if not build_info.is_file():
    raise SystemExit("Execute python scripts/prepare_build.py antes do PyInstaller.")
hiddenimports = collect_submodules("paramiko")

a = Analysis(
    [str(root / "connect_deploy_entry.py")],
    pathex=[str(src)],
    binaries=[],
    datas=[(str(payload), "connect_deployer/payload"),
           (str(build_info), "connect_deployer")],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="connect-deploy",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
