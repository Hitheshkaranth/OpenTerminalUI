from __future__ import annotations

import math
import numpy as np
import pandas as pd
import pytest
from backend.models import Holding
from backend.risk_engine.scenario_engine import scenario_engine, ScenarioImpact

def test_parallel_shift_math():
    rng = np.random.default_rng(42)
    # Setup mock holdings
    holdings = [
        Holding(ticker="AAPL", quantity=100, avg_buy_price=150.0), # Value: 15,000
        Holding(ticker="MSFT", quantity=50, avg_buy_price=300.0),  # Value: 15,000
    ]
    portfolio_value = 30000.0

    # Mock returns (252 days)
    dates = pd.date_range(start="2023-01-01", periods=252)
    returns_df = pd.DataFrame(
        rng.normal(0, 0.01, (252, 2)),
        index=dates,
        columns=["AAPL", "MSFT"]
    )
    market_returns = pd.Series(rng.normal(0, 0.01, 252), index=dates)

    # Run Parallel Shift (100 bps)
    impact = scenario_engine.run_stress_test(
        holdings=holdings,
        scenario_type="parallel_shift",
        returns_df=returns_df,
        market_returns=market_returns,
        portfolio_value=portfolio_value,
        params={"shift_bps": 100}
    )

    # Mathematical verification
    # shift_bps = 100 => rate_shock = 0.01
    # equity_shock = -0.05 * (100/100) = -0.05
    # default rate_sensitivity = -0.15
    # expected_pnl_per_unit = -0.15 * 0.01 * 100 + (-0.05) = -0.15 + -0.05 = -0.20
    # wait, my code: pnl = val * (self.default_sensitivities["rate_sensitivity"] * rate_shock * 100 + equity_shock)
    # sensitivities["rate_sensitivity"] = -0.15
    # -0.15 * 0.01 * 100 = -0.15
    # equity_shock = -0.05
    # total pnl per unit = -0.20
    # expected total pnl = 30000 * -0.20 = -6000

    assert math.isclose(impact.projected_pnl, -6000.0, rel_tol=1e-5)
    assert abs(impact.stressed_beta) > abs(impact.base_beta)
    assert impact.stressed_var > impact.base_var

def test_volatility_spike_math():
    rng = np.random.default_rng(42)
    holdings = [Holding(ticker="AAPL", quantity=100, avg_buy_price=100.0)]
    portfolio_value = 10000.0

    dates = pd.date_range(start="2023-01-01", periods=252)
    returns_df = pd.DataFrame(rng.normal(0, 0.01, (252, 1)), index=dates, columns=["AAPL"])
    market_returns = pd.Series(rng.normal(0, 0.01, 252), index=dates)

    # Run Volatility Spike (+50%)
    impact = scenario_engine.run_stress_test(
        holdings=holdings,
        scenario_type="volatility_spike",
        returns_df=returns_df,
        market_returns=market_returns,
        portfolio_value=portfolio_value,
        params={"vol_increase": 0.50}
    )

    # vol_increase = 0.50
    # equity_shock = -0.15 * (0.50/0.50) = -0.15
    # default vol_sensitivity = -0.05
    # expected_pnl = 10000 * (-0.05 * 0.50 + -0.15) = 10000 * (-0.025 - 0.15) = 10000 * -0.175 = -1750

    assert math.isclose(impact.projected_pnl, -1750.0, rel_tol=1e-5)
    assert impact.stressed_var == impact.base_var * 1.5

def test_flash_crash_math():
    rng = np.random.default_rng(42)
    holdings = [Holding(ticker="AAPL", quantity=100, avg_buy_price=100.0)]
    portfolio_value = 10000.0

    dates = pd.date_range(start="2023-01-01", periods=252)
    returns_df = pd.DataFrame(rng.normal(0, 0.01, (252, 1)), index=dates, columns=["AAPL"])
    market_returns = pd.Series(rng.normal(0, 0.01, 252), index=dates)

    # Run Flash Crash (-20%)
    impact = scenario_engine.run_stress_test(
        holdings=holdings,
        scenario_type="flash_crash",
        returns_df=returns_df,
        market_returns=market_returns,
        portfolio_value=portfolio_value,
        params={"drawdown": -0.20}
    )

    # drawdown = -0.20
    # equity_beta = 1.0
    # expected_pnl = 10000 * (-0.20 * 1.0) = -2000

    assert math.isclose(impact.projected_pnl, -2000.0, rel_tol=1e-5)
    assert impact.stressed_beta == impact.base_beta * 1.5
    assert impact.stressed_var == impact.base_var * 2.5

def test_api_endpoint_integration():
    from fastapi import FastAPI, Depends
    from fastapi.testclient import TestClient
    from backend.api.deps import get_db
    from backend.auth.deps import get_current_user
    from backend.api.routes.analytics import router
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from backend.shared.db import Base
    from unittest.mock import AsyncMock

    # Standalone app to avoid test ordering issues
    test_app = FastAPI()
    test_app.include_router(router)

    from sqlalchemy.pool import StaticPool
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    def override_get_current_user():
        return type("User", (), {"id": "test_user"})()

    test_app.dependency_overrides[get_db] = override_get_db
    test_app.dependency_overrides[get_current_user] = override_get_current_user

    # Seed data
    db = TestingSessionLocal()
    db.add(Holding(ticker="AAPL", quantity=100, avg_buy_price=150.0, buy_date="2024-01-15"))
    db.commit()
    db.close()

    # Mock _load_returns to avoid network calls
    import backend.api.routes.analytics as analytics_module
    original_load_returns = getattr(analytics_module, "_load_returns", None)

    rng = np.random.default_rng(42)
    dates = pd.date_range(start="2023-01-01", periods=252)
    mock_returns_df = pd.DataFrame(rng.normal(0, 0.01, (252, 1)), index=dates, columns=["AAPL"])
    mock_market_returns = pd.Series(rng.normal(0, 0.01, 252), index=dates)
    analytics_module._load_returns = AsyncMock(return_value=(mock_returns_df, mock_market_returns))

    client = TestClient(test_app)
    response = client.post("/api/analytics/stress-test", json={
        "scenario_type": "flash_crash",
        "params": {"drawdown": -0.10}
    })

    assert response.status_code == 200
    data = response.json()
    assert data["scenario"] == "Flash Crash"
    assert "metrics" in data
    assert data["metrics"]["projected_pnl"] < 0

    # Restore
    if original_load_returns is not None:
        analytics_module._load_returns = original_load_returns
