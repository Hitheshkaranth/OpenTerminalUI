from __future__ import annotations

import contextlib
import io
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from dataclasses import dataclass
from typing import Any

import pandas as pd

from backend.core.single_asset_backtest import generate_sma_crossover_signals


@dataclass(frozen=True)
class StrategyRunOutput:
    signals: pd.Series
    stdout: str
    stderr: str


def _run_inline_strategy(
    code: str,
    frame: pd.DataFrame,
    context: dict[str, Any],
) -> tuple[pd.Series | list[int], str, str]:
    scope: dict[str, Any] = {"pd": pd}
    out = io.StringIO()
    err = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        exec(code, scope, scope)
        fn = scope.get("generate_signals")
        if not callable(fn):
            raise ValueError("Inline strategy must define callable generate_signals(df, context)")
        raw_signals = fn(frame.copy(), context.copy())
    return raw_signals, out.getvalue(), err.getvalue()


class StrategyRunner:
    def __init__(self, timeout_seconds: float = 2.0) -> None:
        self.timeout_seconds = timeout_seconds

    def _validate_signals(self, raw_signals: Any, frame: pd.DataFrame) -> pd.Series:
        if isinstance(raw_signals, list):
            signal_series = pd.Series(raw_signals, index=frame.index, dtype=int)
        elif isinstance(raw_signals, pd.Series):
            signal_series = raw_signals.reindex(frame.index)
            if signal_series.isna().any():
                raise ValueError("Signal series must align to OHLCV index without gaps")
            signal_series = signal_series.astype(int)
        else:
            raise ValueError("Signals must be a list[int] or pandas.Series")
        if len(signal_series) != len(frame):
            raise ValueError("Signals length must match OHLCV rows")
        if not set(int(v) for v in signal_series.tolist()).issubset({-1, 0, 1}):
            raise ValueError("Signals must contain only -1, 0, 1")
        return signal_series.astype(int)

    def run(self, strategy: str, frame: pd.DataFrame, context: dict[str, Any] | None = None) -> StrategyRunOutput:
        ctx = context or {}
        if strategy.startswith("example:"):
            name = strategy.split(":", 1)[1].strip().lower()
            if name == "sma_crossover":
                short_window = int(ctx.get("short_window", 20))
                long_window = int(ctx.get("long_window", 50))
                signals = generate_sma_crossover_signals(frame, short_window=short_window, long_window=long_window)
                return StrategyRunOutput(signals=self._validate_signals(signals, frame), stdout="", stderr="")
            if name == "ema_crossover":
                short_window = int(ctx.get("short_window", 12))
                long_window = int(ctx.get("long_window", 26))
                if short_window <= 0 or long_window <= 0 or short_window >= long_window:
                    raise ValueError("EMA windows must be positive and short_window < long_window")
                close = frame["close"].astype(float)
                ema_short = close.ewm(span=short_window, adjust=False).mean()
                ema_long = close.ewm(span=long_window, adjust=False).mean()
                signals = pd.Series(0, index=frame.index, dtype=int)
                signals.loc[ema_short > ema_long] = 1
                signals.loc[ema_short < ema_long] = -1
                return StrategyRunOutput(signals=self._validate_signals(signals, frame), stdout="", stderr="")
            if name == "mean_reversion":
                lookback = int(ctx.get("lookback", 20))
                entry_z = float(ctx.get("entry_z", 1.0))
                if lookback <= 1:
                    raise ValueError("Mean reversion lookback must be > 1")
                close = frame["close"].astype(float)
                mean = close.rolling(lookback, min_periods=lookback).mean()
                std = close.rolling(lookback, min_periods=lookback).std()
                z = (close - mean) / std.replace(0, pd.NA)
                signals = pd.Series(0, index=frame.index, dtype=int)
                signals.loc[z <= -entry_z] = 1
                signals.loc[z >= entry_z] = -1
                signals = signals.fillna(0).astype(int)
                return StrategyRunOutput(signals=self._validate_signals(signals, frame), stdout="", stderr="")
            if name == "breakout_20":
                lookback = int(ctx.get("lookback", 20))
                if lookback <= 1:
                    raise ValueError("Breakout lookback must be > 1")
                close = frame["close"].astype(float)
                rolling_high = close.rolling(lookback, min_periods=lookback).max().shift(1)
                rolling_low = close.rolling(lookback, min_periods=lookback).min().shift(1)
                signals = pd.Series(0, index=frame.index, dtype=int)
                signals.loc[close > rolling_high] = 1
                signals.loc[close < rolling_low] = -1
                signals = signals.fillna(0).astype(int)
                return StrategyRunOutput(signals=self._validate_signals(signals, frame), stdout="", stderr="")
            raise ValueError(f"Unknown example strategy: {name}")

        with ThreadPoolExecutor(max_workers=1) as pool:
            fut = pool.submit(_run_inline_strategy, strategy, frame, ctx)
            try:
                raw_signals, stdout, stderr = fut.result(timeout=self.timeout_seconds)
            except FuturesTimeoutError as exc:
                fut.cancel()
                raise TimeoutError(f"Strategy execution exceeded timeout of {self.timeout_seconds}s") from exc
        return StrategyRunOutput(
            signals=self._validate_signals(raw_signals, frame),
            stdout=stdout,
            stderr=stderr,
        )
