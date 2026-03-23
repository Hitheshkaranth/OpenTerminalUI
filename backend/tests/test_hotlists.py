from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes.hotlists import router
from backend.services.hotlist_service import HotlistService, get_hotlist_service


def _build_test_app(service: HotlistService) -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_hotlist_service] = lambda: service
    return TestClient(app)


def test_hotlist_route_returns_expected_shape() -> None:
    service = HotlistService(now_factory=lambda: datetime(2026, 3, 20, 14, 45, tzinfo=timezone.utc))
    client = _build_test_app(service)

    response = client.get("/api/hotlists", params={"list_type": "gainers", "market": "IN", "limit": 5})

    assert response.status_code == 200
    body = response.json()
    assert body["list_type"] == "gainers"
    assert body["market"] == "IN"
    assert len(body["items"]) == 5
    first = body["items"][0]
    assert {"symbol", "name", "price", "change", "change_pct", "volume", "sparkline"} <= set(first.keys())
    assert isinstance(first["sparkline"], list)
    assert len(first["sparkline"]) == 5


def test_hotlist_sorting_rules() -> None:
    service = HotlistService(now_factory=lambda: datetime(2026, 3, 20, 14, 45, tzinfo=timezone.utc))

    gainers = service._rank("gainers", [service._row_to_item(row) for row in service._universes["US"]])  # type: ignore[attr-defined]
    losers = service._rank("losers", [service._row_to_item(row) for row in service._universes["US"]])  # type: ignore[attr-defined]
    active = service._rank("most_active", [service._row_to_item(row) for row in service._universes["US"]])  # type: ignore[attr-defined]

    assert gainers[0]["change_pct"] >= gainers[1]["change_pct"]
    assert losers[0]["change_pct"] <= losers[1]["change_pct"]
    assert active[0]["volume"] >= active[1]["volume"]


def test_hotlist_limit_and_market_filtering() -> None:
    service = HotlistService(now_factory=lambda: datetime(2026, 3, 20, 14, 45, tzinfo=timezone.utc))
    client = _build_test_app(service)

    response_in = client.get("/api/hotlists", params={"list_type": "most_active", "market": "IN", "limit": 3})
    response_us = client.get("/api/hotlists", params={"list_type": "most_active", "market": "US", "limit": 3})

    assert response_in.status_code == 200
    assert response_us.status_code == 200
    body_in = response_in.json()
    body_us = response_us.json()
    assert body_in["market"] == "IN"
    assert body_us["market"] == "US"
    assert len(body_in["items"]) == 3
    assert len(body_us["items"]) == 3
    assert body_in["items"][0]["symbol"] != body_us["items"][0]["symbol"]


def test_hotlist_rejects_invalid_inputs() -> None:
    service = HotlistService(now_factory=lambda: datetime(2026, 3, 20, 14, 45, tzinfo=timezone.utc))
    client = _build_test_app(service)

    bad_type = client.get("/api/hotlists", params={"list_type": "invalid", "market": "IN"})
    bad_market = client.get("/api/hotlists", params={"list_type": "gainers", "market": "EU"})

    assert bad_type.status_code == 400
    assert "unsupported list_type" in bad_type.json()["detail"]
    assert bad_market.status_code == 400
    assert "unsupported market" in bad_market.json()["detail"]


def test_hotlist_cache_ttl_respects_market_hours() -> None:
    now = [datetime(2026, 3, 20, 15, 0, tzinfo=timezone.utc)]
    service = HotlistService(now_factory=lambda: now[0])

    first = service._ttl_seconds("US")  # type: ignore[attr-defined]
    now[0] = now[0] + timedelta(hours=10)
    second = service._ttl_seconds("US")  # type: ignore[attr-defined]

    assert first == 5
    assert second == 300
