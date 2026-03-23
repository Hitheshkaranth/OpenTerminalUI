# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['run_windows.py'],
    pathex=[],
    binaries=[],
    datas=[('frontend/dist', 'frontend/dist'), ('config', 'config'), ('data', 'data'), ('backend/alembic', 'backend/alembic'), ('backend/alembic.ini', 'backend')],
    hiddenimports=['uvicorn.logging', 'uvicorn.loops', 'uvicorn.loops.auto', 'uvicorn.protocols', 'uvicorn.protocols.http', 'uvicorn.protocols.http.auto', 'uvicorn.protocols.websockets', 'uvicorn.protocols.websockets.auto', 'uvicorn.lifespan', 'uvicorn.lifespan.on', 'backend.cockpit.routes', 'backend.portfolio_backtests.routes', 'backend.risk_engine.routes', 'backend.experiments.routes', 'backend.instruments.routes', 'backend.data_quality.routes', 'backend.tca.routes', 'backend.routers.chart_workstation', 'backend.routers.charts'],
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
    [],
    exclude_binaries=True,
    name='OpenTerminalUI',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='OpenTerminalUI',
)
