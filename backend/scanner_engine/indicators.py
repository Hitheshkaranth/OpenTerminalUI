from __future__ import annotations

import pandas as pd
import numpy as np


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss.where(avg_loss != 0, np.nan)
    out = 100.0 - (100.0 / (1.0 + rs))
    return out.fillna(100.0)


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    macd_line = ema(close, fast) - ema(close, slow)
    signal_line = ema(macd_line, signal)
    hist = macd_line - signal_line
    return pd.DataFrame({"macd": macd_line, "macd_signal": signal_line, "macd_hist": hist}, index=close.index)


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high = df["High"]
    low = df["Low"]
    close = df["Close"]
    prev_close = close.shift(1)
    tr = pd.concat([(high - low).abs(), (high - prev_close).abs(), (low - prev_close).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()


def bollinger(close: pd.Series, period: int = 20, std_dev: float = 2.0) -> pd.DataFrame:
    mid = close.rolling(period).mean()
    std = close.rolling(period).std()
    upper = mid + std_dev * std
    lower = mid - std_dev * std
    width = ((upper - lower) / mid.replace(0, pd.NA)).abs()
    return pd.DataFrame({"bb_mid": mid, "bb_upper": upper, "bb_lower": lower, "bb_width": width}, index=close.index)


def keltner(df: pd.DataFrame, period: int = 20, atr_mult: float = 1.5) -> pd.DataFrame:
    mid = ema(df["Close"], period)
    channel_atr = atr(df, period)
    upper = mid + atr_mult * channel_atr
    lower = mid - atr_mult * channel_atr
    return pd.DataFrame({"kc_mid": mid, "kc_upper": upper, "kc_lower": lower}, index=df.index)


def donchian(df: pd.DataFrame, period: int) -> pd.DataFrame:
    upper = df["High"].rolling(period).max()
    lower = df["Low"].rolling(period).min()
    return pd.DataFrame({f"donchian_{period}_upper": upper, f"donchian_{period}_lower": lower}, index=df.index)


def rvol(volume: pd.Series, period: int = 20) -> pd.Series:
    return volume / volume.rolling(period).mean().replace(0, pd.NA)


def roc(close: pd.Series, period: int = 10) -> pd.Series:
    return (close / close.shift(period) - 1.0) * 100.0


def supertrend(df: pd.DataFrame, period: int = 10, multiplier: float = 3.0) -> pd.DataFrame:
    base_atr = atr(df, period)
    hl2 = (df["High"] + df["Low"]) / 2.0
    upperband = hl2 + multiplier * base_atr
    lowerband = hl2 - multiplier * base_atr
    final_upper = upperband.copy()
    final_lower = lowerband.copy()
    trend = pd.Series(index=df.index, dtype="int64")

    for i in range(1, len(df)):
        prev = i - 1
        if df["Close"].iat[prev] <= final_upper.iat[prev]:
            final_upper.iat[i] = min(upperband.iat[i], final_upper.iat[prev])
        if df["Close"].iat[prev] >= final_lower.iat[prev]:
            final_lower.iat[i] = max(lowerband.iat[i], final_lower.iat[prev])

        prev_trend = 1 if pd.isna(trend.iat[prev]) else int(trend.iat[prev])
        if prev_trend == -1 and df["Close"].iat[i] > final_upper.iat[i]:
            trend.iat[i] = 1
        elif prev_trend == 1 and df["Close"].iat[i] < final_lower.iat[i]:
            trend.iat[i] = -1
        else:
            trend.iat[i] = prev_trend

    if len(df) > 0 and pd.isna(trend.iat[0]):
        trend.iat[0] = 1
    line = pd.Series(index=df.index, dtype="float64")
    for i in range(len(df)):
        line.iat[i] = final_lower.iat[i] if int(trend.iat[i]) == 1 else final_upper.iat[i]
    return pd.DataFrame({"supertrend": line, "supertrend_dir": trend}, index=df.index)


def compute_indicator_pack(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    close = out["Close"]
    volume = out["Volume"].fillna(0.0)
    out["ema_9"] = ema(close, 9)
    out["ema_21"] = ema(close, 21)
    out["ema_50"] = ema(close, 50)
    out["ema_200"] = ema(close, 200)
    out["rsi_14"] = rsi(close, 14)
    out["atr_14"] = atr(out, 14)
    out["atr_pct"] = (out["atr_14"] / close.replace(0, pd.NA)) * 100.0
    out["rvol_20"] = rvol(volume, 20)
    out["roc_10"] = roc(close, 10)
    out["roc_20"] = roc(close, 20)
    out = out.join(macd(close, 12, 26, 9))
    out = out.join(bollinger(close, 20, 2.0))
    out = out.join(keltner(out, 20, 1.5))
    out = out.join(donchian(out, 20))
    out = out.join(donchian(out, 55))
    out = out.join(supertrend(out, 10, 3.0))
    out["avg_volume_20"] = volume.rolling(20).mean()
    out["avg_traded_value_20"] = (close * volume).rolling(20).mean()
    out["bb_width_pct_rank_120"] = out["bb_width"].rolling(120).rank(pct=True) * 100.0
    return out
