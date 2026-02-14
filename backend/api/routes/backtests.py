from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.services.backtest_jobs import BacktestJobRequest, get_backtest_job_service

router = APIRouter()


class BacktestSubmitPayload(BaseModel):
    symbol: str = Field(min_length=1)
    asset: str | None = None
    market: str = "NSE"
    start: str | None = None
    end: str | None = None
    limit: int = Field(500, ge=1, le=5000)
    strategy: str = "example:sma_crossover"
    context: dict[str, Any] | None = None
    config: dict[str, Any] | None = None


@router.post("/backtests")
async def submit_backtest(payload: BacktestSubmitPayload) -> dict[str, str]:
    service = get_backtest_job_service()
    run_id = await service.submit(
        BacktestJobRequest(
            symbol=payload.symbol,
            asset=payload.asset,
            market=payload.market,
            start=payload.start,
            end=payload.end,
            limit=payload.limit,
            strategy=payload.strategy,
            context=payload.context,
            config=payload.config,
        )
    )
    return {"run_id": run_id, "status": "queued"}


@router.get("/backtests/{run_id}/status")
async def backtest_status(run_id: str) -> dict[str, str]:
    status = await get_backtest_job_service().get_status(run_id)
    if status.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Backtest run not found")
    return status


@router.get("/backtests/{run_id}/result")
async def backtest_result(run_id: str) -> dict[str, Any]:
    result = await get_backtest_job_service().get_result(run_id)
    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Backtest run not found")
    return result
