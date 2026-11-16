"""Per-run, frozen chronological SMA research data with a one-use holdout.

This is a single train/test split, not walk-forward validation or a statistical
proof of an edge. No model receives the test prices during parameter selection.
"""

from __future__ import annotations

import asyncio
import hashlib
import math
from typing import Any

import numpy as np
import pandas as pd

from backend.core.backtesting_models import BacktestConfig
from backend.core.single_asset_backtest import BacktestEngine, generate_sma_crossover_signals


class SMAHoldoutSession:
    """Own one price snapshot; training closes permanently when testing begins."""

    def __init__(self, ticker: str, frame: pd.DataFrame, *, provenance: dict[str, Any] | None = None) -> None:
        required = ["date", "open", "high", "low", "close"]
        if not set(required).issubset(frame.columns):
            raise ValueError("Holdout history requires date/open/high/low/close columns")
        work = frame[required].copy(deep=True)
        work["date"] = pd.to_datetime(work["date"], utc=True, errors="coerce")
        if work["date"].isna().any() or work["date"].duplicated().any():
            raise ValueError("Holdout history has invalid or duplicate dates")
        for column in required[1:]:
            work[column] = pd.to_numeric(work[column], errors="coerce")
        prices = work[required[1:]].to_numpy(dtype=float)
        if not np.isfinite(prices).all() or (prices <= 0).any():
            raise ValueError("Holdout history must contain finite positive OHLC prices")
        work = work.sort_values("date").reset_index(drop=True)
        split = int(len(work) * 0.7)
        if split < 120 or len(work) - split < 40:
            raise ValueError("Chronological holdout requires at least 120 training and 40 test bars")
        self.ticker = ticker.strip().upper()
        if not self.ticker:
            raise ValueError("ticker is required")
        self._frame = work
        self._split = split
        self._trained: set[tuple[int, int]] = set()
        self._sealed = False
        self._walk_forward_opened = False
        self.provenance = dict(provenance or {})
        self.dataset_id = hashlib.sha256(work.to_csv(index=False).encode()).hexdigest()

    def split_metadata(self) -> dict[str, Any]:
        dates = self._frame["date"]
        return {
            "method": "single_chronological_holdout", "dataset_id": self.dataset_id,
            "train_fraction": 0.7, "train_bars": self._split, "test_bars": len(dates) - self._split,
            "train_start": dates.iloc[0].isoformat(), "train_end": dates.iloc[self._split - 1].isoformat(),
            "test_start": dates.iloc[self._split].isoformat(), "test_end": dates.iloc[-1].isoformat(),
        }

    def _parameters(self, params: dict[str, Any]) -> tuple[int, int]:
        if params.get("strategy") != "sma_crossover" or str(params.get("ticker", "")).upper() != self.ticker:
            raise ValueError("Holdout strategy and ticker are frozen for this run")
        if params.get("range", "3y") != "3y":
            raise ValueError("Holdout history range is frozen at 3y")
        short, long = params.get("short_window"), params.get("long_window")
        if isinstance(short, bool) or isinstance(long, bool) or not isinstance(short, int) or not isinstance(long, int):
            raise ValueError("SMA windows must be integers")
        if not 0 < short < long < self._split - 1:
            raise ValueError("SMA windows must fit the training partition")
        return short, long

    def _run(self, frame: pd.DataFrame, signals: pd.Series, params: tuple[int, int], partition: str,
             *, liquidate_at_end: bool = False) -> dict[str, Any]:
        result = BacktestEngine(BacktestConfig(
            initial_cash=100000, fee_bps=5, slippage_bps=5,
            position_fraction=1 / 1.001, allow_short=False,
        )).run(self.ticker, frame, signals)
        def finite(value: float) -> float | None:
            return float(value) if math.isfinite(value) else None
        # The shared engine starts pct_change and running highs at its first
        # post-fill equity point. Include starting cash so entry-day costs also
        # affect the reported Sharpe and drawdown of a warmed holdout.
        curve = [{"date": point.date, "equity": point.equity} for point in result.equity_curve]
        trade_count = len(result.trades)
        if liquidate_at_end and result.equity_curve[-1].position:
            last = result.equity_curve[-1]
            curve[-1]["equity"] -= abs(last.position * last.close) * 0.001
            trade_count += 1
        nav = pd.Series([result.initial_cash, *(point["equity"] for point in curve)])
        returns = nav.pct_change().dropna()
        volatility = returns.std() * math.sqrt(252)
        sharpe = returns.mean() * 252 / volatility if volatility > 0 else 0.0
        drawdown = (nav / nav.cummax() - 1).min()
        return {
            "ticker": self.ticker, "strategy": "sma_crossover", "partition": partition,
            "initial_cash": result.initial_cash,
            "params": {"short_window": params[0], "long_window": params[1]}, "bars": result.bars,
            "metrics": {"sharpe": finite(sharpe), "total_return_pct": finite((nav.iloc[-1] / result.initial_cash - 1) * 100),
                        "max_drawdown_pct": finite(drawdown * 100), "trades": trade_count},
            "equity_curve": curve,
            "split": self.split_metadata(), "provenance": dict(self.provenance),
            "execution": {"fee_bps": 5, "slippage_bps": 5, "signal_delay_bars": 1, "start_flat": True,
                          **({"liquidate_at_end": True} if liquidate_at_end else {})},
        }

    def train(self, params: dict[str, Any]) -> dict[str, Any]:
        if self._sealed:
            raise ValueError("Training is closed after the holdout is opened")
        windows = self._parameters(params)
        frame = self._frame.iloc[:self._split].copy(deep=True)
        signals = generate_sma_crossover_signals(frame, *windows).shift(1).fillna(0).astype(int)
        result = self._run(frame, signals, windows, "train")
        self._trained.add(windows)
        return result

    def evaluate_holdout(self, params: dict[str, Any]) -> dict[str, Any]:
        if self._sealed:
            raise ValueError("The holdout may be evaluated only once per run")
        windows = self._parameters(params)
        if windows not in self._trained:
            raise ValueError("The holdout winner must have been evaluated on training data")
        self._sealed = True  # Even a failed test cannot be retried with new parameters.
        # Warm indicators using past training bars, but start the test account flat.
        # Shift BEFORE slicing so first test-day orders use the previous day's signal.
        warm_start = self._split - windows[1] - 1
        warmed = self._frame.iloc[warm_start:].copy(deep=True).reset_index(drop=True)
        signals = generate_sma_crossover_signals(warmed, *windows).shift(1).fillna(0).astype(int)
        offset = self._split - warm_start
        test_frame = warmed.iloc[offset:].reset_index(drop=True)
        test_signals = signals.iloc[offset:].reset_index(drop=True)
        return self._run(test_frame, test_signals, windows, "holdout")

    def walk_forward(self, *, deadline: float | None = None) -> dict[str, Any]:
        """Open a fixed, deterministic expanding-window protocol exactly once."""
        if self._walk_forward_opened:
            raise ValueError("Walk-forward tests may be opened only once per run")
        self._walk_forward_opened = True
        self._sealed = True
        from backend.agent.strategy_loop.walkforward import evaluate_expanding_walkforward
        return evaluate_expanding_walkforward(self, deadline=deadline)


async def load_sma_holdout_session(ticker: str) -> SMAHoldoutSession:
    """Fetch exactly once; the session retains all price data privately in memory."""
    from backend.api.deps import get_unified_fetcher
    from backend.api.routes.chart import _parse_yahoo_chart
    from backend.agent.tools.market_tools import _history_provenance

    fetcher = await get_unified_fetcher()
    raw = await fetcher.fetch_history(ticker, range_str="3y", interval="1d")
    parsed = await asyncio.to_thread(_parse_yahoo_chart, raw)
    if parsed is None or parsed.empty:
        raise ValueError("No price history is available for chronological holdout")
    frame = pd.DataFrame({"date": parsed.index, "open": parsed["Open"].values,
                          "high": parsed["High"].values, "low": parsed["Low"].values,
                          "close": parsed["Close"].values})
    provenance = _history_provenance(raw, "Frozen daily history for chronological SMA holdout")
    if provenance.get("quality") not in {"live", "delayed", "cached"} or provenance.get("source") in {None, "", "synthetic", "mock", "unknown", "unreported"}:
        raise ValueError("Usable source-reported prices are required for holdout evidence")
    return SMAHoldoutSession(ticker, frame, provenance=provenance)
