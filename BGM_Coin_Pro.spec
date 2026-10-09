# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules, collect_data_files
hidden = collect_submodules('webview') + collect_submodules('http.server')
datas = collect_data_files('webview') + [
    ('index.html','.'),('app.js','.'),('style.css','.'),('assets','assets'),('update_config.json','.'),('OKU_BENI.txt','.')
]
a = Analysis(['desktop_launcher.py'], pathex=[], binaries=[], datas=datas,
    hiddenimports=hidden, hookspath=[], hooksconfig={}, runtime_hooks=[], excludes=[], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name='BGM Coin Pro', debug=False,
    bootloader_ignore_signals=False, strip=False, upx=True, console=False,
    icon='assets/BGM_Coin_Pro.ico')
