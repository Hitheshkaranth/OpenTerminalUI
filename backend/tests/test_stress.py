from __future__ import annotations

import math

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.api.routes.risk import router as risk_router
from backend.auth.deps import get_current_user
from backend.models import Holding, PortfolioDefinition
from backend.services.stress_test_service import stress_test_service
from backend.shared.db import Base


def _build_app(seed_portfolio: bool = True) -> tuple[TestClient, sessionmaker]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.include_router(risk_router, prefix="/api")

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

    if seed_portfolio:
        db: Session = SessionLocal()
        try:
            portfolio = PortfolioDefinition(
                id="portfolio-1",
                name="Core Book",
                description="Seed portfolio for stress testing",
                tags=["stress"],
                universe_json={},
                benchmark_symbol="SPY",
                start_date="2024-01-01",
                end_date="2024-12-31",
                rebalance_frequency="WEEKLY",
                weighting_method="EQUAL",
                constraints_json={},
            )
            db.add(portfolio)
            db.add_all(
                [
                    Holding(ticker="RELIANCE.NS", quantity=120, avg_buy_price=2800.0, buy_date="2025-01-15"),
                    Holding(ticker="AAPL", quantity=50, avg_buy_price=180.0, buy_date="2025-02-01"),
                    Holding(ticker="JPM", quantity=80, avg_buy_price=160.0, buy_date="2025-03-03"),
                    Holding(ticker="XOM", quantity=90, avg_buy_price=115.0, buy_date="2025-04-10"),
                ]
            )
            db.commit()
        finally:
            db.close()

    return TestClient(app), SessionLocal


def _stress_payload(scenario: str, portfolio_id: str = "portfolio-1", custom_params: dict[str, float] | None = None) -> dict[str, object]:
    payload: dict[str, object] = {"portfolio_id": portfolio_id, "scenario": scenario}
    if custom_params is not None:
        payload["custom_params"] = custom_params
    return payload


def test_scenarios_endpoint() -> None:
    client, _ = _build_app()
    response = client.get("/api/risk/stress-test/scenarios")
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) >= 4
    assert {item["key"] for item in items} >= {"2008_gfc", "2020_covid", "2013_taper", "2022_rates"}


def test_predefined_scenario_gfc() -> None:
    client, _ = _build_app()
    response = client.post("/api/risk/stress-test", json=_stress_payload("2008_gfc"))
    assert response.status_code == 200
    data = response.json()
    assert data["scenario"] == "2008 Global Financial Crisis"
    assert data["total_pnl"] < 0
    assert data["stressed_value"] < data["portfolio_value"]


def test_predefined_scenario_covid() -> None:
    client, _ = _build_app()
    response = client.post("/api/risk/stress-test", json=_stress_payload("2020_covid"))
    assert response.status_code == 200
    data = response.json()
    assert data["scenario"] == "2020 COVID-19 Crash"
    assert data["total_pnl"] < 0


def test_custom_scenario() -> None:
    client, _ = _build_app()
    response = client.post(
        "/api/risk/stress-test",
        json=_stress_payload("custom", custom_params={"equity": -0.2, "rates": 0.015, "oil": -0.3, "fx_usd": 0.05, "credit_spread": 0.02}),
    )
    assert response.status_code == 200
    data = response.json()
    assert data["scenario"] == "Custom Stress Scenario"
    assert data["portfolio_id"] == "portfolio-1"
    assert data["total_pnl"] != 0


def test_zero_shock() -> None:
    client, _ = _build_app()
    response = client.post(
        "/api/risk/stress-test",
        json=_stress_payload("custom", custom_params={"equity": 0.0, "rates": 0.0, "oil": 0.0, "fx_usd": 0.0, "credit_spread": 0.0}),
    )
    assert response.status_code == 200
    data = response.json()
    assert math.isclose(float(data["total_pnl"]), 0.0, abs_tol=1e-6)
    assert math.isclose(float(data["stressed_value"]), float(data["portfolio_value"]), abs_tol=1e-6)
    contributions = [float(item["contribution_pct"]) for item in data["holdings"]]
    assert math.isclose(sum(contributions), 1.0, abs_tol=1e-6)


def test_contribution_sums() -> None:
    client, _ = _build_app()
    response = client.post("/api/risk/stress-test", json=_stress_payload("2022_rates"))
    assert response.status_code == 200
    data = response.json()
    contributions = [float(item["contribution_pct"]) for item in data["holdings"]]
    assert math.isclose(sum(contributions), 1.0, abs_tol=1e-6)


def test_sector_summary_consistent() -> None:
    client, _ = _build_app()
    response = client.post("/api/risk/stress-test", json=_stress_payload("2008_gfc"))
    assert response.status_code == 200
    data = response.json()
    sector_pnl = sum(float(item["pnl"]) for item in data["sector_summary"])
    assert math.isclose(sector_pnl, float(data["total_pnl"]), abs_tol=1e-6)


def test_invalid_portfolio() -> None:
    client, _ = _build_app(seed_portfolio=False)
    response = client.post("/api/risk/stress-test", json=_stress_payload("2008_gfc", portfolio_id="missing-portfolio"))
    assert response.status_code == 404


def test_historical_replay() -> None:
    client, _ = _build_app()
    response = client.post("/api/risk/stress-test/replay", json=_stress_payload("2008_gfc"))
    assert response.status_code == 200
    data = response.json()
    scenario = stress_test_service.get_scenario("2008_gfc")
    expected_days = (scenario.end_date - scenario.start_date).days + 1
    assert len(data["timeline"]) == expected_days
    assert data["timeline"][0]["date"] == scenario.start_date.isoformat()
    assert data["timeline"][-1]["date"] == scenario.end_date.isoformat()
    assert float(data["max_drawdown_pct"]) <= 0
