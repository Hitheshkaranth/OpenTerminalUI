from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import get_db, get_unified_fetcher
from backend.api.routes.chart import _parse_yahoo_chart
from backend.auth.deps import get_current_user
from backend.models import BacktestRun, Holding, User
from backend.risk_engine.engine import DEFAULT_SCENARIOS, compute_portfolio_risk

router = APIRouter()


class RiskPortfolioRequest(BaseModel):
    symbols: list[str] = Field(default_factory=list)
    weights: list[float] = Field(default_factory=list)
    confidence: float = Field(default=0.95, ge=0.8, le=0.999)
    lookback_days: int = Field(default=252, ge=30, le=2000)
    portfolio_value: float = Field(default=1_000_000, gt=0)


def _returns_from_close(close_series: pd.Series) -> pd.Series:
    return close_series.pct_change().dropna()


async def _load_returns_frame(symbols: list[str]) -> pd.DataFrame:
    fetcher = await get_unified_fetcher()
    series_map: dict[str, pd.Series] = {}
    for symbol in symbols:
        raw = await fetcher.fetch_history(symbol, range_str="5y", interval="1d")
        frame = _parse_yahoo_chart(raw if isinstance(raw, dict) else {})
        if frame.empty:
            continue
        ret = _returns_from_close(frame["Close"])
        if ret.empty:
            continue
        series_map[symbol.upper()] = ret
    if not series_map:
        return pd.DataFrame()
    df = pd.DataFrame(series_map).dropna(how="any")
    return df


@router.post("/risk/portfolio")
async def risk_portfolio(
    payload: RiskPortfolioRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    symbols = [s.strip().upper() for s in payload.symbols if s.strip()]
    if not symbols:
        rows = db.query(Holding).all()
        symbols = sorted({str(row.ticker).strip().upper() for row in rows if str(row.ticker).strip()})
    if not symbols:
        raise HTTPException(status_code=400, detail="No symbols provided for risk calculation")
    returns_df = await _load_returns_frame(symbols)
    if returns_df.empty:
        raise HTTPException(status_code=404, detail="No return series available")
    if payload.lookback_days < len(returns_df):
        returns_df = returns_df.tail(payload.lookback_days)
    risk = compute_portfolio_risk(returns_df, portfolio_value=payload.portfolio_value, confidence=payload.confidence)
    return {
        "symbols": symbols,
        "portfolio_value": payload.portfolio_value,
        "confidence": payload.confidence,
        **risk,
    }


@router.post("/risk/backtest/{run_id}")
def risk_backtest(
    run_id: str,
    confidence: float = 0.95,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = db.query(BacktestRun).filter(BacktestRun.run_id == run_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Backtest run not found")
    result_json = row.result_json if isinstance(row.result_json, str) else ""
    try:
        import json

        payload = json.loads(result_json) if result_json else {}
    except Exception:
        payload = {}
    curve = payload.get("equity_curve", []) if isinstance(payload, dict) else []
    if not isinstance(curve, list) or not curve:
        raise HTTPException(status_code=404, detail="Backtest run has no equity curve")
    strategy_vals = [float(item.get("strategy") or 0.0) for item in curve if isinstance(item, dict)]
    if len(strategy_vals) < 3:
        raise HTTPException(status_code=400, detail="Not enough equity points to compute risk")
    ser = pd.Series(strategy_vals, dtype=float)
    returns_df = pd.DataFrame({"strategy": ser.pct_change().dropna()}).dropna()
    risk = compute_portfolio_risk(returns_df, portfolio_value=float(strategy_vals[-1]), confidence=confidence)
    return {"run_id": run_id, "confidence": confidence, **risk}


@router.get("/risk/scenarios")
def risk_scenarios(_: User = Depends(get_current_user)) -> dict[str, Any]:
    return {"items": DEFAULT_SCENARIOS}
