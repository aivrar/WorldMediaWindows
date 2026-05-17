#!/usr/bin/env python3
"""Build the single-file Windows World Media executable."""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ASSET_DIR = ROOT / "assets"
ICON_PATH = ASSET_DIR / "worldmedia.ico"
SPEC_PATH = ROOT / "worldmedia_native.spec"
FRONTEND_DIR = ROOT / "frontend"


def npm_command() -> str:
    return "npm.cmd" if os.name == "nt" else "npm"


def run(cmd: list[str]) -> None:
    print("+ " + " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=ROOT, check=True)


def build_frontend() -> None:
    if not (ROOT / "node_modules").is_dir():
        run([npm_command(), "install"])
    run([npm_command(), "run", "build"])
    if not (FRONTEND_DIR / "index.html").is_file():
        raise RuntimeError("frontend build did not produce frontend/index.html")


def write_spec() -> None:
    spec = f"""# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

webview_datas, webview_binaries, webview_hiddenimports = collect_all('webview')
pythonnet_datas, pythonnet_binaries, pythonnet_hiddenimports = collect_all('pythonnet')
clr_datas, clr_binaries, clr_hiddenimports = collect_all('clr_loader')

a = Analysis(
    ['worldmedia_native.py'],
    pathex=[],
    binaries=webview_binaries + pythonnet_binaries + clr_binaries,
    datas=[
        ('frontend', 'frontend'),
    ] + webview_datas + pythonnet_datas + clr_datas,
    hiddenimports=webview_hiddenimports + pythonnet_hiddenimports + clr_hiddenimports + [
        'webview.platforms.winforms',
        'webview.platforms.edgechromium',
        'clr',
    ],
    hookspath=[],
    hooksconfig={{}},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='WorldMediaWindows',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon={str(ICON_PATH)!r},
)
"""
    SPEC_PATH.write_text(spec, encoding="utf-8")


def build(skip_frontend: bool = False) -> None:
    if not ICON_PATH.is_file():
        raise RuntimeError(f"missing icon: {ICON_PATH}")
    if not skip_frontend:
        build_frontend()
    write_spec()
    run([sys.executable, "-m", "PyInstaller", "--clean", "--noconfirm", str(SPEC_PATH)])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-frontend", action="store_true", help="reuse existing frontend/ bundle")
    args = parser.parse_args()
    build(skip_frontend=args.skip_frontend)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
