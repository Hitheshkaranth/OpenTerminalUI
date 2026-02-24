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
