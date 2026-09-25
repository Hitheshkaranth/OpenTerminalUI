from __future__ import annotations

from backend.services.orderbook_service import OrderBookService


def test_synthetic_book_is_centred_on_real_price_and_labelled() -> None:
    svc = OrderBookService()
    wire = svc.get_snapshot("RELIANCE", market_hint="NSE", levels=5, ref_price=1219.2).to_wire()

    assert abs(wire["mid_price"] - 1219.2) < 1.0
    assert wire["synthetic"] is True
    assert wire["provenance"]["quality"] == "synthetic"


def test_stream_frames_reuse_last_known_real_price() -> None:
    svc = OrderBookService()
    unanchored = svc.stream_message("RELIANCE", market_hint="NSE", levels=5)["snapshot"]["mid_price"]
    svc.get_snapshot("RELIANCE", market_hint="NSE", levels=5, ref_price=1219.2)

    msg = svc.stream_message("RELIANCE", market_hint="NSE", levels=5)
    assert abs(msg["snapshot"]["mid_price"] - 1219.2) < 1.0
    assert abs(unanchored - 1219.2) > 1.0  # seeded base price is unrelated to the real price

    direct = svc.stream_message("TCS", market_hint="NSE", levels=5, ref_price=3050.0)
    assert abs(direct["snapshot"]["mid_price"] - 3050.0) < 1.0
