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
        return {"run_id": run_id, "status": "done", "result": {"symbol": "RELIANCE"}, "logs": "", "error": ""}


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
