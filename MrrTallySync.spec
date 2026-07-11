# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_data_files

mysql_connector_datas = collect_data_files('mysql.connector')


a = Analysis(
    ['python\\tally_mrr_posting.py'],
    pathex=[],
    binaries=[],
    datas=mysql_connector_datas,
    hiddenimports=[
        'mysql.connector.plugins.mysql_native_password',
        'mysql.connector.plugins.caching_sha2_password',
        'mysql.connector.plugins.mysql_clear_password',
        'mysql.connector.plugins.sha256_password',
        'mysql.connector.locales',
        'mysql.connector.locales.eng',
        'mysql.connector.locales.eng.client_error',
    ],
    hookspath=[],
    hooksconfig={},
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
    name='MrrTallySync',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
