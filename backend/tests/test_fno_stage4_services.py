from __future__ import annotations

import asyncio

from backend.fno.services.iv_engine import IVEngine
from backend.fno.services.pcr_tracker import PCRTracker
from backend.fno.services.strategy_builder import StrategyBuilder


class _FakeFetcher:
    async def get_option_chain(self, symbol: str, expiry: str | None = None, strike_range: int = 20):  # noqa: ARG002
        return {
            "symbol": symbol.upper(),
            "expiry_date": expiry or "2026-02-27",
            "spot_price": 22850.0,
            "atm_strike": 22850.0,
            "timestamp": "2026-02-14T10:00:00+00:00",
            "strikes": [
                {
                    "strike_price": 22750.0,
                    "ce": {"oi": 1000, "volume": 100, "iv": 12.1, "ltp": 180},
                    "pe": {"oi": 1500, "volume": 140, "iv": 12.9, "ltp": 120},
                },
                {
                    "strike_price": 22850.0,
                    "ce": {"oi": 1300, "volume": 130, "iv": 12.3, "ltp": 150},
                    "pe": {"oi": 1600, "volume": 170, "iv": 12.7, "ltp": 160},
                },
                {
                    "strike_price": 22950.0,
                    "ce": {"oi": 1800, "volume": 160, "iv": 12.6, "ltp": 120},
                    "pe": {"oi": 1200, "volume": 110, "iv": 13.0, "ltp": 200},
                },
            ],
            "totals": {"ce_oi_total": 4100, "pe_oi_total": 4300, "ce_volume_total": 390, "pe_volume_total": 420, "pcr_oi": 1.0488, "pcr_volume": 1.0769},
        }

    async def get_expiry_dates(self, symbol: str):  # noqa: ARG002
        return ["2026-02-27", "2026-03-06", "2026-03-27"]


def test_strategy_builder_payoff_and_detection() -> None:
    builder = StrategyBuilder()
    legs = [
        {"type": "CE", "strike": 23000, "action": "buy", "premium": 150, "lots": 1, "lot_size": 50, "expiry": "2026-02-27"},
        {"type": "CE", "strike": 23200, "action": "sell", "premium": 80, "lots": 1, "lot_size": 50, "expiry": "2026-02-27"},
    ]
    out = builder.compute_payoff(legs)
    assert out["strategy_name"] == "Bull Call Spread"
    assert isinstance(out["payoff_at_expiry"], list)
    assert "net_premium" in out


def test_pcr_tracker_current_and_by_strike() -> None:
    tracker = PCRTracker()
    tracker._fetcher = _FakeFetcher()  # noqa: SLF001
    current = asyncio.run(tracker.get_current_pcr("NIFTY"))
    assert current["symbol"] == "NIFTY"
    assert float(current["pcr_oi"]) > 0
    by_strike = asyncio.run(tracker.get_pcr_by_strike("NIFTY"))
    assert len(by_strike) == 3


def test_iv_engine_shape() -> None:
    engine = IVEngine()
    engine._fetcher = _FakeFetcher()  # noqa: SLF001
    iv = asyncio.run(engine.get_iv_data("NIFTY"))
    assert iv["symbol"] == "NIFTY"
    assert len(iv["iv_skew"]) == 3
    surface = asyncio.run(engine.get_iv_surface("NIFTY"))
    assert len(surface["expiries"]) == 3


class _EmptyFetcher(_FakeFetcher):
    async def get_option_chain(self, symbol: str, expiry: str | None = None, strike_range: int = 20):  # noqa: ARG002
        return {"symbol": symbol.upper(), "expiry_date": "", "spot_price": 0.0, "atm_strike": 0.0, "strikes": [], "totals": {}}


def test_pcr_empty_chain_is_no_data_not_bearish() -> None:
    from backend.fno.services.oi_analyzer import OIAnalyzer

    pcr = OIAnalyzer().get_pcr({"strikes": []})
    assert pcr["pcr_oi"] is None
    assert pcr["signal"] == "No data"

    tracker = PCRTracker()
    tracker._fetcher = _EmptyFetcher()  # noqa: SLF001
    current = asyncio.run(tracker.get_current_pcr("NOCHAINSYM"))
    assert current["pcr_oi"] is None
    assert current["signal"] == "No data"


def test_iv_rank_undefined_without_history() -> None:
    engine = IVEngine()
    # Only the current reading (no stored history for this symbol): no range to rank against.
    assert asyncio.run(engine._iv_rank_percentile("NOIVHISTORYSYM", 18.5)) == (None, None)  # noqa: SLF001
    assert asyncio.run(engine._iv_rank_percentile("NOIVHISTORYSYM", 0.0)) == (None, None)  # noqa: SLF001
