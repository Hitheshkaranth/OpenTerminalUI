from __future__ import annotations

from datetime import datetime, timezone

from backend.services.candle_aggregator import CandleAggregator


def test_candle_aggregator_rolls_and_emits_closed_candle() -> None:
    agg = CandleAggregator()
    sym = "NSE:INFY"

    out1 = agg.on_tick(sym, 100.0, 10, datetime(2026, 2, 24, 9, 15, 5, tzinfo=timezone.utc))
    assert out1 == []

    out2 = agg.on_tick(sym, 101.0, 5, datetime(2026, 2, 24, 9, 15, 40, tzinfo=timezone.utc))
    assert out2 == []

    out3 = agg.on_tick(sym, 102.0, 7, datetime(2026, 2, 24, 9, 16, 0, tzinfo=timezone.utc))
    one_min = [row for row in out3 if row[1] == "1m"]
    assert len(one_min) == 1
    _, interval, candle = one_min[0]
    assert interval == "1m"
    assert candle["o"] == 100.0
    assert candle["h"] == 101.0
    assert candle["l"] == 100.0
    assert candle["c"] == 101.0
    assert candle["v"] == 15.0


def test_candle_aggregator_emits_5m_and_15m_on_boundary_rollover() -> None:
    agg = CandleAggregator()
    sym = "NSE:INFY"

    # First tick initializes 1m/5m/15m buckets.
    out1 = agg.on_tick(sym, 200.0, 20, datetime(2026, 2, 24, 9, 0, 10, tzinfo=timezone.utc))
    assert out1 == []

    # Crossing 9:15 rolls both the 5m (9:10 -> 9:15) and 15m (9:00 -> 9:15) candles.
    out2 = agg.on_tick(sym, 210.0, 30, datetime(2026, 2, 24, 9, 15, 0, tzinfo=timezone.utc))
    intervals = [row[1] for row in out2]
    assert "5m" in intervals
    assert "15m" in intervals

    five_min = [row for row in out2 if row[1] == "5m"][0][2]
    fifteen_min = [row for row in out2 if row[1] == "15m"][0][2]

    assert five_min["o"] == 200.0
    assert five_min["c"] == 200.0
    assert five_min["v"] == 20.0

    assert fifteen_min["o"] == 200.0
    assert fifteen_min["c"] == 200.0
    assert fifteen_min["v"] == 20.0
