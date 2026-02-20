"""Data integrity checks for OHLCV history."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class GapEvent:
    prev_t: int
    curr_t: int
    gap_sec: int


@dataclass(frozen=True)
class OutlierEvent:
    t: int
    value: float
    zscore: float


@dataclass(frozen=True)
class SplitEvent:
    t: int
    ratio: float
    approx_factor: float


@dataclass
class DataIntegrityReport:
    gaps: list[GapEvent] = field(default_factory=list)
    outliers: list[OutlierEvent] = field(default_factory=list)
    splits: list[SplitEvent] = field(default_factory=list)
    checks_run: list[str] = field(default_factory=list)

    @property
    def is_clean(self) -> bool:
        return not self.gaps and not self.outliers and not self.splits


def _to_frame(rows: list[dict[str, Any]] | pd.DataFrame) -> pd.DataFrame:
    if isinstance(rows, pd.DataFrame):
        df = rows.copy()
    else:
        df = pd.DataFrame(rows)
    if df.empty:
        return df
    for col in ["t", "o", "h", "l", "c", "v"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df.dropna(subset=["t", "c"]).sort_values("t").reset_index(drop=True)


def detect_gaps(df: pd.DataFrame, expected_interval_sec: int) -> list[GapEvent]:
    if df.empty or expected_interval_sec <= 0:
        return []
    diffs = df["t"].diff().fillna(expected_interval_sec).astype(int)
    out: list[GapEvent] = []
    for idx in range(1, len(df)):
        d = int(diffs.iloc[idx])
        if d > int(expected_interval_sec * 1.5):
            out.append(
                GapEvent(
                    prev_t=int(df.iloc[idx - 1]["t"]),
                    curr_t=int(df.iloc[idx]["t"]),
                    gap_sec=d,
                )
            )
    return out


def detect_outliers(df: pd.DataFrame, z_threshold: float = 4.0) -> list[OutlierEvent]:
    if df.empty:
        return []
    returns = pd.to_numeric(df["c"], errors="coerce").pct_change().replace([np.inf, -np.inf], np.nan)
    s = returns.dropna()
    if s.empty:
        return []
    mean = float(s.mean())
    std = float(s.std(ddof=0))
    if std == 0 or not np.isfinite(std):
        return []
    z = ((returns - mean) / std).fillna(0.0)
    out: list[OutlierEvent] = []
    for i, zval in enumerate(z):
        if abs(float(zval)) >= z_threshold:
            out.append(
                OutlierEvent(
                    t=int(df.iloc[i]["t"]),
                    value=float(df.iloc[i]["c"]),
                    zscore=float(zval),
                )
            )
    return out


def detect_splits(df: pd.DataFrame, tolerance: float = 0.15) -> list[SplitEvent]:
    if df.empty or len(df) < 2:
        return []
    prev_close = pd.to_numeric(df["c"], errors="coerce").shift(1)
    ratio = (prev_close / pd.to_numeric(df["c"], errors="coerce")).replace([np.inf, -np.inf], np.nan)
    candidate_factors = np.array([1.5, 2.0, 3.0, 4.0, 5.0, 10.0, 0.5, 1 / 3, 0.25, 0.2, 0.1], dtype=float)
    out: list[SplitEvent] = []
    for i, r in enumerate(ratio):
        if i == 0 or not np.isfinite(r):
            continue
        nearest = float(candidate_factors[np.argmin(np.abs(candidate_factors - float(r)))])
        if abs(float(r) - nearest) / max(nearest, 1e-9) <= tolerance:
            out.append(
                SplitEvent(
                    t=int(df.iloc[i]["t"]),
                    ratio=float(r),
                    approx_factor=nearest,
                )
            )
    return out


def run_integrity_checks(
    rows: list[dict[str, Any]] | pd.DataFrame,
    *,
    expected_interval_sec: int,
    outlier_z: float = 4.0,
    split_tolerance: float = 0.15,
) -> DataIntegrityReport:
    df = _to_frame(rows)
    report = DataIntegrityReport()
    if df.empty:
        return report
    report.gaps = detect_gaps(df, expected_interval_sec=expected_interval_sec)
    report.checks_run.append("gaps")
    report.outliers = detect_outliers(df, z_threshold=outlier_z)
    report.checks_run.append("outliers")
    report.splits = detect_splits(df, tolerance=split_tolerance)
    report.checks_run.append("splits")
    return report
