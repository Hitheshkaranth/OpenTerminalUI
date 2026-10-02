from __future__ import annotations

from pathlib import Path

import pandas as pd


REQUIRED_COLUMNS = ["date", "open", "high", "low", "close", "volume"]


def load_ohlcv_csv(path: str | Path) -> pd.DataFrame:
    frame = pd.read_csv(path)
    frame.columns = [str(c).strip().lower() for c in frame.columns]
    missing = [col for col in REQUIRED_COLUMNS if col not in frame.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    out = frame[REQUIRED_COLUMNS].copy()
    out["date"] = pd.to_datetime(out["date"], errors="coerce", utc=True).dt.tz_convert(None)
    if out["date"].isna().any():
        raise ValueError("Invalid date values found in CSV")
    for col in ["open", "high", "low", "close", "volume"]:
        out[col] = pd.to_numeric(out[col], errors="coerce")
    if out[["open", "high", "low", "close"]].isna().any().any():
        raise ValueError("Invalid OHLC numeric values found in CSV")
    out["volume"] = out["volume"].fillna(0.0)
    out = out.sort_values("date").reset_index(drop=True)
    return out
