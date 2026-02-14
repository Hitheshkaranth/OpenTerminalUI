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

from backend.api.deps import shutdown_unified_fetcher
from backend.bg_services.instruments_loader import get_instruments_loader
from backend.bg_services.news_ingestor import get_news_ingestor
from backend.equity.routes import equity_router
from backend.fno.routes import fno_router
from backend.services.prefetch_worker import get_prefetch_worker
from backend.config.settings import get_settings
from backend.shared.cache import cache as cache_instance
from backend.shared.db import init_db
from backend.shared.ws_manager import get_marketdata_hub

if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

settings = get_settings()

app = FastAPI(title=settings.app_name, version=settings.app_version)
_prefetch_worker = None
_instruments_loader = None
_news_ingestor = None
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

app.include_router(equity_router)
app.include_router(fno_router)


@app.on_event("startup")
async def on_startup() -> None:
    _install_windows_loop_exception_filter()
    init_db()
    
    global _prefetch_worker, _instruments_loader, _news_ingestor
    from backend.api.deps import get_unified_fetcher
    fetcher = await get_unified_fetcher()
    _prefetch_worker = get_prefetch_worker(fetcher)
    _instruments_loader = get_instruments_loader()
    _news_ingestor = get_news_ingestor()
    
    if _prefetch_enabled:
        await _prefetch_worker.start()
    if _instruments_loader:
        await _instruments_loader.start()
    if _news_ingestor:
        await _news_ingestor.start()

    await get_marketdata_hub().start()


@app.on_event("shutdown")
async def on_shutdown() -> None:
    await get_marketdata_hub().shutdown()
    if _news_ingestor:
        await _news_ingestor.stop()
    if _instruments_loader:
        await _instruments_loader.stop()
    if _prefetch_enabled and _prefetch_worker:
        await _prefetch_worker.stop()
    await shutdown_unified_fetcher()


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/healthz", tags=["health"])
async def healthz() -> dict[str, object]:
    redis_status = "disabled"
    if cache_instance.redis_url:
        redis_status = "disabled"
        if cache_instance._redis is not None:
            try:
                await cache_instance._redis.ping()
                redis_status = "ok"
            except Exception:
                redis_status = "disabled"

    sqlite_status = "ok"
    try:
        if cache_instance._db_conn is None:
            sqlite_status = "disabled"
        else:
            cache_instance._db_conn.execute("SELECT 1")
    except Exception:
        sqlite_status = "disabled"

    return {
        "status": "ok",
        "cache": {
            "mem": "ok",
            "redis": redis_status,
            "sqlite": sqlite_status,
        },
    }


@app.get("/metrics-lite", tags=["health"])
async def metrics_lite() -> dict[str, object]:
    hub = get_marketdata_hub()
    ws_metrics = await hub.metrics_snapshot()
    news_status = _news_ingestor.status_snapshot() if _news_ingestor else {
        "last_news_ingest_at": None,
        "last_news_ingest_status": "not_initialized",
    }
    return {
        "ws_connected_clients": ws_metrics.get("ws_connected_clients", 0),
        "ws_subscriptions": ws_metrics.get("ws_subscriptions", 0),
        "last_news_ingest_at": news_status.get("last_news_ingest_at"),
        "last_news_ingest_status": news_status.get("last_news_ingest_status"),
        "last_kite_stream_status": hub.kite_stream_status(),
    }


_frontend_dist = Path(__file__).resolve().parents[1] / "frontend" / "dist"


@app.get("/{full_path:path}", include_in_schema=False)
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
