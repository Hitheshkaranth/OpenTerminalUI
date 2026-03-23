"""Tests for bond service and routes."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes.bonds import router
from backend.services.bond_service import BondService, get_bond_service


def _make_app(service: BondService) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_bond_service] = lambda: service
    return TestClient(app)


@pytest.fixture
def bond_service():
    return BondService()


@pytest.fixture
def client(bond_service: BondService):
    return _make_app(bond_service)


@pytest.mark.asyncio
async def test_bond_screener_returns_all(bond_service: BondService):
    result = await bond_service.get_bond_screener()
    assert isinstance(result, list)
    assert len(result) >= 3
    for bond in result:
        assert "isin" in bond
        assert "issuer" in bond
        assert "coupon" in bond
        assert "rating" in bond


@pytest.mark.asyncio
async def test_bond_screener_filter_rating(bond_service: BondService):
    result = await bond_service.get_bond_screener(rating="AAA")
    assert all(b["rating"] == "AAA" for b in result)


@pytest.mark.asyncio
async def test_bond_screener_filter_type(bond_service: BondService):
    result = await bond_service.get_bond_screener(issuer_type="Corporate")
    assert all(b["type"] == "Corporate" for b in result)


@pytest.mark.asyncio
async def test_credit_spreads(bond_service: BondService):
    result = await bond_service.get_credit_spreads()
    assert "history" in result
    assert len(result["history"]) == 90
    point = result["history"][0]
    assert "date" in point
    assert "ig_yield" in point
    assert "hy_yield" in point
    assert "spread" in point
    assert point["hy_yield"] > point["ig_yield"]


@pytest.mark.asyncio
async def test_ratings_migration(bond_service: BondService):
    result = await bond_service.get_ratings_migration()
    assert isinstance(result, list)
    assert len(result) >= 2
    for entry in result:
        assert "issuer" in entry
        assert "old_rating" in entry
        assert "new_rating" in entry
        assert "action" in entry
        assert entry["action"] in ("Upgrade", "Downgrade")


def test_bond_screener_route(client: TestClient):
    resp = client.get("/api/bonds/screener")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 3


def test_bond_screener_route_filter(client: TestClient):
    resp = client.get("/api/bonds/screener?rating=AAA")
    assert resp.status_code == 200
    data = resp.json()
    assert all(b["rating"] == "AAA" for b in data)


def test_credit_spreads_route(client: TestClient):
    resp = client.get("/api/bonds/credit-spreads")
    assert resp.status_code == 200
    data = resp.json()
    assert "history" in data
    assert len(data["history"]) == 90


def test_ratings_migration_route(client: TestClient):
    resp = client.get("/api/bonds/ratings-migration")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 2
