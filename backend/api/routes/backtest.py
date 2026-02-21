from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.core.backtester import BacktestConfig, backtest_momentum_rotation
from backend.execution_sim.simulator import apply_execution_costs, parse_execution_profile
from backend.models import BacktestRun
from backend.services.data_version_service import get_active_data_version

router = APIRouter()


class BacktestRequest(BaseModel):
    tickers: list[str] = Field(min_length=1)
    start: str | None = None
    end: str | None = None
    lookback_days: int = 63
    rebalance_freq: str = "ME"
    top_n: int = 10
    transaction_cost_bps: float = 10.0
    benchmark: str = "^NSEI"
    data_version_id: str | None = None
    adjusted: bool = True
    execution_profile: dict[str, Any] = Field(default_factory=dict)


@router.post("/backtest/run")
async def run_backtest(payload: BacktestRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    end_date = payload.end or datetime.now().strftime("%Y-%m-%d")
    start_date = payload.start or (datetime.now() - timedelta(days=3 * 365)).strftime("%Y-%m-%d")
    run_id = str(uuid4())
    active_version = get_active_data_version(db)
    resolved_data_version_id = payload.data_version_id or active_version.id

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
    profile = parse_execution_profile(payload.execution_profile)
    execution_cost_total = 0.0
    execution_breakdown = {"commission": 0.0, "slippage": 0.0, "borrow": 0.0}
    for _, row in holdings_df.iterrows():
        turnover = round(float(row["turnover"]), 4)
        gross_notional = max(0.0, turnover) * 1_000_000.0
        cost = apply_execution_costs(notional=gross_notional, side="buy", profile=profile, atr_pct=0.01, hold_days=21)
        execution_cost_total += cost["total_cost"]
        execution_breakdown["commission"] += cost["commission"]
        execution_breakdown["slippage"] += cost["slippage"]
        execution_breakdown["borrow"] += cost["borrow"]
        holdings_records.append({
            "rebalance_date": row["rebalance_date"].strftime("%Y-%m-%d") if hasattr(row["rebalance_date"], "strftime") else str(row["rebalance_date"]),
            "holdings": row["holdings"],
            "turnover": turnover,
            "cost_applied": round(float(row["cost_applied"]) + cost["total_cost"] / 1_000_000.0, 6),
            "execution_cost_breakdown": cost,
        })

    summary = result["summary"] if isinstance(result.get("summary"), dict) else {}
    summary["metadata"] = {
        "run_id": run_id,
        "data_version_id": resolved_data_version_id,
        "adjusted": payload.adjusted,
        "execution_profile": payload.execution_profile,
    }
    summary["execution_cost_total"] = execution_cost_total
    summary["execution_cost_breakdown"] = execution_breakdown

    db.add(
        BacktestRun(
            run_id=run_id,
            status="done",
            request_json=json.dumps(payload.model_dump()),
            result_json=json.dumps({"summary": summary, "equity_curve": equity_records, "holdings": holdings_records}),
            logs="",
            error="",
            data_version_id=resolved_data_version_id,
            execution_profile_json=payload.execution_profile,
            created_at=datetime.utcnow().isoformat(),
            updated_at=datetime.utcnow().isoformat(),
        )
    )
    db.commit()

    return {
        "summary": summary,
        "equity_curve": equity_records,
        "holdings": holdings_records,
        "run_id": run_id,
    }
