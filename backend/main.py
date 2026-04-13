from __future__ import annotations

import asyncio
import os
import sys
from contextlib import asynccontextmanager
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
from backend.equity.routes import equity_router
from backend.fno.routes import fno_router
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

from backend.cockpit.routes import router as cockpit_router
from backend.portfolio_backtests.routes import router as portfolio_backtests_router
from backend.risk_engine.routes import router as risk_router
from backend.experiments.routes import router as experiments_router
from backend.instruments.routes import router as instruments_router
from backend.data_quality.routes import router as data_quality_router
from backend.tca.routes import router as tca_router
from backend.api.routes.ai import router as ai_router
from backend.api.routes.analytics import router as analytics_router
from backend.api.routes.bonds import router as bonds_router
from backend.api.routes.commodities import router as commodities_router
from backend.api.routes.correlation import router as correlation_router
from backend.api.routes.economics import router as economics_router
from backend.api.routes.factor_analysis import router as factor_analysis_router
from backend.api.routes.fixed_income import router as fixed_income_router
from backend.api.routes.forex import router as forex_router
from backend.api.routes.heatmap import router as heatmap_router
from backend.api.routes.insider import router as insider_router
from backend.api.routes.journal import router as journal_router
from backend.api.routes.etf import router as etf_router
from backend.api.routes.fno_flow import router as fno_flow_router
from backend.api.routes.notifications import router as notifications_router
from backend.api.routes.stress_test import router as stress_test_router
from backend.api.routes.tape import router as tape_router
from backend.api.routes.watchlists import router as watchlists_router
from backend.api.routes.admin_data_quality import router as admin_data_quality_router
from backend.routers.chart_workstation import router as chart_workstation_router
from backend.routers.charts import router as charts_router

app.include_router(equity_router)
app.include_router(fno_router)
app.include_router(commodities_router, prefix="/api")
app.include_router(forex_router, prefix="/api")
app.include_router(factor_analysis_router, prefix="/api")
app.include_router(ai_router, prefix="/api")
app.include_router(analytics_router, prefix="/api")
app.include_router(fno_flow_router, prefix="/api")
app.include_router(heatmap_router, prefix="/api/heatmap")
app.include_router(journal_router, prefix="/api/journal")
app.include_router(notifications_router, prefix="/api/notifications")
app.include_router(stress_test_router, prefix="/api")
app.include_router(watchlists_router, prefix="/api")
app.include_router(insider_router, prefix="/api")
app.include_router(etf_router, prefix="/api")
app.include_router(tape_router, prefix="/api/tape")
app.include_router(admin_data_quality_router, prefix="/api/admin/data-quality")

# Quant Feature Pack Routers (Swarm 0 Stubs)
app.include_router(cockpit_router, prefix="/api")
app.include_router(portfolio_backtests_router, prefix="/api")
app.include_router(risk_router, prefix="/api")
app.include_router(experiments_router, prefix="/api")
app.include_router(instruments_router, prefix="/api")
app.include_router(data_quality_router, prefix="/api")
app.include_router(tca_router, prefix="/api")
app.include_router(chart_workstation_router)
app.include_router(charts_router)


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
            "clients": len(hub.clients),
            "subscriptions": sum(len(s) for s in hub.subscriptions.values()),
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
    scanner_status = scanner_service.get_status() if scanner_service else {}

    return {
        "ws_clients": len(hub.clients),
        "ws_subscriptions": sum(len(s) for s in hub.subscriptions.values()),
        "scanner_alert_last_run": scanner_status.get("last_run"),
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
