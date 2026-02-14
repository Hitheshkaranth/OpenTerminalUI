from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

# Load .env file from backend directory before anything reads os.getenv
_env_file = Path(__file__).resolve().parent / ".env"
if _env_file.exists():
    for _line in _env_file.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _key, _, _val = _line.partition("=")
            os.environ.setdefault(_key.strip(), _val.strip())

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from backend.api.routes import admin, alerts, backtest, chart, fundamentals, health, kite, news, peers, portfolio, quotes, reports, screener, search, stocks, valuation
from backend.api.deps import shutdown_unified_fetcher
from backend.services.prefetch_worker import get_prefetch_worker
from backend.config.settings import get_settings
from backend.db.database import init_db

if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

settings = get_settings()

app = FastAPI(title=settings.app_name, version=settings.app_version)
_prefetch_worker = None
_prefetch_enabled = (
    os.getenv("OPENTERMINALUI_PREFETCH_ENABLED")
    or os.getenv("OPENSCREENS_PREFETCH_ENABLED")
    or os.getenv("TRADE_SCREENS_PREFETCH_ENABLED")
    or "0"
) == "1"


def _install_windows_loop_exception_filter() -> None:
    if not sys.platform.startswith("win"):
        return
    loop = asyncio.get_running_loop()
    default_handler = loop.get_exception_handler()

    def _handler(loop_: asyncio.AbstractEventLoop, context: dict) -> None:
        exc = context.get("exception")
        if isinstance(exc, ConnectionResetError) and getattr(exc, "winerror", None) == 10054:
            return
        if default_handler is not None:
            default_handler(loop_, context)
        else:
            loop_.default_exception_handler(context)

    loop.set_exception_handler(_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stocks.router, prefix="/api", tags=["stocks"])
app.include_router(chart.router, prefix="/api", tags=["chart"])
app.include_router(screener.router, prefix="/api", tags=["screener"])
app.include_router(valuation.router, prefix="/api", tags=["valuation"])
app.include_router(fundamentals.router, prefix="/api", tags=["fundamentals"])
app.include_router(peers.router, prefix="/api", tags=["peers"])
app.include_router(search.router, prefix="/api", tags=["search"])
app.include_router(quotes.router, prefix="/api", tags=["quotes"])
app.include_router(portfolio.router, prefix="/api", tags=["portfolio"])
app.include_router(backtest.router, prefix="/api", tags=["backtest"])
app.include_router(alerts.router, prefix="/api", tags=["alerts"])
app.include_router(reports.router, prefix="/api", tags=["reports"])
app.include_router(news.router, prefix="/api", tags=["news"])
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(kite.router, prefix="/api", tags=["kite"])
app.include_router(admin.router, prefix="/api", tags=["admin"])


@app.on_event("startup")
async def on_startup() -> None:
    _install_windows_loop_exception_filter()
    init_db()
    
    global _prefetch_worker
    from backend.api.deps import get_unified_fetcher
    fetcher = await get_unified_fetcher()
    _prefetch_worker = get_prefetch_worker(fetcher)
    
    if _prefetch_enabled:
        await _prefetch_worker.start()


@app.on_event("shutdown")
async def on_shutdown() -> None:
    if _prefetch_enabled and _prefetch_worker:
        await _prefetch_worker.stop()
    await shutdown_unified_fetcher()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


_frontend_dist = Path(__file__).resolve().parents[1] / "frontend" / "dist"


@app.get("/{full_path:path}")
def spa_entry(full_path: str) -> FileResponse:
    if not _frontend_dist.exists():
        raise HTTPException(status_code=404, detail="Frontend bundle not found")
    requested = _frontend_dist / full_path
    if full_path and requested.exists() and requested.is_file():
        return FileResponse(requested)
    index_file = _frontend_dist / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    raise HTTPException(status_code=404, detail="Frontend entrypoint not found")
