from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core import backtester
from backend.core.riskfolio import (
    bl_implied_returns,
    bl_posterior_returns,
    cluster_assets,
    efficient_frontier,
    hrp_weights,
    list_methods,
    optimize_portfolio,
    risk_report,
)

router = APIRouter(prefix="/api/portfolio-optimizer", tags=["portfolio-optimizer"])


class ViewModel(BaseModel):
    assets: list[str]
    weights: list[float]
    value: float


class OptimizeRequest(BaseModel):
    tickers: list[str] = Field(..., min_length=2)
    start: str | None = None
    end: str | None = None
    model: str = "Classic"           # Classic | HRP | HERC | BL | RP | NCO
    objective: str = "max_sharpe"    # min_risk | max_sharpe | max_return | utility
    risk_measure: str = "MV"         # MV | MAD | CVaR | CDaR | MDD | ULCER
    confidence: float = Field(0.95, ge=0.5, le=0.999)
    risk_free_rate: float = 0.0
    risk_aversion: float = 2.0
    min_weight: float = 0.0
    max_weight: float = 1.0
    target_return: float | None = None
    views: list[ViewModel] | None = None
    cov_method: str = "sample"


class RiskReportRequest(BaseModel):
    tickers: list[str] = Field(..., min_length=1)
    start: str | None = None
    end: str | None = None
    weights: dict[str, float] | None = None
    confidence: float = Field(0.95, ge=0.5, le=0.999)
    risk_free_rate: float = 0.0


def _get_returns(tickers: list[str], start: str | None, end: str | None) -> pd.DataFrame:
    if not end:
        end_dt = datetime.now()
    else:
        end_dt = datetime.strptime(end, "%Y-%m-%d")

    if not start:
        start_dt = end_dt - timedelta(days=3 * 365)
    else:
        start_dt = datetime.strptime(start, "%Y-%m-%d")

    prices = backtester._download_close(tickers, start_dt.strftime("%Y-%m-%d"), end_dt.strftime("%Y-%m-%d"))
    if prices is None or prices.empty:
        raise HTTPException(status_code=400, detail="Insufficient price data: No data returned from fetcher.")

    returns = prices.pct_change().dropna(how="all").dropna(axis=1, how="all").fillna(0.0)
    if len(returns.columns) < 2:
        raise HTTPException(status_code=400, detail="Insufficient price data: Fewer than 2 valid columns after cleaning.")

    return returns


@router.get("/methods")
async def get_methods():
    return list_methods()


@router.post("/optimize")
async def optimize(req: OptimizeRequest):
    try:
        returns = await asyncio.to_thread(_get_returns, req.tickers, req.start, req.end)

        res = await asyncio.to_thread(
            optimize_portfolio,
            returns,
            model=req.model,
            objective=req.objective,
            risk_measure=req.risk_measure,
            confidence=req.confidence,
            rf=req.risk_free_rate,
            risk_aversion=req.risk_aversion,
            min_weight=req.min_weight,
            max_weight=req.max_weight,
            target_return=req.target_return,
            views=[v.model_dump() for v in req.views] if req.views else None,
            cov_method=req.cov_method
        )

        front = await asyncio.to_thread(
            efficient_frontier,
            returns,
            points=24,
            rf=req.risk_free_rate,
            min_weight=req.min_weight,
            max_weight=req.max_weight,
            risk_measure=req.risk_measure,
            confidence=req.confidence,
            cov_method=req.cov_method
        )

        clusters = await asyncio.to_thread(cluster_assets, returns)

        return {
            **res,
            "frontier": front,
            "clusters": clusters,
            "selected_point": {
                "risk": res["metrics"]["volatility"],
                "return": res["metrics"]["expected_return"]
            }
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Optimization failed: {e}")


@router.post("/risk-report")
async def get_risk_report(req: RiskReportRequest):
    try:
        # For risk report, we might only have 1 ticker, but _get_returns enforces 2.
        # Let's adjust _get_returns or handle it here.
        # The spec says tickers: list[str] (min_length=1) for risk-report.
        
        if not req.end:
            end_dt = datetime.now()
        else:
            end_dt = datetime.strptime(req.end, "%Y-%m-%d")

        if not req.start:
            start_dt = end_dt - timedelta(days=3 * 365)
        else:
            start_dt = datetime.strptime(req.start, "%Y-%m-%d")

        prices = await asyncio.to_thread(
            backtester._download_close, req.tickers, start_dt.strftime("%Y-%m-%d"), end_dt.strftime("%Y-%m-%d")
        )
        if prices is None or prices.empty:
            raise HTTPException(status_code=400, detail="Insufficient price data: No data returned from fetcher.")

        returns = prices.pct_change().dropna(how="all").dropna(axis=1, how="all").fillna(0.0)
        if returns.empty:
             raise HTTPException(status_code=400, detail="Insufficient price data: No usable data after cleaning.")

        # Align weights
        cols = returns.columns.tolist()
        if req.weights:
            w_vector = np.array([req.weights.get(c, 0.0) for c in cols])
        else:
            w_vector = np.array([1.0 / len(cols)] * len(cols))
        
        # Normalize weights to sum 1
        w_sum = w_vector.sum()
        if w_sum > 0:
            w_vector = w_vector / w_sum
        else:
            # If all weights are 0 or empty, equal weight
            w_vector = np.array([1.0 / len(cols)] * len(cols))

        port_returns = returns @ w_vector
        metrics = risk_report(port_returns, confidence=req.confidence, rf=req.risk_free_rate)

        # Drawdown series
        nav = (1.0 + port_returns).cumprod()
        dd = (nav.cummax() - nav) / nav.cummax()
        drawdown_series = []
        for date, val in dd.items():
            drawdown_series.append({
                "date": date.strftime("%Y-%m-%d"),
                "drawdown": round(float(val), 6)
            })

        # Per-asset variance risk contributions
        cov = returns.cov() * 252
        mrc = cov @ w_vector
        rc = w_vector * mrc.values
        rc_sum = rc.sum()
        if rc_sum != 0:
            contributions = {cols[i]: float(rc[i] / rc_sum) for i in range(len(cols))}
        else:
            contributions = {cols[i]: 0.0 for i in range(len(cols))}

        return {
            "metrics": metrics,
            "drawdown_series": drawdown_series,
            "contributions": contributions,
            "weights": {cols[i]: float(w_vector[i]) for i in range(len(cols))}
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Risk report failed: {e}")
