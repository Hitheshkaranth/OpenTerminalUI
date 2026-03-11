from __future__ import annotations

import asyncio

from backend.core.unified_fetcher import UnifiedFetcher
from backend.shared.market_classifier import StockClassification, market_classifier


class _DummyNSE:
    async def get_quote_equity(self, _symbol: str):
        return {}

    async def get_trade_info(self, _symbol: str):
        return {}


class _DummyYahoo:
    async def get_quote_summary(self, _symbol: str, _modules):
        return {
            "assetProfile": {
                "sector": "Consumer Defensive",
                "industry": "Discount Stores",
            }
        }

    async def get_quotes(self, _symbols):
        return [{"shortName": "Costco Wholesale Corporation"}]


class _DummyFMP:
    async def get_quote(self, _symbol: str):
        return {}


class _DummyFinnhub:
    async def get_company_profile(self, _symbol: str):
        return {}


class _DummyKite:
    api_key = None

    def resolve_access_token(self):
        return None


def _us_classification(symbol: str) -> StockClassification:
    return StockClassification(
        symbol=symbol,
        display_name=symbol,
        exchange="NASDAQ",
        country_code="US",
        country_name="United States",
        flag_emoji="US",
        currency="USD",
        has_futures=False,
        has_options=True,
        market_status="open",
    )


def test_fetch_stock_snapshot_uses_yahoo_quote_name_for_us_symbols(monkeypatch) -> None:
    async def _fake_classify(symbol: str):
        return _us_classification(symbol)

    async def _fake_yfinance_symbol(symbol: str):
        return symbol.strip().upper()

    monkeypatch.setattr(market_classifier, "classify", _fake_classify)
    monkeypatch.setattr(market_classifier, "yfinance_symbol", _fake_yfinance_symbol)

    fetcher = UnifiedFetcher(
        nse=_DummyNSE(),
        yahoo=_DummyYahoo(),
        fmp=_DummyFMP(),
        finnhub=_DummyFinnhub(),
        kite=_DummyKite(),
    )

    snapshot = asyncio.run(fetcher.fetch_stock_snapshot("COST"))

    assert snapshot["company_name"] == "Costco Wholesale Corporation"
    assert snapshot["exchange"] == "NASDAQ"
    assert snapshot["country_code"] == "US"
