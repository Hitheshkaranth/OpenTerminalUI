from __future__ import annotations

import asyncio
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.api.deps import get_db, get_unified_fetcher
from backend.api.routes.chart import _parse_yahoo_chart
from backend.auth.deps import get_current_user
from backend.models import Holding, PortfolioDefinition, User
from backend.risk_engine.factor_attribution import FactorAttributionEngine

router = APIRouter()

_engine = FactorAttributionEngine()


def _period_to_range(period: str) -> str:
    normalized = str(period or "1Y").upper()
    mapping = {
        "3M": "3mo",
        "6M": "6mo",
        "1Y": "1y",
        "3Y": "3y",
    }
    return mapping.get(normalized, "1y")


def _validate_portfolio_id(db: Session, portfolio_id: str) -> None:
    normalized = str(portfolio_id or "current").strip().lower()
    if normalized in {"", "current", "portfolio", "default"}:
        return
    exists = db.query(PortfolioDefinition).filter(PortfolioDefinition.id == portfolio_id).first()
    if exists is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")


async def _load_factor_context(db: Session, portfolio_id: str, period: str) -> dict[str, Any]:
    _validate_portfolio_id(db, portfolio_id)
    holdings = db.query(Holding).all()
    if not holdings:
        raise HTTPException(status_code=404, detail="No holdings available")

    fetcher = await get_unified_fetcher()
    range_str = _period_to_range(period)

    async def _history(ticker: str) -> tuple[str, pd.Series]:
        raw = await fetcher.fetch_history(ticker, range_str=range_str, interval="1d")
        frame = _parse_yahoo_chart(raw if isinstance(raw, dict) else {})
        if frame.empty:
            return ticker, pd.Series(dtype=float)
        return ticker, frame["Close"].pct_change().dropna()

    async def _snapshot(ticker: str) -> tuple[str, dict[str, Any]]:
        try:
            snapshot = await fetcher.fetch_stock_snapshot(ticker)
            return ticker, snapshot if isinstance(snapshot, dict) else {}
        except Exception:
            return ticker, {}

    symbols = sorted({str(holding.ticker).strip().upper() for holding in holdings if str(holding.ticker).strip()})
    history_results = await asyncio.gather(*[_history(symbol) for symbol in symbols])
    snapshot_results = await asyncio.gather(*[_snapshot(symbol) for symbol in symbols])
    returns_map = {symbol: series for symbol, series in history_results if not series.empty}
    snapshot_map = {symbol: payload for symbol, payload in snapshot_results}

    if not returns_map:
        raise HTTPException(status_code=404, detail="No return series available")

    returns_df = pd.DataFrame(returns_map).dropna(how="any")
    if returns_df.empty:
        raise HTTPException(status_code=404, detail="No aligned return series available")

    dates = [index.strftime("%Y-%m-%d") if hasattr(index, "strftime") else str(index) for index in returns_df.index]
    latest_prices = {symbol: float(snapshot_map.get(symbol, {}).get("current_price") or 0.0) for symbol in returns_df.columns}
    position_values = {
        str(holding.ticker).strip().upper(): float(holding.quantity) * (
            latest_prices.get(str(holding.ticker).strip().upper()) or float(holding.avg_buy_price)
        )
        for holding in holdings
    }
    total_value = sum(max(value, 0.0) for value in position_values.values())

    universe_data = []
    holdings_payload = []
    for holding in holdings:
        symbol = str(holding.ticker).strip().upper()
        if symbol not in returns_df.columns:
            continue
        snapshot = snapshot_map.get(symbol, {})
        series = returns_df[symbol]
        market_cap = float(snapshot.get("market_cap") or 0.0) if isinstance(snapshot.get("market_cap"), (int, float)) else 0.0
        pb_ratio = snapshot.get("pb_ratio", snapshot.get("pb_calc", snapshot.get("pb")))
        roe = snapshot.get("roe_pct", snapshot.get("roe"))
        beta = snapshot.get("beta")
        current_value = position_values.get(symbol, 0.0)
        weight = (current_value / total_value) if total_value > 0 else (1.0 / len(returns_df.columns))

        universe_data.append(
            {
                "symbol": symbol,
                "dates": dates,
                "returns": [float(value) for value in series.to_list()],
                "market_cap": market_cap,
                "pb_ratio": float(pb_ratio) if isinstance(pb_ratio, (int, float)) else 0.0,
                "roe": float(roe) if isinstance(roe, (int, float)) else 0.0,
                "beta": float(beta) if isinstance(beta, (int, float)) else 1.0,
                "momentum_12m": float(series.sum()),
            }
        )
        holdings_payload.append(
            {
                "symbol": symbol,
                "ticker": symbol,
                "quantity": float(holding.quantity),
                "avg_buy_price": float(holding.avg_buy_price),
                "current_price": latest_prices.get(symbol) or float(holding.avg_buy_price),
                "weight": weight,
                "returns": [float(value) for value in series.to_list()],
                "return": float(series.sum()),
            }
        )

    if not holdings_payload:
        raise HTTPException(status_code=404, detail="No overlapping holdings data available")

    return {"holdings": holdings_payload, "universe_data": universe_data, "dates": dates}


@router.get("/risk/factor-exposures")
async def get_factor_exposures(
    portfolio_id: str = Query(default="current"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    context = await _load_factor_context(db, portfolio_id, "1Y")
    exposures = _engine.compute_factor_exposures(context["holdings"], context["universe_data"])
    return {"exposures": exposures}


@router.get("/risk/factor-attribution")
async def get_factor_attribution(
    portfolio_id: str = Query(default="current"),
    period: str = Query(default="1Y", pattern="^(3M|6M|1Y|3Y)$"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    context = await _load_factor_context(db, portfolio_id, period)
    factor_returns = _engine.compute_factor_returns(context["universe_data"], period=period)
    _engine.compute_factor_exposures(context["holdings"], context["universe_data"])
    return _engine.attribute_returns(context["holdings"], factor_returns, period)


@router.get("/risk/factor-history")
async def get_factor_history(
    portfolio_id: str = Query(default="current"),
    period: str = Query(default="1Y", pattern="^(3M|6M|1Y|3Y)$"),
    window: int = Query(default=60, ge=20, le=252),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    context = await _load_factor_context(db, portfolio_id, period)
    series = _engine.rolling_exposures(context["holdings"], context["universe_data"], window=window)
    return {"series": series}


@router.get("/risk/factor-returns")
async def get_factor_returns(
    period: str = Query(default="1Y", pattern="^(3M|6M|1Y|3Y)$"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    context = await _load_factor_context(db, "current", period)
    factors = _engine.compute_factor_returns(context["universe_data"], period=period)
    dates = _engine.factor_dates
    payload = {
        factor: [{"date": date, "return": float(value)} for date, value in zip(dates, series)]
        for factor, series in factors.items()
    }
    return {"factors": payload}
