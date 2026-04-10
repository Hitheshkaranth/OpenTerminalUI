from __future__ import annotations

import math

import pandas as pd
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.api.routes import screener
from backend.core import formula_engine
from backend.shared.db import Base


def _build_client() -> TestClient:
    app = FastAPI()
    app.include_router(screener.router, prefix="/api")

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def _override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override_get_db
    return TestClient(app)


def test_validate_accepts_supported_formulas() -> None:
    assert formula_engine.validate("pe + pb") == (True, "")
    assert formula_engine.validate("abs(revenue_growth)") == (True, "")
    assert formula_engine.validate("pe * pb / roe") == (True, "")


def test_validate_rejects_unsafe_formulas() -> None:
    for expr in ("import os", "__import__('os')", "open('file')", "x.y"):
        valid, error = formula_engine.validate(expr)
        assert valid is False
        assert error


def test_division_by_zero_returns_nan() -> None:
    result = formula_engine.evaluate("pe / (pb - pb)", {"pe": 10, "pb": 2})
    assert math.isnan(result)


def test_unknown_variable_raises_error() -> None:
    valid, error = formula_engine.validate("unknown_metric + 1")
    assert valid is False
    assert "Unknown field" in error


def test_custom_formula_api_returns_sorted_results(monkeypatch) -> None:
    async def _fake_hydrate(_tickers, _warnings, refresh_cap=40):
        frame = pd.DataFrame(
            [
                {"ticker": "AAA", "company_name": "Alpha", "sector": "Tech", "pe": 10.0, "pb_calc": 2.0, "roe_pct": 15.0, "market_cap": 1000.0, "current_price": 100.0},
                {"ticker": "BBB", "company_name": "Beta", "sector": "Bank", "pe": 8.0, "pb_calc": 1.5, "roe_pct": 18.0, "market_cap": 1200.0, "current_price": 90.0},
                {"ticker": "CCC", "company_name": "Gamma", "sector": "Tech", "pe": 12.0, "pb_calc": 1.0, "roe_pct": 20.0, "market_cap": 900.0, "current_price": 110.0},
            ]
        )
        return frame, 0

    monkeypatch.setattr(screener, "_load_custom_formula_universe", lambda _universe: ["AAA", "BBB", "CCC"])
    monkeypatch.setattr(screener, "_hydrate_missing_screener_rows", _fake_hydrate)

    client = _build_client()
    response = client.post(
        "/api/screener/custom-formula",
        json={
            "formula": "pe * pb",
            "universe": "nifty200",
            "sort": "desc",
            "limit": 2,
            "filter_expr": "market_cap >= 950",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 2
    assert [row["symbol"] for row in payload["results"]] == ["AAA", "BBB"]
    assert payload["results"][0]["computed_value"] >= payload["results"][1]["computed_value"]


def test_saved_formulas_crud() -> None:
    client = _build_client()

    create_response = client.post(
        "/api/screener/saved-formulas",
        json={"name": "Graham Proxy", "formula": "pe * pb", "description": "Valuation blend"},
    )
    assert create_response.status_code == 200
    created = create_response.json()
    assert created["name"] == "Graham Proxy"

    list_response = client.get("/api/screener/saved-formulas")
    assert list_response.status_code == 200
    items = list_response.json()
    assert len(items) == 1
    assert items[0]["formula"] == "pe * pb"

    delete_response = client.delete(f"/api/screener/saved-formulas/{created['id']}")
    assert delete_response.status_code == 200

    list_after_delete = client.get("/api/screener/saved-formulas")
    assert list_after_delete.status_code == 200
    assert list_after_delete.json() == []
