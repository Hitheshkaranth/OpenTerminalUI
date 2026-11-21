from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any
import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core import backtester
from backend.core.framework.registry import list_models
from backend.core.framework.engine import FrameworkConfig, run_framework_backtest

router = APIRouter(prefix="/api/framework", tags=["framework"])
logger = logging.getLogger(__name__)

class ModelSpec(BaseModel):
    id: str
    params: dict[str, Any] = Field(default_factory=dict)

class FrameworkBacktestRequest(BaseModel):
    tickers: list[str] = Field(min_length=1)
    start: str | None = None
    end: str | None = None
    benchmark: str | None = "^NSEI"
    rebalance_freq: str = "ME"
    initial_cash: float = Field(100000.0, gt=0)
    transaction_cost_bps: float = Field(10.0, ge=0)
    transaction_cost_overrides: dict[str, float] = Field(default_factory=dict)
    top_n: int = Field(10, ge=1)
    long_only: bool = True
    alpha: ModelSpec
    portfolio_construction: ModelSpec
    risk: list[ModelSpec] = Field(default_factory=list)

@router.get("/models")
async def get_models() -> dict:
    """List available alpha / portfolio-construction / risk models for the composer UI."""
    return list_models()

@router.post("/backtest")
async def run_backtest(req: FrameworkBacktestRequest) -> dict:
    end = req.end or datetime.now().strftime("%Y-%m-%d")
    start = req.start or (datetime.now() - timedelta(days=3*365)).strftime("%Y-%m-%d")
    def _work():
        prices = backtester._download_close(req.tickers, start, end)
        if prices is None or prices.empty:
            raise ValueError("No price data available for the selected universe/date range.")
        bench = None
        if req.benchmark:
            bdf = backtester._download_close([req.benchmark], start, end)
            if bdf is not None and not bdf.empty:
                bench = bdf.iloc[:, 0]
        cfg = FrameworkConfig(
            alpha=req.alpha.model_dump(),
            portfolio_construction=req.portfolio_construction.model_dump(),
            risk=[r.model_dump() for r in req.risk],
            rebalance_freq=req.rebalance_freq, initial_cash=req.initial_cash,
            transaction_cost_bps=req.transaction_cost_bps,
            transaction_cost_overrides=req.transaction_cost_overrides,
            top_n=req.top_n, long_only=req.long_only,
        )
        return run_framework_backtest(prices, cfg, benchmark=bench)
    try:
        return await asyncio.to_thread(_work)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Framework backtest failed")
        raise HTTPException(status_code=500, detail="Framework backtest failed") from e
