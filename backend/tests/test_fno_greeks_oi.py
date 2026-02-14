from __future__ import annotations

from backend.fno.services.greeks_engine import GreeksEngine
from backend.fno.services.oi_analyzer import OIAnalyzer


def _sample_chain() -> dict:
    return {
        "symbol": "NIFTY",
        "expiry_date": "2026-02-27",
        "spot_price": 22850.0,
        "strikes": [
            {
                "strike_price": 22700,
                "ce": {"oi": 100000, "oi_change": 1200, "volume": 15000, "iv": 12.0, "ltp": 240.0, "price_change": 5.0},
                "pe": {"oi": 220000, "oi_change": -800, "volume": 11000, "iv": 13.5, "ltp": 95.0, "price_change": -2.0},
            },
            {
                "strike_price": 22850,
                "ce": {"oi": 140000, "oi_change": 3000, "volume": 18000, "iv": 12.2, "ltp": 170.0, "price_change": 3.0},
                "pe": {"oi": 180000, "oi_change": 1200, "volume": 17000, "iv": 12.8, "ltp": 165.0, "price_change": 4.0},
            },
            {
                "strike_price": 23000,
                "ce": {"oi": 260000, "oi_change": 5000, "volume": 21000, "iv": 13.1, "ltp": 105.0, "price_change": -4.0},
                "pe": {"oi": 130000, "oi_change": 700, "volume": 9000, "iv": 13.9, "ltp": 230.0, "price_change": 6.0},
            },
        ],
    }


def test_greeks_engine_single_call() -> None:
    engine = GreeksEngine()
    out = engine.compute_greeks(spot=22850, strike=22850, days_to_expiry=14, iv=12.5, option_type="CE")
    assert set(out.keys()) == {"delta", "gamma", "theta", "vega", "rho"}
    assert out["delta"] >= 0.0


def test_greeks_engine_chain_enrichment() -> None:
    engine = GreeksEngine()
    chain = engine.compute_chain_greeks(_sample_chain())
    first = chain["strikes"][0]
    assert "greeks" in first["ce"]
    assert "greeks" in first["pe"]


def test_oi_analyzer_outputs() -> None:
    analyzer = OIAnalyzer()
    chain = _sample_chain()
    pcr = analyzer.get_pcr(chain)
    assert "signal" in pcr
    assert pcr["pcr_oi"] > 0
    sr = analyzer.find_support_resistance(chain)
    assert len(sr["support"]) <= 2
    assert len(sr["resistance"]) <= 2
    max_pain = analyzer.find_max_pain(chain)
    assert max_pain > 0
