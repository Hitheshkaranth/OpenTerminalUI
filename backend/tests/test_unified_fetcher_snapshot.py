from __future__ import annotations

import asyncio

from backend.adapters.base import OHLCV, QuoteResponse
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

    async def get_chart(self, _symbol: str, _range_str: str = "1y", _interval: str = "1d"):
        return {"chart": {"result": []}}

    async def search_news(self, _query: str, limit: int = 30):
        return [{"title": "Headline", "link": "https://example.com/1"}][:limit]


class _DummyFMP:
    async def get_quote(self, _symbol: str):
        return {}

    async def get_historical_price_full(self, _symbol: str):
        return {}


class _DummyFinnhub:
    async def get_company_profile(self, _symbol: str):
        return {}

    api_key = "test-key"

    async def get_company_news(self, symbol: str, limit: int = 30):
        return [{"headline": f"{symbol} news", "url": "https://example.com/company"}][:limit]

    async def get_market_news(self, category: str = "general", limit: int = 30):
        return [{"headline": f"{category} market", "url": "https://example.com/market"}][:limit]


class _DummyKite:
    api_key = None

    def resolve_access_token(self):
        return None


class _RegistryStub:
    def __init__(self, *, quote: QuoteResponse | None = None, history: list[OHLCV] | None = None) -> None:
        self.quote = quote
        self.history = history or []

    async def invoke(self, exchange: str, method: str, *args):
        if method == "get_quote":
            return self.quote
        if method == "get_history":
            return self.history
        raise AssertionError(f"Unexpected invoke: {exchange}:{method}:{args}")


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


def test_fetch_quote_uses_adapter_registry_and_preserves_payload_shape(monkeypatch) -> None:
    async def _fake_classify(symbol: str):
        return _us_classification(symbol)

    monkeypatch.setattr(market_classifier, "classify", _fake_classify)
    monkeypatch.setattr(
        "backend.core.unified_fetcher.get_adapter_registry",
        lambda: _RegistryStub(quote=QuoteResponse(symbol="AAPL", price=201.5, change=1.2, change_pct=0.6, currency="USD")),
    )

    fetcher = UnifiedFetcher(
        nse=_DummyNSE(),
        yahoo=_DummyYahoo(),
        fmp=_DummyFMP(),
        finnhub=_DummyFinnhub(),
        kite=_DummyKite(),
    )

    payload = asyncio.run(fetcher.fetch_quote("AAPL"))

    assert payload["price"] == 201.5
    assert payload["last_price"] == 201.5
    assert payload["regularMarketPrice"] == 201.5
    assert payload["c"] == 201.5
    assert payload["dp"] == 0.6


def test_fetch_history_uses_adapter_registry_and_returns_chart_payload(monkeypatch) -> None:
    async def _fake_classify(symbol: str):
        return _us_classification(symbol)

    history = [
        OHLCV(t=1710000000, o=100.0, h=101.0, l=99.5, c=100.5, v=1000.0),
        OHLCV(t=1710086400, o=100.5, h=102.0, l=100.0, c=101.5, v=1200.0),
    ]

    monkeypatch.setattr(market_classifier, "classify", _fake_classify)
    monkeypatch.setattr(
        "backend.core.unified_fetcher.get_adapter_registry",
        lambda: _RegistryStub(history=history),
    )

    fetcher = UnifiedFetcher(
        nse=_DummyNSE(),
        yahoo=_DummyYahoo(),
        fmp=_DummyFMP(),
        finnhub=_DummyFinnhub(),
        kite=_DummyKite(),
    )

    payload = asyncio.run(fetcher.fetch_history("AAPL", range_str="1mo", interval="1d"))

    result = payload["chart"]["result"][0]
    assert result["timestamp"] == [1710000000, 1710086400]
    quote = result["indicators"]["quote"][0]
    assert quote["open"] == [100.0, 100.5]
    assert quote["close"] == [100.5, 101.5]


def test_fetch_stock_snapshot_uses_unified_quote_path_for_price(monkeypatch) -> None:
    async def _fake_classify(symbol: str):
        return _us_classification(symbol)

    async def _fake_yfinance_symbol(symbol: str):
        return symbol.strip().upper()

    monkeypatch.setattr(market_classifier, "classify", _fake_classify)
    monkeypatch.setattr(market_classifier, "yfinance_symbol", _fake_yfinance_symbol)
    monkeypatch.setattr(
        "backend.core.unified_fetcher.get_adapter_registry",
        lambda: _RegistryStub(quote=QuoteResponse(symbol="COST", price=999.0, change=10.0, change_pct=1.5, currency="USD")),
    )

    fetcher = UnifiedFetcher(
        nse=_DummyNSE(),
        yahoo=_DummyYahoo(),
        fmp=_DummyFMP(),
        finnhub=_DummyFinnhub(),
        kite=_DummyKite(),
    )

    snapshot = asyncio.run(fetcher.fetch_stock_snapshot("COST"))

    assert snapshot["current_price"] == 999.0
    assert snapshot["change_pct"] == 1.5
    assert snapshot["details"]["price_source"] == "adapter"


def test_search_news_uses_yahoo_wrapper() -> None:
    fetcher = UnifiedFetcher(
        nse=_DummyNSE(),
        yahoo=_DummyYahoo(),
        fmp=_DummyFMP(),
        finnhub=_DummyFinnhub(),
        kite=_DummyKite(),
    )

    rows = asyncio.run(fetcher.search_news("nvidia", limit=5))

    assert len(rows) == 1
    assert rows[0]["title"] == "Headline"


def test_get_company_news_uses_finnhub_wrapper() -> None:
    fetcher = UnifiedFetcher(
        nse=_DummyNSE(),
        yahoo=_DummyYahoo(),
        fmp=_DummyFMP(),
        finnhub=_DummyFinnhub(),
        kite=_DummyKite(),
    )

    rows = asyncio.run(fetcher.get_company_news("AAPL", limit=5))

    assert len(rows) == 1
    assert rows[0]["headline"] == "AAPL news"


def test_get_market_news_uses_finnhub_wrapper() -> None:
    fetcher = UnifiedFetcher(
        nse=_DummyNSE(),
        yahoo=_DummyYahoo(),
        fmp=_DummyFMP(),
        finnhub=_DummyFinnhub(),
        kite=_DummyKite(),
    )

    rows = asyncio.run(fetcher.get_market_news("general", limit=5))

    assert len(rows) == 1
    assert rows[0]["headline"] == "general market"
