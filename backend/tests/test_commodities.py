from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes.commodities import router
from backend.services.commodity_service import (
    CommodityFuturesChainResponse,
    CommodityFuturesPoint,
    CommodityCategoryQuotes,
    CommodityQuote,
    CommodityQuotesResponse,
    CommoditySeasonalPoint,
    CommoditySeasonalResponse,
    CommodityService,
)


def _make_app(service) -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides.clear()

    from backend.api.routes.commodities import get_commodities_service

    app.dependency_overrides[get_commodities_service] = lambda: service
    return TestClient(app)


class FakeCommodityService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str | None]] = []

    async def get_quotes(self) -> CommodityQuotesResponse:
        self.calls.append(("quotes", None))
        return CommodityQuotesResponse(
            as_of=datetime(2026, 3, 20, tzinfo=timezone.utc),
            categories=[
                CommodityCategoryQuotes(
                    id="energy",
                    label="Energy",
                    items=[
                        CommodityQuote(
                            symbol="CL=F",
                            name="WTI Crude Oil",
                            category="energy",
                            price=78.4,
                            change=0.5,
                            change_pct=0.64,
                            volume=120000,
                            sparkline=[77.9, 78.1, 78.3, 78.2, 78.4],
                            previous_close=77.9,
                        )
                    ],
                ),
                CommodityCategoryQuotes(
                    id="metals",
                    label="Metals",
                    items=[
                        CommodityQuote(
                            symbol="GC=F",
                            name="Gold",
                            category="metals",
                            price=2165.0,
                            change=-3.0,
                            change_pct=-0.14,
                            volume=95000,
                            sparkline=[2168.0, 2167.5, 2166.4, 2165.9, 2165.0],
                            previous_close=2168.0,
                        )
                    ],
                ),
                CommodityCategoryQuotes(
                    id="agriculture",
                    label="Agriculture",
                    items=[
                        CommodityQuote(
                            symbol="ZC=F",
                            name="Corn",
                            category="agriculture",
                            price=452.0,
                            change=1.25,
                            change_pct=0.28,
                            volume=83000,
                            sparkline=[450.75, 451.0, 451.6, 451.9, 452.0],
                            previous_close=450.75,
                        )
                    ],
                ),
            ],
        )

    async def get_futures_chain(self, symbol: str) -> CommodityFuturesChainResponse:
        self.calls.append(("futures", symbol))
        return CommodityFuturesChainResponse(
            symbol=symbol.upper(),
            name="WTI Crude Oil",
            as_of=datetime(2026, 3, 20, tzinfo=timezone.utc),
            points=[
                CommodityFuturesPoint(
                    contract=f"{symbol.upper()}-01M",
                    months_out=1,
                    expiry=datetime(2026, 4, 30, tzinfo=timezone.utc).date(),
                    price=78.9,
                    change=0.3,
                    change_pct=0.38,
                    open_interest=120000,
                    volume=32000,
                ),
                CommodityFuturesPoint(
                    contract=f"{symbol.upper()}-02M",
                    months_out=2,
                    expiry=datetime(2026, 5, 31, tzinfo=timezone.utc).date(),
                    price=79.5,
                    change=0.4,
                    change_pct=0.51,
                    open_interest=98000,
                    volume=22000,
                ),
            ],
        )

    async def get_seasonal(self, symbol: str) -> CommoditySeasonalResponse:
        self.calls.append(("seasonal", symbol))
        return CommoditySeasonalResponse(
            symbol=symbol.upper(),
            name="WTI Crude Oil",
            as_of=datetime(2026, 3, 20, tzinfo=timezone.utc),
            years=8,
            monthly=[
                CommoditySeasonalPoint(
                    month="Jan",
                    month_index=1,
                    average_return_pct=1.2,
                    average_price=79.0,
                    observations=10,
                ),
                CommoditySeasonalPoint(
                    month="Feb",
                    month_index=2,
                    average_return_pct=-0.5,
                    average_price=78.6,
                    observations=10,
                ),
            ],
        )


def test_quotes_route_returns_grouped_quotes() -> None:
    service = FakeCommodityService()
    client = _make_app(service)

    response = client.get("/api/commodities/quotes")

    assert response.status_code == 200
    body = response.json()
    assert [group["id"] for group in body["categories"]] == ["energy", "metals", "agriculture"]
    assert body["categories"][0]["items"][0]["symbol"] == "CL=F"
    assert service.calls == [("quotes", None)]


def test_futures_chain_route_returns_term_structure() -> None:
    service = FakeCommodityService()
    client = _make_app(service)

    response = client.get("/api/commodities/futures-chain/CL=F")

    assert response.status_code == 200
    body = response.json()
    assert body["symbol"] == "CL=F"
    assert len(body["points"]) == 2
    assert body["points"][0]["contract"] == "CL=F-01M"
    assert body["points"][0]["months_out"] == 1
    assert service.calls == [("futures", "CL=F")]


def test_seasonal_route_returns_monthly_averages() -> None:
    service = FakeCommodityService()
    client = _make_app(service)

    response = client.get("/api/commodities/seasonal/CL=F")

    assert response.status_code == 200
    body = response.json()
    assert body["symbol"] == "CL=F"
    assert body["years"] >= 5
    assert body["monthly"][0]["month"] == "Jan"
    assert service.calls == [("seasonal", "CL=F")]


def test_service_caches_payloads_until_ttl_expires() -> None:
    now = [datetime(2026, 3, 20, tzinfo=timezone.utc)]

    class MockCache:
        def __init__(self):
            self.store = {}

        async def get(self, key):
            entry = self.store.get(key)
            if entry:
                val, expiry = entry
                if now[0].timestamp() < expiry:
                    return val
                del self.store[key]
            return None

        async def set(self, key, value, ttl=300):
            self.store[key] = (value, now[0].timestamp() + ttl)

        def build_key(self, data_type, symbol, params):
            return f"{data_type}:{symbol}:{params}"

    mock_cache = MockCache()
    service = CommodityService(
        cache_backend=mock_cache,
        quotes_ttl_seconds=60,
        now_factory=lambda: now[0]
    )
    build_calls = {"quotes": 0}

    async def mocked_fetch_live_quotes():
        build_calls["quotes"] += 1
        return CommodityQuotesResponse(as_of=service._now(), categories=[])

    service._fetch_live_quotes = mocked_fetch_live_quotes  # type: ignore[method-assign]

    first = asyncio.run(service.get_quotes())
    second = asyncio.run(service.get_quotes())

    assert first.as_of == second.as_of
    assert build_calls["quotes"] == 1

    now[0] = now[0] + timedelta(seconds=61)
    third = asyncio.run(service.get_quotes())

    assert third.as_of == now[0]
    assert build_calls["quotes"] == 2
