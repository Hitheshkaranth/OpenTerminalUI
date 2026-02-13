from __future__ import annotations

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
    else:
        raise ValueError(f"Unsupported indicator type: {indicator_type}")
    return out
