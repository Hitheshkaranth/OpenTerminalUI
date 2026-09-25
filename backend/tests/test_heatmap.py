from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes import heatmap as heatmap_routes


def _build_client() -> TestClient:
    app = FastAPI()
    app.include_router(heatmap_routes.router, prefix="/api/heatmap")
    return TestClient(app)


def test_heatmap_treemap_returns_ranked_rows() -> None:
    client = _build_client()

    response = client.get("/api/heatmap/treemap")

    assert response.status_code == 200
    payload = response.json()
    assert payload["market"] == "IN"
    assert payload["group"] == "sector"
    assert payload["size_by"] == "market_cap"
    assert payload["data"]
    first = payload["data"][0]
    assert {"symbol", "name", "sector", "industry", "market_cap", "change_pct", "volume", "turnover", "price"} <= set(first)


def test_heatmap_supports_us_market_and_industry_grouping() -> None:
    client = _build_client()

    response = client.get("/api/heatmap/treemap", params={"market": "US", "group": "industry", "period": "1m", "size_by": "volume"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["market"] == "US"
    assert payload["group"] == "industry"
    assert payload["size_by"] == "volume"
    assert payload["groups"]
    assert all(group["group_by"] == "industry" for group in payload["groups"])


def test_heatmap_invalid_period_is_rejected() -> None:
    client = _build_client()

    response = client.get("/api/heatmap/treemap", params={"period": "5y"})

    assert response.status_code == 422


def test_heatmap_rapid_calls_use_same_cached_payload() -> None:
    client = _build_client()

    first = client.get("/api/heatmap/treemap", params={"market": "IN", "period": "1w"})
    second = client.get("/api/heatmap/treemap", params={"market": "IN", "period": "1w"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()


def test_heatmap_flags_rows_without_live_quotes_as_synthetic(monkeypatch) -> None:
    class _NoDataRegistry:
        async def invoke(self, *_args, **_kwargs):
            raise RuntimeError("provider blocked")

    monkeypatch.setattr(heatmap_routes, "get_adapter_registry", lambda: _NoDataRegistry())
    monkeypatch.setattr(heatmap_routes, "_CACHE", {})
    payload = _build_client().get("/api/heatmap/treemap", params={"market": "US"}).json()

    assert payload["data"]
    assert all(row["synthetic"] is True for row in payload["data"])
    assert payload["synthetic_count"] == len(payload["data"])


def test_heatmap_provider_timeout_degrades_instead_of_hanging(monkeypatch) -> None:
    import asyncio

    class _HangingRegistry:
        async def invoke(self, *_args, **_kwargs):
            await asyncio.sleep(30)

    monkeypatch.setattr(heatmap_routes, "get_adapter_registry", lambda: _HangingRegistry())
    monkeypatch.setattr(heatmap_routes, "_PROVIDER_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(heatmap_routes, "_CACHE", {})
    response = _build_client().get("/api/heatmap/treemap", params={"market": "IN"})

    assert response.status_code == 200
    assert response.json()["synthetic_count"] == len(response.json()["data"])
