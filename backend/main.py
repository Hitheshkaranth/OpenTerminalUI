from __future__ import annotations

import asyncio
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
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


async def _app_startup() -> None:
    _install_windows_loop_exception_filter()
    validate_runtime_secrets()
    service_status_registry.mark_ok("secrets", required=True)
    init_db()
    service_status_registry.mark_ok("database", required=True)

    global _prefetch_worker, _instruments_loader, _news_ingestor, _pcr_snapshot_service, _scanner_alert_scheduler
    from backend.api.deps import get_unified_fetcher
    fetcher = await get_unified_fetcher()
    _prefetch_worker = get_prefetch_worker(fetcher)
    _instruments_loader = get_instruments_loader()
    _news_ingestor = get_news_ingestor()
    _pcr_snapshot_service = get_pcr_snapshot_service()
    _scanner_alert_scheduler = get_scanner_alert_scheduler_service()

    async def _start_optional(name: str, starter, detail: str | None = None) -> bool:
        try:
            await starter()
            service_status_registry.mark_ok(name, required=False, detail=detail)
            return True
        except Exception as exc:
            service_status_registry.mark_degraded(name, required=False, detail=str(exc))
            return False

    if _prefetch_enabled:
        await _start_optional("prefetch_worker", _prefetch_worker.start, detail="enabled")
    else:
        service_status_registry.mark_stopped("prefetch_worker", required=False, detail="disabled")

    if _instruments_loader:
        await _start_optional("instruments_loader", _instruments_loader.start)
    else:
        service_status_registry.mark_stopped("instruments_loader", required=False, detail="not_initialized")

    if _news_ingestor:
        await _start_optional("news_ingestor", _news_ingestor.start)
    else:
        service_status_registry.mark_stopped("news_ingestor", required=False, detail="not_initialized")

    if _pcr_snapshot_service:
        await _start_optional("pcr_snapshot_service", _pcr_snapshot_service.start)
    else:
        service_status_registry.mark_stopped("pcr_snapshot_service", required=False, detail="not_initialized")

    hub = get_marketdata_hub()
    marketdata_ok = await _start_optional("marketdata_hub", hub.start)

    if marketdata_ok:
        try:
            get_alert_evaluator_service().start(hub)
            service_status_registry.mark_ok("alert_evaluator", required=False)
        except Exception as exc:
            service_status_registry.mark_degraded("alert_evaluator", required=False, detail=str(exc))

        try:
            get_paper_engine().start(hub)
            service_status_registry.mark_ok("paper_engine", required=False)
        except Exception as exc:
            service_status_registry.mark_degraded("paper_engine", required=False, detail=str(exc))

        if _scanner_alert_scheduler:
            await _start_optional(
                "scanner_alert_scheduler",
                lambda: _scanner_alert_scheduler.start(hub, interval_seconds=900),
            )
        else:
            service_status_registry.mark_stopped("scanner_alert_scheduler", required=False, detail="not_initialized")
    else:
        service_status_registry.mark_stopped("alert_evaluator", required=False, detail="marketdata_hub_unavailable")
        service_status_registry.mark_stopped("paper_engine", required=False, detail="marketdata_hub_unavailable")
        service_status_registry.mark_stopped("scanner_alert_scheduler", required=False, detail="marketdata_hub_unavailable")


async def _app_shutdown() -> None:
    async def _stop_optional(name: str, stopper, detail: str | None = None) -> None:
        try:
            await stopper()
            service_status_registry.mark_stopped(name, required=False, detail=detail)
        except Exception as exc:
            service_status_registry.mark_degraded(name, required=False, detail=str(exc))

    await _stop_optional("us_tick_stream", get_us_tick_stream_service().shutdown)
    await _stop_optional("marketdata_hub", get_marketdata_hub().shutdown)
    await _stop_optional("alert_evaluator", get_alert_evaluator_service().shutdown)
    await _stop_optional("paper_engine", get_paper_engine().shutdown)
    if _scanner_alert_scheduler:
        await _stop_optional("scanner_alert_scheduler", _scanner_alert_scheduler.stop)
    if _pcr_snapshot_service:
        await _stop_optional("pcr_snapshot_service", _pcr_snapshot_service.stop)
    if _news_ingestor:
        await _stop_optional("news_ingestor", _news_ingestor.stop)
    if _instruments_loader:
        await _stop_optional("instruments_loader", _instruments_loader.stop)
    if _prefetch_enabled and _prefetch_worker:
        await _stop_optional("prefetch_worker", _prefetch_worker.stop)
    await shutdown_unified_fetcher()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await _app_startup()
    try:
        yield
    finally:
        await _app_shutdown()


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
from backend.api.routes.economics import router as economics_router
from backend.api.routes.fixed_income import router as fixed_income_router
from backend.api.routes.forex import router as forex_router
from backend.api.routes.insider import router as insider_router
from backend.api.routes.etf import router as etf_router
from backend.api.routes.watchlists import router as watchlists_router
from backend.routers.chart_workstation import router as chart_workstation_router
from backend.routers.charts import router as charts_router

app.include_router(equity_router)
app.include_router(fno_router)
app.include_router(fixed_income_router)
app.include_router(bonds_router)
app.include_router(economics_router)
app.include_router(commodities_router, prefix="/api")
app.include_router(forex_router, prefix="/api")
app.include_router(ai_router)
app.include_router(analytics_router)
app.include_router(watchlists_router)
app.include_router(insider_router)
app.include_router(etf_router, prefix="/api")

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
    from backend.services.redis_quote_bus import get_quote_bus
    bus = get_quote_bus()

    redis_status = "disabled"
    if cache_instance.redis_url:
        if cache_instance._redis is not None:
            try:
                await cache_instance._redis.ping()
                redis_status = "ok"
            except Exception:
                redis_status = "error"

    bus_status = "ok" if bus.is_connected else "degraded"

    sqlite_status = "ok"
    try:
        if cache_instance._db_conn is None:
            sqlite_status = "disabled"
        else:
            cache_instance._db_conn.execute("SELECT 1")
    except Exception:
        sqlite_status = "disabled"

    service_snapshot = service_status_registry.snapshot()
    return {
        "status": service_status_registry.overall_status(),
        "cache": {
            "mem": "ok",
            "redis": redis_status,
            "sqlite": sqlite_status,
        },
        "quote_bus": bus_status,
        "adapter_registry": get_adapter_registry().health_snapshot(),
        "services": service_snapshot,
    }


@app.get("/metrics-lite", tags=["health"])
async def metrics_lite() -> dict[str, object]:
    hub = get_marketdata_hub()
    from backend.services.redis_quote_bus import get_quote_bus
    bus = get_quote_bus()

    ws_metrics = await hub.metrics_snapshot()
    news_status = _news_ingestor.status_snapshot() if _news_ingestor else {
        "last_news_ingest_at": None,
        "last_news_ingest_status": "not_initialized",
    }
    pcr_status = _pcr_snapshot_service.status_snapshot() if _pcr_snapshot_service else {
        "last_pcr_snapshot_date": None,
        "last_pcr_snapshot_status": "not_initialized",
    }
    scanner_status = _scanner_alert_scheduler.status_snapshot() if _scanner_alert_scheduler else {
        "last_run_at": None,
        "last_status": "not_initialized",
        "last_scanned_symbols": 0,
        "running": False,
    }
    return {
        "ws_connected_clients": ws_metrics.get("ws_connected_clients", 0),
        "ws_subscriptions": ws_metrics.get("ws_subscriptions", 0),
        "redis_bus_connected": bus.is_connected,
        "last_news_ingest_at": news_status.get("last_news_ingest_at"),
        "last_news_ingest_status": news_status.get("last_news_ingest_status"),
        "last_pcr_snapshot_date": pcr_status.get("last_pcr_snapshot_date"),
        "last_pcr_snapshot_status": pcr_status.get("last_pcr_snapshot_status"),
        "scanner_alert_last_run_at": scanner_status.get("last_run_at"),
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
