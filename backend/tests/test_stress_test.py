from __future__ import annotations

import math

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.api.routes.stress_test import _RUN_HISTORY, router as stress_test_router
from backend.auth.deps import get_current_user
from backend.models import Holding, PortfolioDefinition
from backend.shared.db import Base


def _build_app() -> TestClient:
    _RUN_HISTORY.clear()
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.include_router(stress_test_router, prefix="/api")

    def _db_override():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    def _user_override():
        return type("FakeUser", (), {"id": "u_test"})()

    app.dependency_overrides[get_db] = _db_override
    app.dependency_overrides[get_current_user] = _user_override

    db: Session = SessionLocal()
    try:
        db.add(
            PortfolioDefinition(
                id="portfolio-1",
                name="Core Book",
                description="Scenario test portfolio",
                tags=["risk"],
                universe_json={},
                benchmark_symbol="SPY",
                start_date="2025-01-01",
                end_date="2025-12-31",
                rebalance_frequency="MONTHLY",
                weighting_method="EQUAL",
                constraints_json={},
            )
        )
        db.add_all(
            [
                Holding(ticker="AAPL", quantity=100, avg_buy_price=180.0, buy_date="2025-01-15"),
                Holding(ticker="JPM", quantity=80, avg_buy_price=160.0, buy_date="2025-02-10"),
                Holding(ticker="RELIANCE.NS", quantity=120, avg_buy_price=2800.0, buy_date="2025-03-20"),
                Holding(ticker="XOM", quantity=90, avg_buy_price=115.0, buy_date="2025-04-05"),
            ]
        )
        db.commit()
    finally:
        db.close()

    return TestClient(app)


def test_predefined_scenarios_list_returns_all_six_scenarios() -> None:
    client = _build_app()
    response = client.get("/api/risk/scenarios/predefined")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 6
    assert {item["id"] for item in data} == {
        "gfc_2008",
        "covid_2020",
        "rate_shock_200bps",
        "inr_depreciation",
        "tech_rotation",
        "commodity_spike",
    }


def test_running_gfc_scenario_returns_negative_total_impact() -> None:
    client = _build_app()
    response = client.post("/api/risk/scenarios/run", json={"portfolio_id": "portfolio-1", "scenario_id": "gfc_2008"})
    assert response.status_code == 200
    data = response.json()
    assert data["scenario_name"] == "2008 Global Financial Crisis"
    assert float(data["total_impact_pct"]) < 0
    assert float(data["total_impact_value"]) < 0


def test_zero_custom_shocks_return_near_zero_impact() -> None:
    client = _build_app()
    response = client.post(
        "/api/risk/scenarios/run",
        json={
            "portfolio_id": "portfolio-1",
            "custom_shocks": {
                "equity": 0.0,
                "rates": 0.0,
                "volatility": 0.0,
                "fx_inr": 0.0,
                "gold": 0.0,
                "crude_oil": 0.0,
            },
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert math.isclose(float(data["total_impact_pct"]), 0.0, abs_tol=1e-9)
    assert math.isclose(float(data["total_impact_value"]), 0.0, abs_tol=1e-6)


def test_monte_carlo_returns_valid_percentiles() -> None:
    client = _build_app()
    response = client.post("/api/risk/scenarios/monte-carlo", json={"portfolio_id": "portfolio-1", "n_simulations": 500})
    assert response.status_code == 200
    data = response.json()
    percentiles = data["percentiles"]
    assert percentiles["p5"] < percentiles["p50"] < percentiles["p95"]
    assert percentiles["p25"] < percentiles["p75"]
    assert len(data["paths"]) == 100


def test_holding_impacts_sum_to_total_impact() -> None:
    client = _build_app()
    response = client.post("/api/risk/scenarios/run", json={"portfolio_id": "portfolio-1", "scenario_id": "commodity_spike"})
    assert response.status_code == 200
    data = response.json()
    holding_sum = sum(float(item["impact_value"]) for item in data["by_holding"])
    assert math.isclose(holding_sum, float(data["total_impact_value"]), rel_tol=1e-9, abs_tol=1e-6)


def test_worst_holdings_are_sorted_worst_first() -> None:
    client = _build_app()
    response = client.post("/api/risk/scenarios/run", json={"portfolio_id": "portfolio-1", "scenario_id": "gfc_2008"})
    assert response.status_code == 200
    data = response.json()
    impacts = [float(item["impact_pct"]) for item in data["worst_holdings"]]
    assert impacts == sorted(impacts)
