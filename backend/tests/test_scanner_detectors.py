from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pandas as pd

from backend.scanner_engine.detectors import breakout_n_day_high, trend_retest
from backend.scanner_engine.indicators import compute_indicator_pack


def _frame(days: int = 260) -> pd.DataFrame:
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    rows: list[dict[str, float]] = []
    idx = []
    price = 100.0
    for i in range(days):
        price = price + 0.5
        rows.append(
            {
                "Open": price - 0.2,
                "High": price + 0.4,
                "Low": price - 0.6,
                "Close": price,
                "Volume": 1_000_000 + (i * 1000),
            }
        )
        idx.append(start + timedelta(days=i))
    return pd.DataFrame(rows, index=pd.DatetimeIndex(idx))


def test_breakout_detector_passes_on_strong_close() -> None:
    base = _frame()
    base.iloc[-1, base.columns.get_loc("Close")] = float(base["High"].iloc[-21:-1].max()) * 1.01
    enriched = compute_indicator_pack(base)
    result = breakout_n_day_high(enriched, n=20, buffer_pct=0.001, rvol_threshold=0.5, near_trigger_pct=0.003)
    assert result["passed"] is True
    assert result["setup_type"] == "20D_BREAKOUT"
    assert isinstance(result.get("explain_steps"), list)


def test_trend_retest_is_deterministic() -> None:
    base = _frame()
    enriched = compute_indicator_pack(base)
    a = trend_retest(enriched, ema_tolerance_pct=0.02, rvol_threshold=0.1)
    b = trend_retest(enriched, ema_tolerance_pct=0.02, rvol_threshold=0.1)
    assert a == b
