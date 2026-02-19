from __future__ import annotations

from itertools import product
from typing import Any

import pandas as pd

from backend.core.backtesting_models import BacktestConfig
from backend.core.historical_data_service import get_historical_data_service
from backend.core.single_asset_backtest import BacktestEngine
from backend.core.strategy_runner import StrategyRunner


def _grid_candidates(param_space: dict[str, list[Any]]) -> list[dict[str, Any]]:
    if not param_space:
        return []
    keys = [k for k in sorted(param_space.keys()) if isinstance(param_space.get(k), list) and param_space.get(k)]
    if not keys:
        return []
    values = [param_space[k] for k in keys]
    return [dict(zip(keys, combo)) for combo in product(*values)]


def optimize_strategy_parameters(
    *,
    symbol: str,
    market: str,
    strategy_key: str,
    start: str | None,
    end: str | None,
    limit: int,
    param_space: dict[str, list[Any]],
    config: dict[str, Any] | None = None,
    max_trials: int = 64,
) -> dict[str, Any]:
    grid = _grid_candidates(param_space)[: max(1, max_trials)]
    if not grid:
        return {"best_params": {}, "best_score": 0.0, "trials": []}
    svc = get_historical_data_service()
    _, bars = svc.fetch_daily_ohlcv(raw_symbol=symbol, market=market, start=start, end=end, limit=limit)
    frame = pd.DataFrame(
        [{"date": b.date, "open": b.open, "high": b.high, "low": b.low, "close": b.close, "volume": b.volume} for b in bars]
    )
    if frame.empty:
        return {"best_params": {}, "best_score": 0.0, "trials": []}

    runner = StrategyRunner(timeout_seconds=2.0)
    engine = BacktestEngine(BacktestConfig(**(config or {})))
    trials: list[dict[str, Any]] = []
    best = {"params": {}, "score": float("-inf")}
    strategy = strategy_key if strategy_key.startswith("example:") else f"example:{strategy_key}"

    for idx, params in enumerate(grid, start=1):
        output = runner.run(strategy, frame, context=params)
        result = engine.run(symbol=symbol, asset=symbol, frame=frame, signals=output.signals)
        score = float(result.sharpe)
        trial = {
            "trial": idx,
            "params": params,
            "score": round(score, 6),
            "total_return": round(float(result.total_return), 6),
            "max_drawdown": round(float(result.max_drawdown), 6),
        }
        trials.append(trial)
        if score > best["score"]:
            best = {"params": params, "score": score}

    return {
        "best_params": best["params"],
        "best_score": round(float(best["score"]), 6) if best["score"] != float("-inf") else 0.0,
        "trials": trials,
    }
