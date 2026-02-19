from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from backend.api.routes import backtests


class _FakeBacktestService:
    async def submit(self, req):  # noqa: ANN001
        return "bt_test_1"

    async def get_status(self, run_id: str):
        if run_id == "missing":
            return {"run_id": run_id, "status": "not_found"}
        return {"run_id": run_id, "status": "running"}

    async def get_result(self, run_id: str):
        if run_id == "missing":
            return {"run_id": run_id, "status": "not_found"}
        return {
            "run_id": run_id,
            "status": "done",
            "result": {
                "symbol": "RELIANCE",
                "initial_cash": 100000,
                "daily_returns": [0.01, -0.005, 0.004, 0.002, -0.001, 0.003],
                "equity_curve": [{"date": "2025-01-01", "equity": 100000}, {"date": "2025-01-02", "equity": 101000}],
            },
            "logs": "",
            "error": "",
        }


def test_submit_backtest_returns_run_id(monkeypatch) -> None:
    monkeypatch.setattr(backtests, "get_backtest_job_service", lambda: _FakeBacktestService())
    payload = backtests.BacktestSubmitPayload(symbol="RELIANCE", strategy="example:sma_crossover")
    result = asyncio.run(backtests.submit_backtest(payload))
    assert result["run_id"] == "bt_test_1"
    assert result["status"] == "queued"


def test_status_not_found_raises(monkeypatch) -> None:
    monkeypatch.setattr(backtests, "get_backtest_job_service", lambda: _FakeBacktestService())
    with pytest.raises(HTTPException):
        asyncio.run(backtests.backtest_status("missing"))


def test_result_returns_payload(monkeypatch) -> None:
    monkeypatch.setattr(backtests, "get_backtest_job_service", lambda: _FakeBacktestService())
    result = asyncio.run(backtests.backtest_result("bt_test_1"))
    assert result["status"] == "done"
    assert result["result"]["symbol"] == "RELIANCE"


def test_v1_submit_adapts_legacy_submit(monkeypatch) -> None:
    monkeypatch.setattr(backtests, "get_backtest_job_service", lambda: _FakeBacktestService())
    payload = backtests.BacktestSubmitPayload(symbol="RELIANCE", strategy="example:sma_crossover")
    result = asyncio.run(backtests.v1_submit_backtest(payload))
    assert result.run_id == "bt_test_1"
    assert result.status == "queued"


def test_v1_walkforward_works(monkeypatch) -> None:
    monkeypatch.setattr(backtests, "get_backtest_job_service", lambda: _FakeBacktestService())
    payload = backtests.WalkForwardPayload(run_id="bt_test_1", folds=2, in_sample_ratio=0.7)
    result = asyncio.run(backtests.v1_validate_walkforward(payload))
    assert result["run_id"] == "bt_test_1"
    assert "validation" in result


def test_v1_monte_carlo_works(monkeypatch) -> None:
    monkeypatch.setattr(backtests, "get_backtest_job_service", lambda: _FakeBacktestService())
    payload = backtests.MonteCarloPayload(run_id="bt_test_1", simulations=20, horizon_days=10, seed=7)
    result = asyncio.run(backtests.v1_simulate_montecarlo(payload))
    assert result["run_id"] == "bt_test_1"
    assert result["simulation"]["simulations"] == 20


def test_v1_monte_carlo_initial_equity_fallback(monkeypatch) -> None:
    class _NoInitialCashService(_FakeBacktestService):
        async def get_result(self, run_id: str):
            if run_id == "missing":
                return {"run_id": run_id, "status": "not_found"}
            return {
                "run_id": run_id,
                "status": "done",
                "result": {
                    "equity_curve": [{"date": "2025-01-01", "equity": 250000}, {"date": "2025-01-02", "equity": 251000}],
                    "daily_returns": [0.004],
                },
                "logs": "",
                "error": "",
            }

    captured = {"initial_equity": 0.0}

    def _fake_mc(**kwargs):
        captured["initial_equity"] = float(kwargs["initial_equity"])
        return {"simulations": kwargs["simulations"]}

    monkeypatch.setattr(backtests, "get_backtest_job_service", lambda: _NoInitialCashService())
    monkeypatch.setattr(backtests, "run_monte_carlo_simulation", _fake_mc)
    payload = backtests.MonteCarloPayload(run_id="bt_test_1", simulations=20, horizon_days=10, seed=7)
    result = asyncio.run(backtests.v1_simulate_montecarlo(payload))
    assert result["simulation"]["simulations"] == 20
    assert captured["initial_equity"] == 250000.0


def test_v1_optimize_works(monkeypatch) -> None:
    monkeypatch.setattr(
        backtests,
        "optimize_strategy_parameters",
        lambda **kwargs: {"best_params": {"short_window": 10}, "best_score": 1.2, "trials": [{"trial": 1}]},
    )
    payload = backtests.OptimizePayload(
        symbol="RELIANCE",
        strategy="example:sma_crossover",
        param_space={"short_window": [10, 20], "long_window": [50]},
    )
    result = asyncio.run(backtests.v1_optimize(payload))
    assert result["strategy"] == "sma_crossover"
    assert result["optimization"]["best_score"] == 1.2


def test_v1_portfolio_submit_works(monkeypatch) -> None:
    monkeypatch.setattr(
        backtests,
        "run_portfolio_backtest",
        lambda **kwargs: {"summary": {"total_return": 0.12}, "assets": ["RELIANCE", "TCS"]},
    )
    payload = backtests.PortfolioSubmitPayload(assets=["RELIANCE", "TCS"], strategy="example:sma_crossover")
    result = asyncio.run(backtests.v1_portfolio_submit(payload))
    assert result["status"] == "done"
    assert result["result"]["summary"]["total_return"] == 0.12


def test_v1_factor_decompose_works(monkeypatch) -> None:
    monkeypatch.setattr(backtests, "get_backtest_job_service", lambda: _FakeBacktestService())
    payload = backtests.FactorPayload(run_id="bt_test_1")
    result = asyncio.run(backtests.v1_factor_decompose(payload))
    assert result["run_id"] == "bt_test_1"
    assert "factor_analysis" in result


def test_v1_data_catalog_works(monkeypatch) -> None:
    monkeypatch.setattr(backtests, "list_store_items", lambda: [{"name": "bt_test.parquet", "bytes": 123}])
    result = asyncio.run(backtests.v1_data_catalog())
    assert len(result["items"]) == 1
