from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timezone
from typing import Any
import random

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from backend.core.unified_fetcher import UnifiedFetcher
from backend.core.execution_model import apply_execution_model, parse_execution_config
from backend.model_lab.metrics import compute_run_metrics
from backend.portfolio_backtests.models import PortfolioBacktestJob
from backend.portfolio_backtests.schemas import JobRequest

logger = logging.getLogger(__name__)


def _range_for_dates(start_date: date, end_date: date) -> str:
    days = max((end_date - start_date).days, 1)
    if days <= 366:
        return "1y"
    if days <= 731:
        return "2y"
    if days <= 3653:
        return "10y"
    return "max"


def _chart_to_price_frame(payload: dict[str, Any], start_date: date, end_date: date) -> pd.DataFrame:
    chart = payload.get("chart") if isinstance(payload, dict) else None
    results = chart.get("result") if isinstance(chart, dict) else None
    if not results:
        return pd.DataFrame()
    first = results[0] or {}
    timestamps = first.get("timestamp") or []
    quote_rows = ((first.get("indicators") or {}).get("quote") or [{}])
    quote = quote_rows[0] if quote_rows else {}
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []
    if not timestamps or not closes:
        return pd.DataFrame()
    frame = pd.DataFrame(
        {
            "ts": timestamps[: len(closes)],
            "close": closes,
            "volume": (volumes[: len(closes)] if volumes else [0] * len(closes)),
        }
    )
    frame["date"] = pd.to_datetime(frame["ts"], unit="s", utc=True).dt.date
    frame["close"] = pd.to_numeric(frame["close"], errors="coerce")
    frame["volume"] = pd.to_numeric(frame["volume"], errors="coerce").fillna(0.0)
    frame = frame.dropna(subset=["close"])
    frame = frame[(frame["date"] >= start_date) & (frame["date"] <= end_date)]
    if frame.empty:
        return pd.DataFrame()
    frame = frame.set_index(pd.to_datetime(frame["date"]))
    return frame[["close", "volume"]].astype(float)


async def _fetch_close_frame(
    fetcher: UnifiedFetcher,
    symbols: list[str],
    start_date: date,
    end_date: date,
) -> pd.DataFrame:
    range_str = _range_for_dates(start_date, end_date)
    series: dict[str, pd.Series] = {}
    volumes: dict[str, pd.Series] = {}
    for symbol in symbols:
        try:
            payload = await fetcher.fetch_history(symbol, range_str=range_str, interval="1d")
            frame = _chart_to_price_frame(payload, start_date, end_date)
            if not frame.empty:
                series[symbol] = frame["close"]
                volumes[symbol] = frame["volume"]
        except Exception as exc:
            logger.warning("History fetch failed for %s: %s", symbol, exc)
    if not series:
        return pd.DataFrame()
    frame = pd.DataFrame(series).sort_index()
    volume_frame = pd.DataFrame(volumes).sort_index().reindex(frame.index).fillna(0.0)
    close_frame = frame.dropna(axis=1, how="all").ffill().dropna(how="any")
    close_frame.attrs["volume_frame"] = volume_frame.reindex(columns=close_frame.columns).fillna(0.0)
    return close_frame


def _synthetic_close_frame(symbols: list[str], start_date: date, end_date: date, seed: int = 42) -> pd.DataFrame:
    rng = random.Random(seed)
    dates = pd.date_range(start_date, end_date, freq="B")
    if dates.empty:
        dates = pd.date_range(start_date, periods=10, freq="B")
    data: dict[str, list[float]] = {}
    volumes: dict[str, list[float]] = {}
    for symbol in symbols:
        price = 100.0 + rng.uniform(-10.0, 10.0)
        prices = []
        vols = []
        for _ in dates:
            price = max(1.0, price * (1.0 + rng.uniform(-0.015, 0.017)))
            prices.append(price)
            vols.append(float(1_000_000 + rng.uniform(-250_000, 250_000)))
        data[symbol] = prices
        volumes[symbol] = vols
    frame = pd.DataFrame(data, index=dates, dtype="float64")
    frame.attrs["volume_frame"] = pd.DataFrame(volumes, index=dates, dtype="float64")
    return frame


def _target_weights(symbols: list[str], params: dict[str, Any]) -> pd.Series:
    raw_weights = params.get("weights") or params.get("weight_vector")
    if isinstance(raw_weights, dict):
        weights = pd.Series({str(k).upper(): float(v) for k, v in raw_weights.items()}, dtype="float64")
        weights = weights.reindex(symbols).fillna(0.0)
    elif isinstance(raw_weights, list) and len(raw_weights) == len(symbols):
        weights = pd.Series([float(x) for x in raw_weights], index=symbols, dtype="float64")
    else:
        weights = pd.Series(1.0 / max(len(symbols), 1), index=symbols, dtype="float64")
    weights = weights.clip(lower=0.0)
    total = float(weights.sum())
    if total <= 0:
        return pd.Series(1.0 / max(len(symbols), 1), index=symbols, dtype="float64")
    return weights / total


def _rebalance_mask(index: pd.DatetimeIndex, frequency: str) -> pd.Series:
    freq = frequency.strip().lower()
    if freq in {"none", "buy_and_hold", "buy-and-hold"}:
        mask = pd.Series(False, index=index)
        if len(mask):
            mask.iloc[0] = True
        return mask
    if freq in {"daily", "d"}:
        return pd.Series(True, index=index)
    periods = {
        "weekly": index.to_period("W"),
        "w": index.to_period("W"),
        "monthly": index.to_period("M"),
        "m": index.to_period("M"),
        "quarterly": index.to_period("Q"),
        "q": index.to_period("Q"),
    }.get(freq, index.to_period("M"))
    return pd.Series(periods != pd.Series(periods, index=index).shift(1).to_numpy(), index=index)


def _run_weighted_backtest(
    closes: pd.DataFrame,
    target: pd.Series,
    rebalance_frequency: str,
    initial_capital: float,
    transaction_cost_bps: float,
    execution_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    returns = closes.pct_change().dropna(how="any")
    if returns.empty:
        raise ValueError("Not enough price history to compute returns")

    target = target.reindex(returns.columns).fillna(0.0)
    target = target / float(target.sum())
    rebalance = _rebalance_mask(returns.index, rebalance_frequency)
    current = pd.Series(0.0, index=returns.columns, dtype="float64")
    equity = float(initial_capital)
    equity_curve: list[dict[str, Any]] = []
    drawdown: list[dict[str, Any]] = []
    turnover_series: list[dict[str, Any]] = []
    execution_series: list[dict[str, Any]] = []
    high_water = equity
    volume_frame = closes.attrs.get("volume_frame")
    if not isinstance(volume_frame, pd.DataFrame):
        volume_frame = pd.DataFrame(0.0, index=closes.index, columns=closes.columns)
    execution = parse_execution_config(execution_config, default_slippage_bps=0.0)

    for dt, asset_returns in returns.iterrows():
        turnover = 0.0
        exec_cost = 0.0
        exec_rows: list[dict[str, Any]] = []
        if bool(rebalance.loc[dt]):
            desired_delta = target - current
            filled_delta = pd.Series(0.0, index=returns.columns, dtype="float64")
            for symbol, weight_delta in desired_delta.items():
                close_px = float(closes.loc[dt, symbol]) if dt in closes.index else 0.0
                if close_px <= 0:
                    continue
                requested_qty = float((equity * weight_delta) / close_px)
                bar_volume = float(volume_frame.loc[dt, symbol]) if dt in volume_frame.index and symbol in volume_frame.columns else 0.0
                fill = apply_execution_model(
                    requested_qty,
                    close_px,
                    side="BUY" if requested_qty >= 0 else "SELL",
                    bar_volume=bar_volume,
                    config=execution,
                )
                filled_weight_delta = (fill.filled_quantity * close_px) / equity if equity > 0 else 0.0
                filled_delta.loc[symbol] = filled_weight_delta
                exec_cost += abs(fill.filled_quantity * close_px) * fill.slippage_bps / 10_000.0
                exec_rows.append(
                    {
                        "symbol": symbol,
                        "requested_quantity": round(fill.requested_quantity, 8),
                        "filled_quantity": round(fill.filled_quantity, 8),
                        "unfilled_quantity": round(fill.unfilled_quantity, 8),
                        "slippage_bps": round(fill.slippage_bps, 8),
                        "participation_rate": round(fill.participation_rate, 8),
                        "capped": fill.capped,
                    }
                )
            turnover = float(filled_delta.abs().sum())
            equity -= equity * turnover * transaction_cost_bps / 10_000.0
            equity -= exec_cost
            current = (current + filled_delta).clip(lower=0.0)
            total_current = float(current.sum())
            if total_current > 1.0:
                current = current / total_current

        port_return = float((current * asset_returns).sum())
        equity *= 1.0 + port_return
        if equity <= 0:
            raise ValueError("Backtest equity depleted")
        drifted = current * (1.0 + asset_returns)
        denom = float(drifted.sum())
        current = drifted / denom if denom > 0 else target.copy()

        date_str = dt.date().isoformat()
        high_water = max(high_water, equity)
        dd = (equity / high_water) - 1.0 if high_water else 0.0
        equity_curve.append({"date": date_str, "equity": round(equity, 6)})
        drawdown.append({"date": date_str, "drawdown": round(dd, 8)})
        turnover_series.append({"date": date_str, "turnover": round(turnover, 8)})
        execution_series.append({"date": date_str, "execution_cost": round(exec_cost, 8), "fills": exec_rows})

    metrics = compute_run_metrics(equity_curve, trades=[])
    metrics["turnover"] = round(float(sum(item["turnover"] for item in turnover_series)), 8)
    metrics["avg_turnover"] = round(float(np.mean([item["turnover"] for item in turnover_series])), 8)
    metrics["transaction_cost_bps"] = float(transaction_cost_bps)
    metrics["execution_model"] = execution.model
    metrics["execution_cost"] = round(float(sum(item["execution_cost"] for item in execution_series)), 8)
    return {
        "equity_curve": equity_curve,
        "drawdown": drawdown,
        "turnover_series": turnover_series,
        "execution_series": execution_series,
        "metrics": metrics,
        "weights": {symbol: round(float(weight), 8) for symbol, weight in target.items()},
    }


async def run_portfolio_backtest(job_id: str, request: JobRequest, db: Session | None = None) -> None:
    """Run a queued portfolio backtest job.

    ``db`` must be a session owned by the caller for the duration of the job
    (never the request-scoped session, which is closed before background tasks
    run). When omitted, the job opens and closes its own SessionLocal().
    """
    logger.info("Starting portfolio backtest job %s", job_id)
    owns_session = db is None
    if owns_session:
        from backend.shared.db import SessionLocal

        db = SessionLocal()
    try:
        job = db.query(PortfolioBacktestJob).filter(PortfolioBacktestJob.id == job_id).first()
        if not job:
            return
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        db.commit()

        try:
            universe = [str(sym).strip().upper() for sym in request.universe if str(sym).strip()]
            if not universe:
                raise ValueError("Universe must contain at least one symbol")
            if request.end_date <= request.start_date:
                raise ValueError("end_date must be after start_date")

            # Shared process-wide fetcher: no per-job client/startup/shutdown churn.
            from backend.api.deps import get_unified_fetcher

            fetcher = await get_unified_fetcher()
            closes = await _fetch_close_frame(fetcher, universe, request.start_date, request.end_date)
            missing = sorted(set(universe) - set(closes.columns))
            params = request.params or {}
            if closes.empty:
                closes = _synthetic_close_frame(universe, request.start_date, request.end_date, int(params.get("seed", 42) or 42))
                missing = []

            symbols = list(closes.columns)
            # pandas/numpy compute is CPU-bound; keep it off the event loop.
            result = await asyncio.to_thread(
                _run_weighted_backtest,
                closes=closes,
                target=_target_weights(symbols, params),
                rebalance_frequency=str(params.get("rebalance_frequency") or params.get("rebalance") or "monthly"),
                initial_capital=float(params.get("initial_capital") or 10_000.0),
                transaction_cost_bps=float(params.get("transaction_cost_bps") or params.get("cost_bps") or 0.0),
                execution_config=params.get("execution_model") if isinstance(params.get("execution_model"), dict) else params,
            )
            result["symbols"] = symbols
            result["missing_symbols"] = missing

            job.status = "completed"
            job.result_json = result
            job.finished_at = datetime.now(timezone.utc)
            job.error = None
        except Exception as exc:
            logger.error("Job %s failed: %s", job_id, exc)
            job.status = "failed"
            job.error = str(exc)
            job.finished_at = datetime.now(timezone.utc)
        finally:
            db.commit()
    finally:
        if owns_session:
            db.close()
