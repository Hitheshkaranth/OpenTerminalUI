from __future__ import annotations

import asyncio
from datetime import date

from backend.adapters.base import QuoteResponse
from backend.adapters.yahoo import YahooFinanceAdapter, _yahoo_symbol, active_exchange
from backend.api.routes.stocks import _session_stats_from_history


def _with_exchange(exchange: str, fn):
    token = active_exchange.set(exchange)
    try:
        return fn()
    finally:
        active_exchange.reset(token)


def test_yahoo_symbol_suffixes_indian_exchanges_only():
    # Bare "INFY" on Yahoo is the US ADR; on the NSE chain it must be INFY.NS.
    assert _with_exchange("NSE", lambda: _yahoo_symbol("infy")) == "INFY.NS"
    assert _with_exchange("NSE", lambda: _yahoo_symbol("BAJAJ-AUTO")) == "BAJAJ-AUTO.NS"
    assert _with_exchange("BSE", lambda: _yahoo_symbol("INFY")) == "INFY.BO"
    assert _with_exchange("NSE", lambda: _yahoo_symbol("RELIANCE.NS")) == "RELIANCE.NS"
    assert _with_exchange("NSE", lambda: _yahoo_symbol("^NSEI")) == "^NSEI"
    assert _with_exchange("NASDAQ", lambda: _yahoo_symbol("INFY")) == "INFY"
    assert _yahoo_symbol("AAPL") == "AAPL"


class _FakeYahoo:
    def __init__(self) -> None:
        self.seen: list[str] = []

    async def get_quotes(self, symbols):
        self.seen.extend(symbols)
        return [{"regularMarketPrice": 1035.0, "regularMarketChangePercent": 4.11, "currency": "INR", "shortName": "Infosys"}]

    async def get_chart(self, symbol, range_str="1y", interval="1d"):
        self.seen.append(symbol)
        return {}


def test_yahoo_adapter_quote_builds_and_uses_exchange_symbol():
    fake = _FakeYahoo()
    adapter = YahooFinanceAdapter(yahoo=fake)  # type: ignore[arg-type]

    async def run():
        token = active_exchange.set("NSE")
        try:
            quote = await adapter.get_quote("INFY")
            await adapter.get_history("INFY", "1d", date(2026, 1, 1), date(2026, 2, 1))
            return quote
        finally:
            active_exchange.reset(token)

    quote = asyncio.run(run())
    assert isinstance(quote, QuoteResponse)
    assert quote.symbol == "INFY" and quote.company_name == "Infosys" and quote.currency == "INR"
    assert fake.seen == ["INFY.NS", "INFY.NS"]


def test_session_stats_from_history():
    payload = {
        "chart": {
            "result": [
                {
                    "timestamp": [1, 2, 3, 4],
                    "indicators": {
                        "quote": [
                            {
                                "open": [10, 11, None, 13],
                                "high": [12, 15, 14, 14],
                                "low": [9, 10, 11, 8],
                                "close": [11, 14, 12, 13],
                                "volume": [100, 200, 300, 400],
                            }
                        ]
                    },
                }
            ]
        }
    }
    stats = _session_stats_from_history(payload)
    # Bar 3 has a null open and is dropped, so the previous session is bar 2.
    assert stats["previous_close"] == 14
    assert (stats["open"], stats["day_high"], stats["day_low"], stats["volume"]) == (13, 14, 8, 400)
    assert stats["avg_volume"] == 150
    assert (stats["high_52w"], stats["low_52w"]) == (15, 8)
    assert _session_stats_from_history({}) == {}


def test_backtest_config_honours_ui_execution_profile():
    import pandas as pd

    from backend.core.backtesting_models import BacktestConfig
    from backend.core.single_asset_backtest import BacktestEngine

    profile = {"commission_bps": 5, "slippage_bps": 3, "spread_bps": 1, "market_impact_bps": 0}
    cfg = BacktestConfig(**{"execution_profile": profile})
    assert (cfg.fee_bps, cfg.slippage_bps) == (5.0, 4.0)
    # Explicit top-level values take precedence over the profile.
    assert BacktestConfig(**{"fee_bps": 1, "execution_profile": profile}).fee_bps == 1.0

    frame = pd.DataFrame(
        {
            "date": pd.date_range("2024-01-01", periods=6, freq="D").astype(str),
            "open": [100, 101, 102, 103, 104, 105],
            "high": [101, 102, 103, 104, 105, 106],
            "low": [99, 100, 101, 102, 103, 104],
            "close": [100, 101, 102, 103, 104, 105],
            "volume": [1000] * 6,
        }
    )
    signals = pd.Series([0, 1, 1, 1, -1, 0])
    free = BacktestEngine(BacktestConfig()).run("X", frame, signals)
    costed = BacktestEngine(BacktestConfig(**{"execution_profile": profile})).run("X", frame, signals)
    assert costed.final_equity < free.final_equity
