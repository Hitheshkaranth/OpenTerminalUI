from __future__ import annotations

import numpy as np
import pandas as pd


def sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(period).mean()


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def bollinger_bands(close: pd.Series, period: int = 20, std_dev: float = 2.0) -> pd.DataFrame:
    mid = sma(close, period)
    std = close.rolling(period).std()
    return pd.DataFrame({"middle": mid, "upper": mid + std_dev * std, "lower": mid - std_dev * std})


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = -delta.clip(upper=0).rolling(period).mean()
    rs = gain / loss.replace(0, pd.NA)
    return 100 - (100 / (1 + rs))


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    m = ema(close, fast) - ema(close, slow)
    s = ema(m, signal)
    h = m - s
    return pd.DataFrame({"macd": m, "signal": s, "hist": h})


def volume_sma(volume: pd.Series, period: int = 20) -> pd.Series:
    return sma(volume, period)

def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high = df["High"]
    low = df["Low"]
    close = df["Close"]
    prev_close = close.shift(1)
    tr = pd.concat(
        [
            (high - low).abs(),
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.rolling(period).mean()


def compute_indicator(df: pd.DataFrame, indicator_type: str, params: dict[str, int | float]) -> pd.DataFrame:
    itype = indicator_type.lower()
    close = df["Close"]
    out = pd.DataFrame(index=df.index)
    if itype == "sma":
        period = int(params.get("period", 20))
        out["sma"] = sma(close, period)
    elif itype == "ema":
        period = int(params.get("period", 20))
        out["ema"] = ema(close, period)
    elif itype in {"bollinger", "bollinger_bands"}:
        period = int(params.get("period", 20))
        std_dev = float(params.get("std_dev", 2.0))
        out = bollinger_bands(close, period=period, std_dev=std_dev)
    elif itype == "rsi":
        period = int(params.get("period", 14))
        out["rsi"] = rsi(close, period)
    elif itype == "macd":
        out = macd(close, fast=int(params.get("fast", 12)), slow=int(params.get("slow", 26)), signal=int(params.get("signal", 9)))
    elif itype == "volume":
        out["volume"] = df["Volume"]
        out["volume_sma_20"] = volume_sma(df["Volume"], 20)
    elif itype == "atr":
        period = int(params.get("period", 14))
        out["atr"] = atr(df, period)
    elif itype == "stochastic":
        k_period = int(params.get("period", 14))
        d_smooth = int(params.get("signal", 3))
        high_s = df["High"].fillna(method="ffill").fillna(method="bfill").values
        low_s = df["Low"].fillna(method="ffill").fillna(method="bfill").values
        close_s = df["Close"].fillna(method="ffill").fillna(method="bfill").values
        low_min = pd.Series(low_s).rolling(k_period).min().values
        high_max = pd.Series(high_s).rolling(k_period).max().values
        denom = high_max - low_min
        denom = np.where(denom == 0, 1.0, denom)
        k = 100.0 * (close_s - low_min) / denom
        d = pd.Series(k).rolling(d_smooth).mean().values
        out["stoch_k"] = pd.Series(k).ffill().bfill()
        out["stoch_d"] = pd.Series(d).ffill().bfill()
    elif itype == "adx":
        period = int(params.get("period", 14))
        high_s = df["High"].values
        low_s = df["Low"].values
        close_s = df["Close"].values
        up = np.diff(high_s, prepend=high_s[0])
        dn = -np.diff(low_s, prepend=low_s[0])
        plus_dm = np.where((up > dn) & (up > 0), up, 0.0)
        minus_dm = np.where((dn > up) & (dn > 0), dn, 0.0)
        tr = np.maximum(
            high_s - low_s,
            np.maximum(np.abs(high_s - np.roll(close_s, 1)), np.abs(low_s - np.roll(close_s, 1))),
        )
        atr = pd.Series(tr).rolling(period).mean()
        plus_di = 100.0 * pd.Series(plus_dm).rolling(period).mean() / atr
        minus_di = 100.0 * pd.Series(minus_dm).rolling(period).mean() / atr
        dx = 100.0 * np.abs(plus_di - minus_di) / np.where(np.abs(plus_di + minus_di) == 0, 1.0, plus_di + minus_di)
        out["adx"] = pd.Series(dx).rolling(period).mean().ffill().bfill()
        out["plus_di"] = plus_di.ffill().bfill()
        out["minus_di"] = minus_di.ffill().bfill()
    elif itype == "cci":
        period = int(params.get("period", 20))
        high_s = df["High"].fillna(method="ffill").fillna(method="bfill").values
        low_s = df["Low"].fillna(method="ffill").fillna(method="bfill").values
        close_s = df["Close"].fillna(method="ffill").fillna(method="bfill").values
        tp = (high_s + low_s + close_s) / 3.0
        tp_s = pd.Series(tp)
        sma_tp = tp_s.rolling(period).mean()
        mad = tp_s.rolling(period).apply(lambda x: np.abs(x - sma_tp[x.name]).mean(), raw=True) if hasattr(tp_s.rolling(period), "apply") else tp_s.rolling(period).std() * np.sqrt(period / (period + 1))
        mad = mad.ffill().bfill()
        denom = 0.015 * mad
        denom = np.where(denom == 0, 1.0, denom.values)
        out["cci"] = ((tp - sma_tp.values) / denom).astype(float)
    elif itype == "williams_r":
        period = int(params.get("period", 14))
        high_s = df["High"].fillna(method="ffill").fillna(method="bfill").values
        low_s = df["Low"].fillna(method="ffill").fillna(method="bfill").values
        close_s = df["Close"].fillna(method="ffill").fillna(method="bfill").values
        hh = pd.Series(high_s).rolling(period).max()
        ll = pd.Series(low_s).rolling(period).min()
        denom = hh - ll
        denom = np.where(denom == 0, 1.0, denom.values)
        out["williams_r"] = (-100.0 * (hh.values - close_s) / denom)
    else:
        raise ValueError(f"Unsupported indicator type: {indicator_type}")
    return out
