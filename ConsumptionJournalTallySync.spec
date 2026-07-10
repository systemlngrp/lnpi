# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files
from PyInstaller.utils.hooks import collect_submodules

datas = []
hiddenimports = [
    'mysql.connector.locales.eng.client_error',
    'mysql.connector.plugins.mysql_native_password',
    'mysql.connector.plugins.caching_sha2_password',
    'mysql.connector.plugins.mysql_clear_password',
    'mysql.connector.plugins.sha256_password',
]
datas += collect_data_files('mysql.connector')
hiddenimports += collect_submodules('mysql.connector.locales')


a = Analysis(
    ['python\\tally_consumption_journal_posting.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        '_mysql_connector',
        'mysql.connector.connection_cext',
        'mysql.connector.cursor_cext',
        'mysql.connector.aio.connection_cext',
    ],
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
    name='ConsumptionJournalTallySync',
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
