"""W5 platform tests: readiness, request id, generic 500, cache LRU / single-flight / redis recovery."""

from __future__ import annotations

import asyncio
import json
import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import backend.main as main
from backend.core.logging import JsonFormatter
from backend.core.request_context import RequestIdFilter, RequestIdMiddleware
from backend.shared import cache as cache_module
from backend.shared.cache import MultiTierCache


@pytest.fixture
def client(monkeypatch):
    # Readiness must not depend on the test env's Redis / hub state unless a test says so.
    monkeypatch.setattr(main.cache_instance, "redis_url", None)
    monkeypatch.setenv("RUN_BACKGROUND_SERVICES", "0")
    return TestClient(main.app, raise_server_exceptions=False)


# ---------------------------------------------------------------- readiness (REL-5)


def test_ready_ok(client):
    for path in ("/ready", "/health/ready"):
        res = client.get(path)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["status"] == "ready"
        assert body["checks"]["database"]["status"] == "ok"
        assert body["checks"]["redis"]["status"] == "skipped"
        assert body["checks"]["marketdata_hub"]["status"] == "skipped"


def test_ready_503_when_db_check_fails(client, monkeypatch):
    def _boom() -> None:
        raise RuntimeError("postgresql://user:secret@db/x unreachable")

    monkeypatch.setattr(main, "_db_ping", _boom)
    res = client.get("/ready")
    assert res.status_code == 503
    body = res.json()
    assert body["status"] == "not_ready"
    assert body["checks"]["database"] == {"status": "error", "error": "RuntimeError"}
    assert "secret" not in res.text


def test_ready_checks_hub_when_background_services_enabled(client, monkeypatch):
    monkeypatch.setenv("RUN_BACKGROUND_SERVICES", "1")
    hub = main.get_marketdata_hub()
    monkeypatch.setattr(type(hub), "is_running", property(lambda self: False))
    res = client.get("/ready")
    assert res.status_code == 503
    assert res.json()["checks"]["marketdata_hub"]["status"] == "error"


def test_health_is_cheap_liveness(client, monkeypatch):
    monkeypatch.setattr(main, "_db_ping", lambda: (_ for _ in ()).throw(RuntimeError("down")))
    assert client.get("/health").json() == {"status": "ok"}


# ----------------------------------------------------- request id + generic 500 (REL-16/17)


def test_request_id_generated_and_echoed(client):
    res = client.get("/health")
    generated = res.headers.get("x-request-id")
    assert generated and len(generated) >= 16

    res = client.get("/health", headers={"X-Request-ID": "abc-123.req"})
    assert res.headers["x-request-id"] == "abc-123.req"

    # Garbage / header-injection-ish ids are replaced, not echoed.
    res = client.get("/health", headers={"X-Request-ID": "bad id with spaces"})
    assert res.headers["x-request-id"] != "bad id with spaces"


def test_unhandled_exception_returns_generic_500_with_request_id():
    app = FastAPI()
    app.add_exception_handler(Exception, main._unhandled_exception_handler)
    app.add_middleware(RequestIdMiddleware)

    @app.get("/boom")
    def boom():
        raise ValueError("super secret internal detail")

    @app.get("/http")
    def http_error():
        from fastapi import HTTPException

        raise HTTPException(status_code=418, detail="teapot")

    c = TestClient(app, raise_server_exceptions=False)
    res = c.get("/boom", headers={"X-Request-ID": "req-500"})
    assert res.status_code == 500
    assert res.json() == {"detail": "Internal server error", "request_id": "req-500"}
    assert res.headers["x-request-id"] == "req-500"
    assert "secret" not in res.text and "Traceback" not in res.text

    # HTTPException is not swallowed by the catch-all handler.
    res = c.get("/http")
    assert res.status_code == 418
    assert res.json() == {"detail": "teapot"}


def test_main_app_registers_generic_500_handler():
    assert main.app.exception_handlers.get(Exception) is main._unhandled_exception_handler
    from slowapi.errors import RateLimitExceeded

    assert RateLimitExceeded in main.app.exception_handlers
    assert main.app.state.limiter is main.limiter


def test_json_log_formatter_includes_request_id():
    record = logging.LogRecord("x", logging.INFO, __file__, 1, "hello %s", ("world",), None)
    record.request_id = "rid-1"
    out = json.loads(JsonFormatter().format(record))
    assert out["message"] == "hello world"
    assert out["request_id"] == "rid-1"
    assert out["level"] == "INFO"

    plain = logging.LogRecord("x", logging.INFO, __file__, 1, "m", (), None)
    RequestIdFilter().filter(plain)
    assert plain.request_id == "-"


# --------------------------------------------------------------------- lifespan (REL-6)


def test_lifespan_background_gate_and_teardown(monkeypatch):
    calls: list[str] = []

    async def fake_fetcher():
        return object()

    async def fake_shutdown_fetcher():
        calls.append("fetcher.stop")

    class FakeHub:
        is_running = False

        async def start(self):
            calls.append("hub.start")

        async def shutdown(self):
            calls.append("hub.stop")
            raise RuntimeError("teardown failure must not block the rest")

    async def fake_close_http():
        calls.append("http.close")

    import backend.api.deps as deps

    monkeypatch.setattr(main, "validate_runtime_secrets", lambda: None)
    monkeypatch.setattr(main, "init_db", lambda: None)
    monkeypatch.setattr(deps, "get_unified_fetcher", fake_fetcher)
    monkeypatch.setattr(main, "shutdown_unified_fetcher", fake_shutdown_fetcher)
    monkeypatch.setattr(main, "get_marketdata_hub", lambda: FakeHub())
    monkeypatch.setattr(main, "_close_shared_http_client", fake_close_http)

    started: list[str] = []

    async def fake_start_bg(stack, fetcher):
        started.append("bg")

    monkeypatch.setattr(main, "_start_background_services", fake_start_bg)
    monkeypatch.setenv("RUN_BACKGROUND_SERVICES", "0")

    async def run():
        async with main.lifespan(FastAPI()):
            pass

    asyncio.run(run())
    assert started == []
    # Reverse order; hub failure is logged and the remaining stops still run.
    assert calls == ["hub.stop", "fetcher.stop", "http.close"]

    calls.clear()
    monkeypatch.setenv("RUN_BACKGROUND_SERVICES", "1")
    asyncio.run(run())
    assert started == ["bg"]


def test_start_failure_stops_already_started_services(monkeypatch):
    calls: list[str] = []

    class Svc:
        def __init__(self, name, fail=False):
            self.name, self.fail = name, fail

        async def start(self, *a, **k):
            if self.fail:
                raise RuntimeError(f"{self.name} failed")
            calls.append(f"{self.name}.start")

        async def stop(self):
            calls.append(f"{self.name}.stop")

    class Hub:
        async def start(self):
            raise RuntimeError("hub feed failed")

    monkeypatch.setattr(main, "_prefetch_enabled", False)
    monkeypatch.setattr(main, "get_prefetch_worker", lambda f: None)
    monkeypatch.setattr(main, "get_instruments_loader", lambda: Svc("instruments"))
    monkeypatch.setattr(main, "get_news_ingestor", lambda: Svc("news"))
    monkeypatch.setattr(main, "get_pcr_snapshot_service", lambda: None)
    monkeypatch.setattr(main, "get_scanner_alert_scheduler_service", lambda: None)
    monkeypatch.setattr(main, "get_marketdata_hub", lambda: Hub())

    async def run():
        from contextlib import AsyncExitStack

        async with AsyncExitStack() as stack:
            await main._start_background_services(stack, object())

    with pytest.raises(RuntimeError, match="hub feed failed"):
        asyncio.run(run())
    assert calls == ["instruments.start", "news.start", "news.stop", "instruments.stop"]


# ------------------------------------------------------------------- cache (REL-15/SCALE-7)


def _fresh_cache(tmp_path, monkeypatch, max_entries="5000", redis_url=None):
    monkeypatch.setenv("CACHE_L1_MAX_ENTRIES", max_entries)
    return MultiTierCache(redis_url=redis_url, db_path=str(tmp_path / "c.db"))


def test_l1_is_bounded_lru(tmp_path, monkeypatch):
    c = _fresh_cache(tmp_path, monkeypatch, max_entries="3")
    for k in ("a", "b", "c"):
        c._set_l1(k, k, 60)
    assert c._get_l1("a") == "a"  # touch a -> b is now least recently used
    c._set_l1("d", "d", 60)
    assert len(c._l1_cache) == 3
    assert c._get_l1("b") is None
    assert c._get_l1("a") == "a" and c._get_l1("d") == "d"


def test_single_flight_calls_fetcher_once(tmp_path, monkeypatch):
    c = _fresh_cache(tmp_path, monkeypatch)
    calls = 0

    async def fetcher():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.05)
        return {"v": 1}

    async def run():
        results = await asyncio.gather(*(c.get_or_fetch("k", 60, fetcher) for _ in range(20)))
        assert all(r == {"v": 1} for r in results)
        # Now cached: no further fetch.
        assert await c.get_or_fetch("k", 60, fetcher) == {"v": 1}
        assert c._inflight == {}

    asyncio.run(run())
    assert calls == 1


def test_single_flight_propagates_errors_and_does_not_cache(tmp_path, monkeypatch):
    c = _fresh_cache(tmp_path, monkeypatch)
    calls = 0

    async def failing():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        raise RuntimeError("upstream down")

    async def run():
        results = await asyncio.gather(
            *(c.get_or_fetch("e", 60, failing) for _ in range(5)), return_exceptions=True
        )
        assert all(isinstance(r, RuntimeError) for r in results)
        assert await c.get("e") is None

    asyncio.run(run())
    assert calls == 1


class _FakeRedis:
    def __init__(self, healthy: bool):
        self.healthy = healthy
        self.store: dict[str, bytes] = {}

    async def ping(self):
        if not self.healthy:
            raise ConnectionError("redis down")
        return True

    async def get(self, key):
        if not self.healthy:
            raise ConnectionError("redis down")
        return self.store.get(key)

    async def setex(self, key, ttl, value):
        if not self.healthy:
            raise ConnectionError("redis down")
        self.store[key] = value

    async def close(self):
        return None


def test_redis_fallback_recovers(tmp_path, monkeypatch):
    c = _fresh_cache(tmp_path, monkeypatch, redis_url="redis://fake:6379/0")
    redis = _FakeRedis(healthy=False)
    monkeypatch.setattr(c, "_new_redis_client", lambda: redis)
    now = [1000.0]
    monkeypatch.setattr(cache_module.time, "time", lambda: now[0])

    async def run():
        await c.initialize()
        assert c._redis_fallback_mode is True and not c.is_redis_available
        # While down, writes land in L3 (SQLite) so nothing is lost.
        await c.set("k1", "v1", ttl=600)
        assert await c._get_l3("k1") == "v1"

        redis.healthy = True
        now[0] += 5  # before the re-probe interval: still in fallback
        await c.get("missing")
        assert c._redis_fallback_mode is True

        now[0] += 31  # past the 30s re-probe interval: recover
        await c.get("missing")
        assert c.is_redis_available

        # Healthy Redis: L2 is written, the L3 write is skipped.
        await c.set("k2", "v2", ttl=600)
        assert "k2" in redis.store
        assert await c._get_l3("k2") is None
        await c.close()

    asyncio.run(run())


def test_l3_purge_runs_from_set(tmp_path, monkeypatch):
    c = _fresh_cache(tmp_path, monkeypatch)
    now = [1000.0]
    monkeypatch.setattr(cache_module.time, "time", lambda: now[0])
    c._last_l3_purge = now[0]

    async def run():
        await c.set("old", "x", ttl=10)
        now[0] += 700  # old has expired and the purge interval has elapsed
        await c.set("new", "y", ttl=10_000)
        rows = [r[0] for r in c._db_conn.execute("SELECT key FROM cache").fetchall()]
        assert rows == ["new"]
        await c.close()

    asyncio.run(run())


def test_snapshot_coalesced_uses_single_flight(monkeypatch):
    import backend.api.deps as deps

    calls = 0

    class FakeFetcher:
        async def fetch_stock_snapshot(self, symbol):
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.05)
            return {"company_name": "Acme", "symbol": symbol}

    async def fake_get_fetcher():
        return FakeFetcher()

    monkeypatch.setattr(deps, "get_unified_fetcher", fake_get_fetcher)
    key = deps.cache_instance.build_key("snapshot", "W5COALESCE", {})
    deps.cache_instance._l1_cache.pop(key, None)

    async def run():
        results = await asyncio.gather(*(deps.fetch_stock_snapshot_coalesced("w5coalesce") for _ in range(20)))
        assert all(r["company_name"] == "Acme" for r in results)

    try:
        asyncio.run(run())
    finally:
        deps.cache_instance._l1_cache.pop(key, None)
    assert calls == 1
