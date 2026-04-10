from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
import numpy as np
import pytest

from backend.api.routes import factor_analysis
from backend.auth.deps import get_current_user
from backend.risk_engine.factor_attribution import FactorAttributionEngine


def _build_universe() -> tuple[list[dict], list[dict], list[str]]:
    dates = [f"2025-01-{day:02d}" for day in range(1, 91)]
    market = np.sin(np.linspace(0, 4 * np.pi, 90)) * 0.004 + 0.0012
    size = np.cos(np.linspace(0, 3 * np.pi, 90)) * 0.0025
    value = np.sin(np.linspace(0, 2 * np.pi, 90) + 0.7) * 0.0018
    momentum = np.linspace(-0.0015, 0.0025, 90)
    quality = np.cos(np.linspace(0, 1.5 * np.pi, 90) + 0.3) * 0.0014
    low_vol = -np.sin(np.linspace(0, 2.5 * np.pi, 90) + 0.9) * 0.0012
    factor_map = {
        "market": market,
        "size": size,
        "value": value,
        "momentum": momentum,
        "quality": quality,
        "low_vol": low_vol,
    }
    specs = [
        ("AAA", 500.0, 1.2, 8.0, 1.35, {"market": 1.10, "size": 1.20, "value": -0.40, "momentum": 0.85, "quality": 0.20, "low_vol": -0.75}),
        ("BBB", 800.0, 1.6, 10.0, 1.20, {"market": 1.00, "size": 0.80, "value": -0.10, "momentum": 0.50, "quality": 0.30, "low_vol": -0.55}),
        ("CCC", 2_500.0, 2.2, 13.0, 1.00, {"market": 0.95, "size": 0.20, "value": 0.10, "momentum": 0.20, "quality": 0.60, "low_vol": -0.20}),
        ("DDD", 8_000.0, 3.0, 18.0, 0.85, {"market": 0.90, "size": -0.30, "value": 0.40, "momentum": -0.10, "quality": 0.85, "low_vol": 0.20}),
        ("EEE", 15_000.0, 4.2, 21.0, 0.75, {"market": 0.82, "size": -0.75, "value": 0.85, "momentum": -0.40, "quality": 1.05, "low_vol": 0.65}),
        ("FFF", 25_000.0, 5.1, 25.0, 0.65, {"market": 0.76, "size": -1.10, "value": 1.10, "momentum": -0.75, "quality": 1.20, "low_vol": 0.95}),
    ]
    universe = []
    holdings = []
    for idx, (symbol, market_cap, pb_ratio, roe, beta, loadings) in enumerate(specs):
        series = (
            loadings["market"] * factor_map["market"]
            + loadings["size"] * factor_map["size"]
            + loadings["value"] * factor_map["value"]
            + loadings["momentum"] * factor_map["momentum"]
            + loadings["quality"] * factor_map["quality"]
            + loadings["low_vol"] * factor_map["low_vol"]
            + (idx - 2) * 0.00006
        )
        universe.append(
            {
                "symbol": symbol,
                "dates": dates,
                "returns": [float(value) for value in series],
                "market_cap": market_cap,
                "pb_ratio": pb_ratio,
                "roe": roe,
                "beta": beta,
                "momentum_12m": float(np.sum(series)),
            }
        )
    holdings = [
        {"symbol": "AAA", "weight": 0.35, "returns": universe[0]["returns"], "return": float(sum(universe[0]["returns"]))},
        {"symbol": "CCC", "weight": 0.25, "returns": universe[2]["returns"], "return": float(sum(universe[2]["returns"]))},
        {"symbol": "FFF", "weight": 0.40, "returns": universe[5]["returns"], "return": float(sum(universe[5]["returns"]))},
    ]
    return universe, holdings, dates


def test_factor_return_computation_returns_all_factors() -> None:
    engine = FactorAttributionEngine()
    universe, _, _ = _build_universe()

    result = engine.compute_factor_returns(universe)

    assert set(result.keys()) == set(engine.FACTORS)
    assert all(len(result[factor]) == 90 for factor in engine.FACTORS)


def test_factor_exposure_computation_returns_tstats() -> None:
    engine = FactorAttributionEngine()
    universe, holdings, _ = _build_universe()

    exposures = engine.compute_factor_exposures(holdings, universe)

    assert set(exposures.keys()) == set(engine.FACTORS)
    assert all("exposure" in exposures[factor] and "t_stat" in exposures[factor] for factor in engine.FACTORS)
    assert exposures["market"]["exposure"] != 0


def test_return_attribution_reconciles_total_return() -> None:
    engine = FactorAttributionEngine()
    universe, holdings, _ = _build_universe()
    factor_returns = engine.compute_factor_returns(universe)
    engine.compute_factor_exposures(holdings, universe)

    attribution = engine.attribute_returns(holdings, factor_returns, "1Y")

    explained = sum(attribution["factor_contributions"].values())
    assert explained + attribution["alpha"] == pytest.approx(attribution["total_return"], abs=1e-6)
    assert 0 <= attribution["r_squared"] <= 1


def test_rolling_exposures_returns_series_for_each_factor() -> None:
    engine = FactorAttributionEngine()
    universe, holdings, _ = _build_universe()

    series = engine.rolling_exposures(holdings, universe, window=60)

    assert set(series.keys()) == set(engine.FACTORS)
    assert all(len(series[factor]) == 31 for factor in engine.FACTORS)
    assert all({"date", "exposure"} <= set(series["market"][0].keys()) for _ in [0])


def test_factor_analysis_api_routes(monkeypatch: pytest.MonkeyPatch) -> None:
    app = FastAPI()
    app.include_router(factor_analysis.router, prefix="/api")
    app.dependency_overrides[get_current_user] = lambda: object()

    universe, holdings, dates = _build_universe()

    async def _fake_context(_db, _portfolio_id: str, _period: str):  # noqa: ANN001
        return {"holdings": holdings, "universe_data": universe, "dates": dates}

    monkeypatch.setattr(factor_analysis, "_load_factor_context", _fake_context)

    client = TestClient(app)

    exposures_response = client.get("/api/risk/factor-exposures", params={"portfolio_id": "current"})
    assert exposures_response.status_code == 200
    assert set(exposures_response.json()["exposures"].keys()) == set(FactorAttributionEngine.FACTORS)

    attribution_response = client.get("/api/risk/factor-attribution", params={"portfolio_id": "current", "period": "1Y"})
    assert attribution_response.status_code == 200
    attribution_payload = attribution_response.json()
    assert set(attribution_payload["factor_contributions"].keys()) == set(FactorAttributionEngine.FACTORS)
    assert attribution_payload["total_return"] == pytest.approx(
        sum(attribution_payload["factor_contributions"].values()) + attribution_payload["alpha"],
        abs=1e-6,
    )

    history_response = client.get("/api/risk/factor-history", params={"portfolio_id": "current", "period": "1Y", "window": 60})
    assert history_response.status_code == 200
    assert set(history_response.json()["series"].keys()) == set(FactorAttributionEngine.FACTORS)

    returns_response = client.get("/api/risk/factor-returns", params={"period": "1Y"})
    assert returns_response.status_code == 200
    returns_payload = returns_response.json()["factors"]
    assert set(returns_payload.keys()) == set(FactorAttributionEngine.FACTORS)
    assert returns_payload["market"][0]["date"] == dates[0]
