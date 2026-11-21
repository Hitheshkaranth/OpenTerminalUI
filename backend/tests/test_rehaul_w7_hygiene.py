"""W7 hygiene: shared outbound HTTP client and no internal-error text in responses."""
from __future__ import annotations

import asyncio
import json

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.shared import http_client

SECRET = "secret-internal-xyz"


def test_shared_client_is_singleton_within_a_loop_and_close_works():
    async def scenario():
        first = http_client.get_http_client()
        second = http_client.get_http_client()
        assert first is second
        assert isinstance(first, httpx.AsyncClient)
        assert first.follow_redirects is False
        assert first.timeout == httpx.Timeout(15, connect=5)
        await http_client.close_http_client()
        assert first.is_closed
        third = http_client.get_http_client()
        assert third is not first and not third.is_closed
        await http_client.close_http_client()

    asyncio.run(scenario())


def test_shared_client_recreated_on_new_event_loop():
    holder = {}

    async def grab(key):
        holder[key] = http_client.get_http_client()

    asyncio.run(grab("a"))
    asyncio.run(grab("b"))
    assert holder["a"] is not holder["b"]
    asyncio.run(http_client.close_http_client())


def test_shared_client_does_not_persist_cookies_between_calls():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("cookie"))
        return httpx.Response(200, headers={"set-cookie": "sid=abc; Path=/"})

    async def scenario():
        client = http_client.get_http_client()
        client._transport = httpx.MockTransport(handler)
        async with http_client.shared_session(timeout=3, headers={"X-Test": "1"}) as session:
            await session.get("http://provider.test/a")
            await session.get("http://provider.test/b")
        assert not client.is_closed  # leaving the session must not close the shared pool
        await http_client.close_http_client()

    asyncio.run(scenario())
    assert seen == [None, None]


def test_shared_session_applies_per_request_defaults():
    captured = {}

    class Fake:
        async def request(self, method, url, **kwargs):
            captured.update(kwargs, method=method, url=url)
            return httpx.Response(200)

    async def scenario():
        async with http_client.shared_session(timeout=7, headers={"A": "1"}, follow_redirects=True) as s:
            await s.get("http://x.test", headers={"B": "2"})

    orig = http_client.get_http_client
    http_client.get_http_client = lambda: Fake()  # type: ignore[assignment]
    try:
        asyncio.run(scenario())
    finally:
        http_client.get_http_client = orig  # type: ignore[assignment]
    assert captured["timeout"] == 7
    assert captured["follow_redirects"] is True
    assert captured["headers"] == {"A": "1", "B": "2"}


@pytest.mark.parametrize("value, expected", [(None, False), ("0", False), ("1", True), ("true", True)])
def test_shared_client_proxy_trust_env_is_opt_in(monkeypatch, value, expected):
    if value is None:
        monkeypatch.delenv("OPENTERMINALUI_HTTP_TRUST_ENV", raising=False)
    else:
        monkeypatch.setenv("OPENTERMINALUI_HTTP_TRUST_ENV", value)
    seen = {}

    async def scenario():
        await http_client.close_http_client()
        seen["trust_env"] = http_client.get_http_client().trust_env
        await http_client.close_http_client()

    asyncio.run(scenario())
    assert seen["trust_env"] is expected


def _app_with(router) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app, raise_server_exceptions=False)


def test_mutual_fund_route_hides_internal_exception_text(monkeypatch):
    from backend.equity.routes import mutual_funds as route

    async def boom(_code):
        raise RuntimeError(SECRET)

    monkeypatch.setattr(route.mutual_fund_service, "get_fund_performance", boom)
    res = _app_with(route.router).get("/api/mutual-funds/123/performance")
    assert res.status_code == 404
    assert SECRET not in res.text


def test_pair_trading_route_hides_internal_exception_text(monkeypatch):
    from backend.api.routes import pair_trading as route
    from backend.auth.deps import get_current_user

    async def boom(*_a, **_k):
        raise RuntimeError(SECRET)

    monkeypatch.setattr(route, "_load_close_frame", boom)
    app = FastAPI()
    app.include_router(route.router)
    app.dependency_overrides[get_current_user] = lambda: object()
    res = TestClient(app, raise_server_exceptions=False).post(
        "/api/pairs/test", json={"symbol1": "AAA", "symbol2": "BBB"}
    )
    assert res.status_code == 502
    assert res.json() == {"detail": "Pair test failed"}
    assert SECRET not in res.text


def test_sector_rotation_error_has_no_traceback(monkeypatch):
    from backend.services import sector_rotation as sr

    async def no_cache(*_a, **_k):
        return None

    def boom(*_a, **_k):
        raise RuntimeError(SECRET)

    monkeypatch.setattr(sr.cache, "get", no_cache, raising=False)
    monkeypatch.setattr(sr, "_calculate_rrg_metrics", boom)
    out = asyncio.run(sr.fetch_sector_rotation("SPY"))
    assert "trace" not in out
    assert SECRET not in json.dumps(out)


def test_mcp_tool_failure_does_not_leak_exception_text():
    from backend.agent.tools.registry import ToolRegistry, ToolSpec
    from backend.mcp.server import call_tool_for

    async def fail(_args):
        raise RuntimeError(SECRET)

    reg = ToolRegistry()
    reg.register(ToolSpec("fail", "fails", {"type": "object"}, fail, read_only=True))
    content = asyncio.run(call_tool_for(reg, "fail", {}))
    assert SECRET not in content[0].text


def test_strategy_loop_safe_error_keeps_domain_messages_only():
    from backend.agent.strategy_loop.orchestrator import _safe_error

    assert _safe_error(ValueError("Reopening is blocked")) == "Reopening is blocked"
    assert SECRET not in _safe_error(RuntimeError(SECRET))


@pytest.mark.parametrize("module", [
    "backend.core.statlab.stationarity", "backend.core.statlab.cointegration",
    "backend.core.riskfolio.risk_measures", "backend.api.routes.stocks",
])
def test_no_bare_except_left(module):
    import importlib
    import inspect
    import re

    src = inspect.getsource(importlib.import_module(module))
    assert not re.search(r"^\s*except:\s*$", src, re.M)
