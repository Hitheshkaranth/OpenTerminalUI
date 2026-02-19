from __future__ import annotations

import ast
import contextlib
import io
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from models.pure_jump_vol.signals import generate_pjv_signals
from backend.core.single_asset_backtest import generate_sma_crossover_signals


@dataclass(frozen=True)
class StrategyRunOutput:
    signals: pd.Series
    stdout: str
    stderr: str


STRATEGY_CATALOG: list[dict[str, Any]] = [
    {
        "key": "sma_crossover",
        "label": "SMA Crossover (20/50)",
        "category": "trend",
        "description": "Trend-following model using simple moving average crossover.",
        "default_context": {"short_window": 20, "long_window": 50},
        "default_allocation": 1.0,
    },
    {
        "key": "ema_crossover",
        "label": "EMA Crossover (12/26)",
        "category": "trend",
        "description": "Faster trend model using exponential moving average crossover.",
        "default_context": {"short_window": 12, "long_window": 26},
        "default_allocation": 0.75,
    },
    {
        "key": "mean_reversion",
        "label": "Mean Reversion (Z-Score)",
        "category": "mean_reversion",
        "description": "Contrarian model buying weakness and selling strength versus rolling mean.",
        "default_context": {"lookback": 20, "entry_z": 1.0},
        "default_allocation": 0.55,
    },
    {
        "key": "breakout_20",
        "label": "20-Day Breakout",
        "category": "breakout",
        "description": "Momentum breakout model using rolling high/low triggers.",
        "default_context": {"lookback": 20},
        "default_allocation": 1.0,
    },
    {
        "key": "rsi_overbought_oversold",
        "label": "RSI Overbought/Oversold",
        "category": "oscillator",
        "description": "Oscillator model buying oversold and selling overbought RSI levels.",
        "default_context": {"period": 14, "oversold": 30, "overbought": 70},
        "default_allocation": 0.6,
    },
    {
        "key": "macd_crossover",
        "label": "MACD Crossover",
        "category": "trend",
        "description": "Trend model based on MACD line crossing its signal line.",
        "default_context": {"fast": 12, "slow": 26, "signal": 9},
        "default_allocation": 0.8,
    },
    {
        "key": "bollinger_bands",
        "label": "Bollinger Bands",
        "category": "volatility",
        "description": "Volatility mean-reversion model around Bollinger envelopes.",
        "default_context": {"period": 20, "std_dev": 2.0, "squeeze_pct": 0.04},
        "default_allocation": 0.6,
    },
    {
        "key": "dual_momentum",
        "label": "Dual Momentum",
        "category": "momentum",
        "description": "Absolute momentum model using lookback returns.",
        "default_context": {"lookback": 63, "threshold": 0.0},
        "default_allocation": 1.0,
    },
    {
        "key": "vwap_reversion",
        "label": "VWAP Reversion",
        "category": "mean_reversion",
        "description": "Reversion model around cumulative VWAP with volume confirmation.",
        "default_context": {"deviation_pct": 0.02, "volume_mult": 1.5},
        "default_allocation": 0.65,
    },
    {
        "key": "supertrend",
        "label": "Supertrend",
        "category": "trend",
        "description": "ATR-based directional trend model.",
        "default_context": {"atr_period": 10, "multiplier": 3.0},
        "default_allocation": 0.9,
    },
    {
        "key": "ichimoku_cloud",
        "label": "Ichimoku Cloud",
        "category": "trend",
        "description": "Trend model using TK cross and cloud confirmation.",
        "default_context": {"tenkan": 9, "kijun": 26, "senkou_b": 52},
        "default_allocation": 0.85,
    },
    {
        "key": "triple_ema",
        "label": "Triple EMA Ribbon (8/21/55)",
        "category": "trend",
        "description": "Trend model requiring ordered EMA ribbon alignment.",
        "default_context": {"fast": 8, "mid": 21, "slow": 55},
        "default_allocation": 0.8,
    },
    {
        "key": "premarket_orb_breakout",
        "label": "Premarket + ORB Breakout",
        "category": "breakout",
        "description": "Breakout model combining prior-session range and open-range levels.",
        "default_context": {"premarket_lookback": 1, "orb_window": 3},
        "default_allocation": 0.8,
    },
    {
        "key": "pure_jump_markov_vol",
        "label": "Pure-Jump Markov Volatility",
        "category": "volatility",
        "description": "Risk-on/risk-off model using particle-filtered jump volatility stress and trend gating.",
        "default_context": {
            "a0": -2.2,
            "a1": 0.5,
            "b0": 0.0,
            "b1": -0.2,
            "k_plus": 18.0,
            "k_minus": 14.0,
            "mu": 0.0,
            "n_particles": 256,
            "lookback": 252,
            "stress_exit": 1.5,
            "stress_entry": 0.5,
            "hold_logic": "hold",
            "seed": 42,
        },
        "default_allocation": 0.7,
    },
]


def get_strategy_catalog() -> list[dict[str, Any]]:
    """Return the full strategy catalog for the frontend."""
    return STRATEGY_CATALOG


def _get_volume_series(frame: pd.DataFrame) -> pd.Series:
    if "volume" in frame.columns:
        return frame["volume"].fillna(0).astype(float)
    return pd.Series(1.0, index=frame.index, dtype=float)


def _generate_rsi_signals(frame: pd.DataFrame, ctx: dict[str, Any]) -> pd.Series:
    period = int(ctx.get("period", 14))
    oversold = float(ctx.get("oversold", 30))
    overbought = float(ctx.get("overbought", 70))
    if period <= 0:
        raise ValueError("RSI period must be positive")
    close = frame["close"].astype(float)
    delta = close.diff()
    gains = delta.clip(lower=0)
    losses = -delta.clip(upper=0)
    avg_gain = gains.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    avg_loss = losses.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    rsi = rsi.fillna(50.0)
    signals = pd.Series(0, index=frame.index, dtype=int)
    signals.loc[rsi <= oversold] = 1
    signals.loc[rsi >= overbought] = -1
    return signals.fillna(0).astype(int)


def _generate_macd_signals(frame: pd.DataFrame, ctx: dict[str, Any]) -> pd.Series:
    fast = int(ctx.get("fast", 12))
    slow = int(ctx.get("slow", 26))
    signal = int(ctx.get("signal", 9))
    if fast <= 0 or slow <= 0 or signal <= 0 or fast >= slow:
        raise ValueError("MACD params invalid: fast/slow/signal must be positive and fast < slow")
    close = frame["close"].astype(float)
    macd_line = close.ewm(span=fast, adjust=False).mean() - close.ewm(span=slow, adjust=False).mean()
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    out = pd.Series(0, index=frame.index, dtype=int)
    out.loc[macd_line > signal_line] = 1
    out.loc[macd_line < signal_line] = -1
    return out.fillna(0).astype(int)


def _generate_bollinger_signals(frame: pd.DataFrame, ctx: dict[str, Any]) -> pd.Series:
    period = int(ctx.get("period", 20))
    std_dev = float(ctx.get("std_dev", 2.0))
    squeeze_pct = float(ctx.get("squeeze_pct", 0.04))
    if period <= 1 or std_dev <= 0:
        raise ValueError("Bollinger params invalid: period > 1 and std_dev > 0 required")
    close = frame["close"].astype(float)
    sma = close.rolling(period, min_periods=period).mean()
    rstd = close.rolling(period, min_periods=period).std()
    upper = sma + (std_dev * rstd)
    lower = sma - (std_dev * rstd)
    band_width = (upper - lower) / sma.replace(0, np.nan)
    out = pd.Series(0, index=frame.index, dtype=int)
    out.loc[(close <= lower) & (band_width > squeeze_pct)] = 1
    out.loc[(close >= upper) & (band_width > squeeze_pct)] = -1
    return out.fillna(0).astype(int)


def _generate_dual_momentum_signals(frame: pd.DataFrame, ctx: dict[str, Any]) -> pd.Series:
    lookback = int(ctx.get("lookback", 63))
    threshold = float(ctx.get("threshold", 0.0))
    if lookback <= 0:
        raise ValueError("Dual momentum lookback must be positive")
    close = frame["close"].astype(float)
    returns = close.pct_change(lookback)
    out = pd.Series(0, index=frame.index, dtype=int)
    out.loc[returns > threshold] = 1
    out.loc[returns < -threshold] = -1
    return out.fillna(0).astype(int)


def _generate_vwap_reversion_signals(frame: pd.DataFrame, ctx: dict[str, Any]) -> pd.Series:
    deviation_pct = float(ctx.get("deviation_pct", 0.02))
    volume_mult = float(ctx.get("volume_mult", 1.5))
    if deviation_pct < 0 or volume_mult < 0:
        raise ValueError("VWAP reversion params invalid: non-negative values required")
    close = frame["close"].astype(float)
    volume = _get_volume_series(frame).replace(0, np.nan)
    cumulative_vwap = (close * volume).cumsum() / volume.cumsum()
    avg_vol = volume.fillna(0).rolling(20, min_periods=1).mean()
    out = pd.Series(0, index=frame.index, dtype=int)
    out.loc[(close < cumulative_vwap * (1 - deviation_pct)) & (volume.fillna(0) > avg_vol * volume_mult)] = 1
    out.loc[close > cumulative_vwap * (1 + deviation_pct)] = -1
    return out.fillna(0).astype(int)


def _generate_supertrend_signals(frame: pd.DataFrame, ctx: dict[str, Any]) -> pd.Series:
    atr_period = int(ctx.get("atr_period", 10))
    multiplier = float(ctx.get("multiplier", 3.0))
    if atr_period <= 0 or multiplier <= 0:
        raise ValueError("Supertrend params invalid: atr_period and multiplier must be positive")
    high = frame["high"].astype(float)
    low = frame["low"].astype(float)
    close = frame["close"].astype(float)
    prev_close = close.shift(1)
    tr = pd.concat([(high - low), (high - prev_close).abs(), (low - prev_close).abs()], axis=1).max(axis=1)
    atr = tr.rolling(atr_period, min_periods=atr_period).mean()
    hl2 = (high + low) / 2.0
    upper = hl2 + (multiplier * atr)
    lower = hl2 - (multiplier * atr)

    direction = pd.Series(0, index=frame.index, dtype=int)
    if not frame.empty:
        direction.iloc[0] = 0
    for i in range(1, len(frame)):
        prev_upper = upper.iloc[i - 1]
        prev_lower = lower.iloc[i - 1]
        prev_dir = int(direction.iloc[i - 1])
        current_close = close.iloc[i]
        if pd.notna(prev_upper) and current_close > prev_upper:
            direction.iloc[i] = 1
        elif pd.notna(prev_lower) and current_close < prev_lower:
            direction.iloc[i] = -1
        else:
            direction.iloc[i] = prev_dir
    return direction.fillna(0).astype(int)


def _generate_ichimoku_signals(frame: pd.DataFrame, ctx: dict[str, Any]) -> pd.Series:
    tenkan = int(ctx.get("tenkan", 9))
    kijun = int(ctx.get("kijun", 26))
    senkou_b = int(ctx.get("senkou_b", 52))
    if tenkan <= 0 or kijun <= 0 or senkou_b <= 0:
        raise ValueError("Ichimoku params must be positive")
    high = frame["high"].astype(float)
    low = frame["low"].astype(float)
    close = frame["close"].astype(float)
    tenkan_line = (high.rolling(tenkan, min_periods=tenkan).max() + low.rolling(tenkan, min_periods=tenkan).min()) / 2
    kijun_line = (high.rolling(kijun, min_periods=kijun).max() + low.rolling(kijun, min_periods=kijun).min()) / 2
    senkou_a = ((tenkan_line + kijun_line) / 2).shift(kijun)
    senkou_b_line = ((high.rolling(senkou_b, min_periods=senkou_b).max() + low.rolling(senkou_b, min_periods=senkou_b).min()) / 2).shift(kijun)
    cloud_top = pd.concat([senkou_a, senkou_b_line], axis=1).max(axis=1)
    cloud_bottom = pd.concat([senkou_a, senkou_b_line], axis=1).min(axis=1)
    out = pd.Series(0, index=frame.index, dtype=int)
    out.loc[(tenkan_line > kijun_line) & (close > cloud_top)] = 1
    out.loc[(tenkan_line < kijun_line) & (close < cloud_bottom)] = -1
    return out.fillna(0).astype(int)


def _generate_triple_ema_signals(frame: pd.DataFrame, ctx: dict[str, Any]) -> pd.Series:
    fast = int(ctx.get("fast", 8))
    mid = int(ctx.get("mid", 21))
    slow = int(ctx.get("slow", 55))
    if fast <= 0 or mid <= 0 or slow <= 0:
        raise ValueError("Triple EMA params must be positive")
    close = frame["close"].astype(float)
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_mid = close.ewm(span=mid, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    out = pd.Series(0, index=frame.index, dtype=int)
    out.loc[(ema_fast > ema_mid) & (ema_mid > ema_slow)] = 1
    out.loc[(ema_fast < ema_mid) & (ema_mid < ema_slow)] = -1
    return out.fillna(0).astype(int)


def _generate_premarket_orb_signals(frame: pd.DataFrame, ctx: dict[str, Any]) -> pd.Series:
    premarket_lookback = int(ctx.get("premarket_lookback", 1))
    orb_window = int(ctx.get("orb_window", 3))
    if premarket_lookback <= 0 or orb_window <= 0:
        raise ValueError("Premarket ORB params must be positive")
    high = frame["high"].astype(float)
    low = frame["low"].astype(float)
    close = frame["close"].astype(float)
    premarket_high = high.shift(1).rolling(premarket_lookback, min_periods=premarket_lookback).max()
    premarket_low = low.shift(1).rolling(premarket_lookback, min_periods=premarket_lookback).min()
    orb_high = high.rolling(orb_window, min_periods=orb_window).max().shift(1)
    orb_low = low.rolling(orb_window, min_periods=orb_window).min().shift(1)
    breakout_high = pd.concat([premarket_high, orb_high], axis=1).max(axis=1)
    breakout_low = pd.concat([premarket_low, orb_low], axis=1).min(axis=1)
    out = pd.Series(0, index=frame.index, dtype=int)
    out.loc[close > breakout_high] = 1
    out.loc[close < breakout_low] = -1
    return out.fillna(0).astype(int)


def _generate_pure_jump_markov_vol_signals(frame: pd.DataFrame, ctx: dict[str, Any]) -> pd.Series:
    signals, _diagnostics = generate_pjv_signals(frame, ctx)
    return signals.fillna(0).astype(int)


EXAMPLE_STRATEGY_MAP: dict[str, Any] = {
    "rsi_overbought_oversold": _generate_rsi_signals,
    "macd_crossover": _generate_macd_signals,
    "bollinger_bands": _generate_bollinger_signals,
    "dual_momentum": _generate_dual_momentum_signals,
    "vwap_reversion": _generate_vwap_reversion_signals,
    "supertrend": _generate_supertrend_signals,
    "ichimoku_cloud": _generate_ichimoku_signals,
    "triple_ema": _generate_triple_ema_signals,
    "premarket_orb_breakout": _generate_premarket_orb_signals,
    "pure_jump_markov_vol": _generate_pure_jump_markov_vol_signals,
}


def _run_inline_strategy(
    code: str,
    frame: pd.DataFrame,
    context: dict[str, Any],
) -> tuple[pd.Series | list[int], str, str]:
    tree = ast.parse(code, mode="exec")
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            raise ValueError("Inline strategy imports are disabled")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in {"open", "exec", "eval", "compile", "__import__"}:
            raise ValueError(f"Inline strategy blocked call: {node.func.id}")
    safe_builtins = {
        "abs": abs,
        "all": all,
        "any": any,
        "dict": dict,
        "enumerate": enumerate,
        "float": float,
        "int": int,
        "len": len,
        "list": list,
        "max": max,
        "min": min,
        "print": print,
        "range": range,
        "round": round,
        "set": set,
        "str": str,
        "sum": sum,
        "tuple": tuple,
        "zip": zip,
    }
    scope: dict[str, Any] = {"pd": pd, "np": np, "__builtins__": safe_builtins}
    out = io.StringIO()
    err = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        exec(compile(tree, "<inline_strategy>", "exec"), scope, scope)
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
            if name in EXAMPLE_STRATEGY_MAP:
                signals = EXAMPLE_STRATEGY_MAP[name](frame, ctx)
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
