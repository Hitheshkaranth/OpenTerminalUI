from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core.backtester import BacktestConfig, backtest_momentum_rotation

router = APIRouter()


class BacktestRequest(BaseModel):
    tickers: list[str] = Field(min_length=1)
    start: str | None = None
    end: str | None = None
    lookback_days: int = 63
    rebalance_freq: str = "M"
    top_n: int = 10
    transaction_cost_bps: float = 10.0
    benchmark: str = "^NSEI"


@router.post("/backtest/run")
async def run_backtest(payload: BacktestRequest) -> dict[str, Any]:
    end_date = payload.end or datetime.now().strftime("%Y-%m-%d")
    start_date = payload.start or (datetime.now() - timedelta(days=3 * 365)).strftime("%Y-%m-%d")

    config = BacktestConfig(
        lookback_days=payload.lookback_days,
        rebalance_freq=payload.rebalance_freq,
        top_n=payload.top_n,
        transaction_cost_bps=payload.transaction_cost_bps,
        benchmark=payload.benchmark,
    )

    try:
        result = await asyncio.to_thread(
            backtest_momentum_rotation,
            payload.tickers,
            start_date,
            end_date,
            config,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Backtest failed: {exc}") from exc

    equity_df = result["equity_curve"]
    equity_records = []
    for idx, row in equity_df.iterrows():
        equity_records.append({
            "date": idx.strftime("%Y-%m-%d"),
            "strategy": round(float(row["strategy"]), 6),
            "benchmark": round(float(row["benchmark"]), 6),
        })

    holdings_df = result["holdings"]
    holdings_records = []
    for _, row in holdings_df.iterrows():
        holdings_records.append({
            "rebalance_date": row["rebalance_date"].strftime("%Y-%m-%d") if hasattr(row["rebalance_date"], "strftime") else str(row["rebalance_date"]),
            "holdings": row["holdings"],
            "turnover": round(float(row["turnover"]), 4),
            "cost_applied": round(float(row["cost_applied"]), 6),
        })

    return {
        "summary": result["summary"],
        "equity_curve": equity_records,
        "holdings": holdings_records,
    }
