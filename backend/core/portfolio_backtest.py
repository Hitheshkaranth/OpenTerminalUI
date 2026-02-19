from __future__ import annotations

from typing import Any

import pandas as pd

from backend.core.backtesting_models import BacktestConfig
from backend.core.historical_data_service import get_historical_data_service
from backend.core.single_asset_backtest import BacktestEngine
from backend.core.strategy_runner import StrategyRunner


def run_portfolio_backtest(
    *,
    assets: list[str],
    market: str = "NSE",
    start: str | None = None,
    end: str | None = None,
    limit: int = 500,
    strategy: str = "example:sma_crossover",
    context: dict[str, Any] | None = None,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not assets:
        raise ValueError("assets must not be empty")

    svc = get_historical_data_service()
    runner = StrategyRunner(timeout_seconds=2.0)
    per_asset: dict[str, dict[str, Any]] = {}
    curves: list[pd.DataFrame] = []

    for raw_asset in assets:
        asset = raw_asset.strip().upper()
        if not asset:
            continue
        symbol, bars = svc.fetch_daily_ohlcv(raw_symbol=asset, market=market, start=start, end=end, limit=limit)
        frame = pd.DataFrame(
            [{"date": b.date, "open": b.open, "high": b.high, "low": b.low, "close": b.close, "volume": b.volume} for b in bars]
        )
        if frame.empty:
            continue
        strategy_out = runner.run(strategy, frame, context=context or {})
        result = BacktestEngine(BacktestConfig(**(config or {}))).run(
            symbol=symbol.canonical,
            asset=asset,
            frame=frame,
            signals=strategy_out.signals,
        )
        per_asset[asset] = {
            "symbol": symbol.canonical,
            "total_return": float(result.total_return),
            "sharpe": float(result.sharpe),
            "max_drawdown": float(result.max_drawdown),
            "trades": len(result.trades),
        }
        curve_df = pd.DataFrame([{"date": p.date, f"equity_{asset}": p.equity} for p in result.equity_curve])
        curves.append(curve_df)

    if not curves:
        return {
            "assets": [],
            "summary": {"total_return": 0.0, "sharpe": 0.0, "max_drawdown": 0.0},
            "equity_curve": [],
            "holdings_timeline": [],
            "per_asset": {},
        }

    merged = curves[0]
    for curve in curves[1:]:
        merged = merged.merge(curve, on="date", how="outer")
    merged = merged.sort_values("date").ffill().dropna().reset_index(drop=True)
    equity_cols = [c for c in merged.columns if c.startswith("equity_")]
    merged["portfolio_equity"] = merged[equity_cols].mean(axis=1)
    rets = merged["portfolio_equity"].pct_change().dropna()
    vol = float(rets.std() * (252**0.5)) if not rets.empty else 0.0
    sharpe = float((rets.mean() * 252.0) / vol) if vol > 0 else 0.0
    total_return = float((merged["portfolio_equity"].iloc[-1] / merged["portfolio_equity"].iloc[0]) - 1.0)
    dd = (merged["portfolio_equity"] / merged["portfolio_equity"].cummax()) - 1.0
    max_drawdown = float(dd.min()) if not dd.empty else 0.0

    holdings = []
    weight = round(1.0 / len(equity_cols), 6)
    for row in merged.itertuples(index=False):
        holdings.append({"date": str(row.date), "weights": {c.replace("equity_", ""): weight for c in equity_cols}})

    return {
        "assets": [c.replace("equity_", "") for c in equity_cols],
        "summary": {"total_return": total_return, "sharpe": sharpe, "max_drawdown": max_drawdown},
        "equity_curve": [
            {"date": str(r["date"]), "portfolio_equity": float(r["portfolio_equity"])}
            for r in merged[["date", "portfolio_equity"]].to_dict(orient="records")
        ],
        "holdings_timeline": holdings,
        "per_asset": per_asset,
    }
