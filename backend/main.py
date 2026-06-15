from __future__ import annotations

import asyncio
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from backend.api.deps import shutdown_unified_fetcher
from backend.alerts import get_alert_evaluator_service
from backend.auth.middleware import AuthMiddleware
from backend.adapters.registry import get_adapter_registry
from backend.bg_services.instruments_loader import get_instruments_loader
from backend.bg_services.news_ingestor import get_news_ingestor
from backend.bg_services.pcr_snapshot import get_pcr_snapshot_service
from backend.bg_services.scanner_alert_scheduler import get_scanner_alert_scheduler_service
from backend.services.prefetch_worker import get_prefetch_worker
from backend.services.us_tick_stream import get_us_tick_stream_service
from backend.paper_trading import get_paper_engine
from backend.core.service_status import service_status_registry
from backend.config.env import load_local_env
from backend.config.security import validate_runtime_secrets
from backend.config.settings import get_settings
from backend.shared.cache import cache as cache_instance
from backend.shared.db import init_db
from backend.shared.ws_manager import get_marketdata_hub

load_local_env()

if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

settings = get_settings()

_prefetch_worker = None
_instruments_loader = None
_news_ingestor = None
_pcr_snapshot_service = None
_scanner_alert_scheduler = None
_prefetch_enabled = (
    os.getenv("OPENTERMINALUI_PREFETCH_ENABLED")
    or os.getenv("OPENSCREENS_PREFETCH_ENABLED")
    or os.getenv("TRADE_SCREENS_PREFETCH_ENABLED")
    or "0"
) == "1"


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _prefetch_worker, _instruments_loader, _news_ingestor, _pcr_snapshot_service, _scanner_alert_scheduler
    validate_runtime_secrets()
    init_db()

    from backend.api.deps import get_unified_fetcher
    fetcher = await get_unified_fetcher()

    _prefetch_worker = get_prefetch_worker(fetcher)
    _instruments_loader = get_instruments_loader()
    _news_ingestor = get_news_ingestor()
    _pcr_snapshot_service = get_pcr_snapshot_service()
    _scanner_alert_scheduler = get_scanner_alert_scheduler_service()

    if _prefetch_enabled:
        await _prefetch_worker.start()
    if _instruments_loader:
        await _instruments_loader.start()
    if _news_ingestor:
        await _news_ingestor.start()
    if _pcr_snapshot_service:
        await _pcr_snapshot_service.start()

    hub = get_marketdata_hub()
    await hub.start()

    get_alert_evaluator_service().start(hub)
    get_paper_engine().start(hub)

    if _scanner_alert_scheduler:
        await _scanner_alert_scheduler.start(hub, interval_seconds=900)

    yield

    if _prefetch_worker:
        await _prefetch_worker.stop()
    if _instruments_loader:
        await _instruments_loader.stop()
    if _news_ingestor:
        await _news_ingestor.stop()
    if _pcr_snapshot_service:
        await _pcr_snapshot_service.stop()
    if _scanner_alert_scheduler:
        await _scanner_alert_scheduler.stop()

    await hub.shutdown()
    await shutdown_unified_fetcher()


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AuthMiddleware)

from backend.api.router import api_router

app.include_router(api_router)


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/healthz", tags=["health"])
async def healthz() -> dict[str, object]:
    from backend.api.deps import get_unified_fetcher
    from backend.shared.cache import cache as cache_instance
    from backend.shared.ws_manager import get_marketdata_hub

    hub = get_marketdata_hub()
    fetcher = await get_unified_fetcher()
    cache_health = await cache_instance.health()

    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "cache": cache_health,
        "marketdata_hub": {
            "status": "ok" if hub.is_running else "stopped",
            "clients": hub.client_count,
            "subscriptions": hub.subscription_count,
        },
        "unified_fetcher": {
            "initialized": fetcher is not None,
        },
    }


@app.get("/metrics-lite", tags=["health"])
def metrics_lite() -> dict[str, object]:
    from backend.shared.ws_manager import get_marketdata_hub
    hub = get_marketdata_hub()
    from backend.bg_services.scanner_alert_scheduler import get_scanner_alert_scheduler_service
    scanner_service = get_scanner_alert_scheduler_service()
    scanner_status = scanner_service.status_snapshot() if scanner_service else {}

    return {
        "ws_clients": hub.client_count,
        "ws_subscriptions": hub.subscription_count,
        "scanner_alert_last_run": scanner_status.get("last_run_at"),
        "scanner_alert_last_status": scanner_status.get("last_status"),
        "scanner_alert_scanned_symbols": scanner_status.get("last_scanned_symbols"),
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
