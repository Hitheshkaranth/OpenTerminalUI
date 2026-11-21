from __future__ import annotations

import logging

from backend.core.logging import configure_logging

configure_logging()

import asyncio
import inspect
import os
import sys
from contextlib import AsyncExitStack, asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from backend.api.deps import shutdown_unified_fetcher
from backend.alerts import get_alert_evaluator_service
from backend.auth.middleware import AuthMiddleware
from backend.auth.csrf import CsrfProtectMiddleware
from backend.adapters.registry import get_adapter_registry
from backend.bg_services.instruments_loader import get_instruments_loader
from backend.bg_services.news_ingestor import get_news_ingestor
from backend.bg_services.pcr_snapshot import get_pcr_snapshot_service
from backend.bg_services.scanner_alert_scheduler import get_scanner_alert_scheduler_service
from backend.services.prefetch_worker import get_prefetch_worker
from backend.services.us_tick_stream import get_us_tick_stream_service
from backend.paper_trading import get_paper_engine
from backend.core.request_context import REQUEST_ID_HEADER, RequestIdMiddleware, get_request_id
from backend.core.service_status import service_status_registry
from backend.config.env import load_local_env
from backend.config.security import is_development_env, validate_runtime_secrets
from backend.config.settings import get_settings
from backend.equity.routes.auth import limiter
from backend.shared.cache import cache as cache_instance
from backend.shared.db import init_db
from backend.shared.ws_manager import get_marketdata_hub

load_local_env()

if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

logger = logging.getLogger(__name__)

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


def background_services_enabled() -> bool:
    """Contract C6: RUN_BACKGROUND_SERVICES=0 runs an API-only process (no schedulers,
    ingestors, engines or hub feeds), the first step of the API-tier / engine-tier split."""
    return os.getenv("RUN_BACKGROUND_SERVICES", "1").strip().lower() not in {"0", "false", "no", "off"}


def _guarded_stop(name: str, stop: Callable[[], Any]) -> Callable[[], Awaitable[None]]:
    """Wrap a stop/shutdown callable so one failing teardown never blocks the rest."""

    async def _run() -> None:
        try:
            result = stop()
            if inspect.isawaitable(result):
                await result
        except Exception:
            logger.exception("shutdown of %s failed", name)

    return _run


async def _close_shared_http_client() -> None:
    try:
        from backend.shared.http_client import close_http_client
    except Exception:  # module absent: nothing to close
        return
    await close_http_client()


async def _start_background_services(stack: AsyncExitStack, fetcher: Any) -> None:
    """Start schedulers/ingestors/engines, registering each stop right after its start.

    AsyncExitStack runs the stops in reverse order on shutdown, and also when a later
    start raises, so already-started services are always torn down.
    """
    global _prefetch_worker, _instruments_loader, _news_ingestor, _pcr_snapshot_service, _scanner_alert_scheduler

    _prefetch_worker = get_prefetch_worker(fetcher)
    _instruments_loader = get_instruments_loader()
    _news_ingestor = get_news_ingestor()
    _pcr_snapshot_service = get_pcr_snapshot_service()
    _scanner_alert_scheduler = get_scanner_alert_scheduler_service()

    if _prefetch_enabled and _prefetch_worker:
        await _prefetch_worker.start()
        stack.push_async_callback(_guarded_stop("prefetch worker", _prefetch_worker.stop))
    if _instruments_loader:
        await _instruments_loader.start()
        stack.push_async_callback(_guarded_stop("instruments loader", _instruments_loader.stop))
    if _news_ingestor:
        await _news_ingestor.start()
        stack.push_async_callback(_guarded_stop("news ingestor", _news_ingestor.stop))
    if _pcr_snapshot_service:
        await _pcr_snapshot_service.start()
        stack.push_async_callback(_guarded_stop("pcr snapshot", _pcr_snapshot_service.stop))

    hub = get_marketdata_hub()
    await hub.start()

    alert_evaluator = get_alert_evaluator_service()
    alert_evaluator.start(hub)
    stack.push_async_callback(_guarded_stop("alert evaluator", alert_evaluator.shutdown))
    paper_engine = get_paper_engine()
    paper_engine.start(hub)
    stack.push_async_callback(_guarded_stop("paper engine", paper_engine.shutdown))

    if _scanner_alert_scheduler:
        await _scanner_alert_scheduler.start(hub, interval_seconds=900)
        stack.push_async_callback(_guarded_stop("scanner alert scheduler", _scanner_alert_scheduler.stop))

    from backend.research_dossiers.scheduler import start_dossier_monitor, stop_dossier_monitor
    await start_dossier_monitor()
    stack.push_async_callback(_guarded_stop("dossier monitor", stop_dossier_monitor))
    from backend.screen_monitoring.scheduler import start_screen_monitor, stop_screen_monitor
    await start_screen_monitor()
    stack.push_async_callback(_guarded_stop("screen monitor", stop_screen_monitor))
    from backend.filings_watch.scheduler import start_filings_watch, stop_filings_watch
    try:
        await start_filings_watch()
    except Exception:
        logger.exception("filings watch failed to start")
    stack.push_async_callback(_guarded_stop("filings watch", stop_filings_watch))


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_runtime_secrets()
    init_db()

    run_background = background_services_enabled()
    app.state.background_services_enabled = run_background

    async with AsyncExitStack() as stack:
        # Registered first => runs last.
        stack.push_async_callback(_guarded_stop("shared http client", _close_shared_http_client))

        from backend.api.deps import get_unified_fetcher
        fetcher = await get_unified_fetcher()
        stack.push_async_callback(_guarded_stop("unified fetcher + cache", shutdown_unified_fetcher))

        # The hub also starts lazily when a WebSocket registers, so always stop it.
        hub = get_marketdata_hub()
        stack.push_async_callback(_guarded_stop("marketdata hub", hub.shutdown))

        if run_background:
            await _start_background_services(stack, fetcher)
        else:
            logger.info("RUN_BACKGROUND_SERVICES=0: skipping schedulers, ingestors, engines and hub feeds")

        yield


# Interactive docs / the OpenAPI schema are served outside the /api auth middleware,
# so only expose them in development (SEC-19).
_docs_enabled = is_development_env()
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan,
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)

# Contract C7: slowapi needs the limiter on app.state, and a 429 handler.
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    response = JSONResponse({"detail": f"Rate limit exceeded: {exc.detail}"}, status_code=429)
    try:
        view_rate_limit = getattr(request.state, "view_rate_limit", None)
        if view_rate_limit is not None:
            response = request.app.state.limiter._inject_headers(response, view_rate_limit)
    except Exception:
        pass
    return response


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """REL-17: never leak stack traces; log with the request id and return a generic 500.

    HTTPException/validation errors have their own handlers and never reach this one."""
    request_id = getattr(request.state, "request_id", None) or get_request_id() or "-"
    logger.error(
        "Unhandled exception on %s %s",
        request.method,
        request.url.path,
        exc_info=(type(exc), exc, exc.__traceback__),
        extra={"request_id": request_id},
    )
    return JSONResponse(
        {"detail": "Internal server error", "request_id": request_id},
        status_code=500,
        headers={REQUEST_ID_HEADER: request_id},
    )

# SECURITY FIX: Explicit CORS configuration instead of allowing all methods/headers.
# Only the HTTP methods actually used by the API are permitted.
_ALLOWED_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]
_ALLOWED_HEADERS = ["Content-Type", "Authorization", "X-CSRF-Token", "Accept", "Origin", REQUEST_ID_HEADER]

app.add_middleware(AuthMiddleware)

# CSRF protection for state-changing requests.
app.add_middleware(CsrfProtectMiddleware)

# CORS must be the OUTERMOST middleware (Starlette runs the last-added one
# first). Otherwise AuthMiddleware answers the browser's unauthenticated
# preflight OPTIONS with 401 (so every cross-origin call fails as a network
# error), and 401/403s from auth/CSRF carry no CORS headers, so the client
# can never see them to trigger a token refresh.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=_ALLOWED_METHODS,
    allow_headers=_ALLOWED_HEADERS,
    expose_headers=[REQUEST_ID_HEADER],
)

# Request id wraps everything (including CORS) so every response and log line carries
# X-Request-ID. Pure ASGI, so it does not interfere with CORS preflight handling.
app.add_middleware(RequestIdMiddleware)

from backend.api.router import api_router

app.include_router(api_router)


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    """Liveness only: cheap, no dependencies."""
    return {"status": "ok"}


_READINESS_DB_TIMEOUT_SECONDS = 3.0
_READINESS_REDIS_TIMEOUT_SECONDS = 1.0


def _db_ping() -> None:
    from backend.shared.db import SessionLocal

    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
    finally:
        db.close()


async def _check_database() -> dict[str, str]:
    try:
        await asyncio.wait_for(run_in_threadpool(_db_ping), timeout=_READINESS_DB_TIMEOUT_SECONDS)
        return {"status": "ok"}
    except Exception as exc:  # error type only: messages can carry connection strings
        return {"status": "error", "error": type(exc).__name__}


async def _check_redis() -> dict[str, str]:
    redis_url = cache_instance.redis_url
    if not redis_url:
        return {"status": "skipped"}
    from redis import asyncio as aioredis

    client = None
    try:
        client = aioredis.from_url(
            redis_url,
            socket_timeout=_READINESS_REDIS_TIMEOUT_SECONDS,
            socket_connect_timeout=_READINESS_REDIS_TIMEOUT_SECONDS,
        )
        await asyncio.wait_for(client.ping(), timeout=_READINESS_REDIS_TIMEOUT_SECONDS)
        return {"status": "ok"}
    except Exception as exc:
        return {"status": "error", "error": type(exc).__name__}
    finally:
        if client is not None:
            try:
                await client.close()
            except Exception:
                pass


def _check_hub() -> dict[str, str]:
    if not background_services_enabled():
        return {"status": "skipped"}
    return {"status": "ok" if get_marketdata_hub().is_running else "error"}


async def readiness_checks() -> tuple[bool, dict[str, dict[str, str]]]:
    database, redis_check = await asyncio.gather(_check_database(), _check_redis())
    checks = {"database": database, "redis": redis_check, "marketdata_hub": _check_hub()}
    ready = all(check["status"] != "error" for check in checks.values())
    return ready, checks


@app.get("/ready", tags=["health"])
@app.get("/health/ready", tags=["health"], include_in_schema=False)
async def ready() -> JSONResponse:
    """Readiness: DB, Redis (if configured) and the hub (if this process runs it)."""
    is_ready, checks = await readiness_checks()
    return JSONResponse(
        {"status": "ready" if is_ready else "not_ready", "checks": checks},
        status_code=200 if is_ready else 503,
    )


@app.get("/healthz", tags=["health"])
async def healthz() -> JSONResponse:
    from backend.api.deps import get_unified_fetcher

    is_ready, checks = await readiness_checks()
    hub = get_marketdata_hub()
    fetcher = await get_unified_fetcher()
    cache_health = await cache_instance.health()

    return JSONResponse(
        {
            "status": "ok" if is_ready else "degraded",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "checks": checks,
            "cache": cache_health,
            "marketdata_hub": {
                "status": "ok" if hub.is_running else "stopped",
                "clients": hub.client_count,
                "subscriptions": hub.subscription_count,
            },
            "unified_fetcher": {
                "initialized": fetcher is not None,
            },
        },
        status_code=200 if is_ready else 503,
    )


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
_frontend_app_entry_paths = {
    "login",
    "register",
    "forgot-access",
    "home",
    "stocks",
    "security",
    "commodities",
    "forex",
    "hotlists",
    "dashboard",
    "screener",
    "compare",
    "portfolio",
    "portfolio-lab",
    "mutual-funds",
    "watchlist",
    "news",
    "alerts",
    "paper",
    "risk",
    "correlation",
    "oms",
    "ops",
    "settings",
    "plugins",
    "saved-views",
    "cockpit",
    "model-lab",
    "equity",
    "fno",
    "backtesting",
    "account",
    "reports",  # /reports served the marketing page instead of the SPA
    "research",  # Public, revocable research snapshot links use the application shell.
}


@app.get("/{full_path:path}", include_in_schema=False)
def spa_entry(full_path: str) -> FileResponse:
    if full_path.split("/", 1)[0] == "api":
        raise HTTPException(status_code=404, detail="Not found")
    if not _frontend_dist.exists():
        raise HTTPException(status_code=404, detail="Frontend bundle not found")
    requested = (_frontend_dist / full_path).resolve()
    if not requested.is_relative_to(_frontend_dist.resolve()):
        raise HTTPException(status_code=404, detail="Not found")
    if full_path and requested.exists() and requested.is_file():
        return FileResponse(requested)
    if full_path and requested.exists() and requested.is_dir():
        directory_index = requested / "index.html"
        if directory_index.exists():
            return FileResponse(directory_index)
    if full_path and (Path(full_path).suffix or full_path.startswith("assets/")):
        raise HTTPException(status_code=404, detail="Static asset not found")
    first_segment = full_path.split("/", 1)[0] if full_path else ""
    if first_segment in _frontend_app_entry_paths:
        app_file = _frontend_dist / "app.html"
        if app_file.exists():
            return FileResponse(app_file)
    index_file = _frontend_dist / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    raise HTTPException(status_code=404, detail="Frontend entrypoint not found")
