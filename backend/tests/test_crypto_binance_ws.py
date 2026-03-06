from __future__ import annotations

from backend.realtime.binance_ws import BinanceDerivativesState


def test_binance_derivatives_state_aggregates_by_symbol_and_side() -> None:
    state = BinanceDerivativesState()
    state.ingest_event("BTC-USD", 0.0002, 1000, side="long", ts_ms=1700000000000)
    state.ingest_event("BTC-USD", 0.0002, 400, side="short", ts_ms=1700000001000)
    state.ingest_event("ETH-USD", -0.0001, 500, side="short", ts_ms=1700000002000)

    snapshot = state.snapshot(limit=10)
    assert len(snapshot["items"]) == 2

    first = snapshot["items"][0]
    assert first["symbol"] == "BTC-USD"
    assert first["long_liquidations_24h"] == 1000
    assert first["short_liquidations_24h"] == 400
    assert first["liquidations_24h"] == 1400

    totals = snapshot["totals"]
    assert totals["liquidations_24h"] == 1900
    assert totals["liquidations_24h"] == totals["long_liquidations_24h"] + totals["short_liquidations_24h"]
