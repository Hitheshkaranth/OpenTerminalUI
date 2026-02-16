from __future__ import annotations

import asyncio
from dataclasses import dataclass

from backend.api.routes import portfolio, search, stocks
from backend.db.models import Holding, WatchlistItem
from backend.shared.market_classifier import StockClassification, market_classifier


@dataclass
class _FakeHolding:
    id: int
    ticker: str
    quantity: float
    avg_buy_price: float
    buy_date: str


@dataclass
class _FakeWatchlist:
    id: int
    watchlist_name: str
    ticker: str


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return list(self._rows)


class _FakeDB:
    def __init__(self, holdings=None, watchlists=None):
        self._holdings = holdings or []
        self._watchlists = watchlists or []

    def query(self, model):
        if model is Holding:
            return _FakeQuery(self._holdings)
        if model is WatchlistItem:
            return _FakeQuery(self._watchlists)
        return _FakeQuery([])


def _us_classification(symbol: str) -> StockClassification:
    return StockClassification(
        symbol=symbol,
        display_name=symbol,
        exchange="NASDAQ",
        country_code="US",
        country_name="United States",
        flag_emoji="🇺🇸",
        currency="USD",
        has_futures=False,
        has_options=True,
        market_status="open",
    )


def test_market_classifier_fallback_defaults_unknown_unsuffixed_to_us(monkeypatch) -> None:
    async def _fake_nse_symbols():
        return {"RELIANCE", "TCS"}

    async def _fake_profile(_: str):
        return {}

    monkeypatch.setattr(market_classifier, "_load_nse_symbols", _fake_nse_symbols)
    monkeypatch.setattr(market_classifier, "_fetch_fmp_profile", _fake_profile)

    cls = asyncio.run(market_classifier.classify("AAPL"))
    assert cls.exchange == "NASDAQ"
    assert cls.country_code == "US"
    assert cls.has_options is True
    assert asyncio.run(market_classifier.yfinance_symbol("AAPL")) == "AAPL"


def test_stocks_route_includes_classification_and_us_symbol(monkeypatch) -> None:
    async def _fake_snapshot(_: str):
        return {"company_name": "Apple Inc."}

    async def _fake_classify(symbol: str):
        return _us_classification(symbol)

    async def _fake_yf_symbol(_: str):
        return "AAPL"

    monkeypatch.setattr(stocks, "fetch_stock_snapshot_coalesced", _fake_snapshot)
    monkeypatch.setattr(stocks.market_classifier, "classify", _fake_classify)
    monkeypatch.setattr(stocks.market_classifier, "yfinance_symbol", _fake_yf_symbol)

    out = asyncio.run(stocks.get_stock("AAPL"))
    assert out.symbol == "AAPL"
    assert out.country_code == "US"
    assert out.exchange == "NASDAQ"
    assert out.classification is not None
    assert out.classification["country_code"] == "US"
    assert out.classification["has_options"] is True


def test_portfolio_and_watchlist_are_enriched_with_market_fields(monkeypatch) -> None:
    async def _fake_snapshot(_: str):
        return {"current_price": 200.0, "sector": "Tech"}

    async def _fake_classify(symbol: str):
        return _us_classification(symbol)

    monkeypatch.setattr(portfolio, "fetch_stock_snapshot_coalesced", _fake_snapshot)
    monkeypatch.setattr(portfolio.market_classifier, "classify", _fake_classify)

    db = _FakeDB(
        holdings=[_FakeHolding(id=1, ticker="AAPL", quantity=2, avg_buy_price=150, buy_date="2025-01-01")],
        watchlists=[_FakeWatchlist(id=1, watchlist_name="Core", ticker="AAPL")],
    )
    port = asyncio.run(portfolio.get_portfolio(db=db))
    watch = asyncio.run(portfolio.get_watchlists(db=db))

    assert len(port["items"]) == 1
    row = port["items"][0]
    assert row["exchange"] == "NASDAQ"
    assert row["country_code"] == "US"
    assert row["flag_emoji"] == "🇺🇸"
    assert row["has_options"] is True

    assert len(watch["items"]) == 1
    wrow = watch["items"][0]
    assert wrow["exchange"] == "NASDAQ"
    assert wrow["country_code"] == "US"
    assert wrow["flag_emoji"] == "🇺🇸"
    assert wrow["has_options"] is True


def test_portfolio_watchlist_mixed_india_us_enrichment(monkeypatch) -> None:
    async def _fake_snapshot(_: str):
        return {"current_price": 100.0, "sector": "Mixed"}

    async def _fake_classify(symbol: str):
        s = symbol.strip().upper()
        if s == "RELIANCE":
            return StockClassification(
                symbol=s,
                display_name=s,
                exchange="NSE",
                country_code="IN",
                country_name="India",
                flag_emoji="🇮🇳",
                currency="INR",
                has_futures=True,
                has_options=True,
                market_status="open",
            )
        return _us_classification(s)

    monkeypatch.setattr(portfolio, "fetch_stock_snapshot_coalesced", _fake_snapshot)
    monkeypatch.setattr(portfolio.market_classifier, "classify", _fake_classify)

    db = _FakeDB(
        holdings=[
            _FakeHolding(id=1, ticker="RELIANCE", quantity=1, avg_buy_price=90, buy_date="2025-01-01"),
            _FakeHolding(id=2, ticker="AAPL", quantity=1, avg_buy_price=90, buy_date="2025-01-01"),
        ],
        watchlists=[
            _FakeWatchlist(id=1, watchlist_name="Core", ticker="RELIANCE"),
            _FakeWatchlist(id=2, watchlist_name="Core", ticker="AAPL"),
        ],
    )

    port = asyncio.run(portfolio.get_portfolio(db=db))
    watch = asyncio.run(portfolio.get_watchlists(db=db))

    by_ticker_port = {row["ticker"]: row for row in port["items"]}
    by_ticker_watch = {row["ticker"]: row for row in watch["items"]}

    assert by_ticker_port["RELIANCE"]["exchange"] == "NSE"
    assert by_ticker_port["RELIANCE"]["country_code"] == "IN"
    assert by_ticker_port["RELIANCE"]["has_futures"] is True
    assert by_ticker_port["RELIANCE"]["has_options"] is True

    assert by_ticker_port["AAPL"]["exchange"] == "NASDAQ"
    assert by_ticker_port["AAPL"]["country_code"] == "US"
    assert by_ticker_port["AAPL"]["has_futures"] is False
    assert by_ticker_port["AAPL"]["has_options"] is True

    assert by_ticker_watch["RELIANCE"]["flag_emoji"] == "🇮🇳"
    assert by_ticker_watch["AAPL"]["flag_emoji"] == "🇺🇸"


def test_search_results_include_flag_and_exchange(monkeypatch) -> None:
    async def _fake_rows():
        return [{"Symbol": "RELIANCE", "Company Name": "Reliance Industries Limited"}]

    async def _fake_classify(symbol: str):
        return StockClassification(
            symbol=symbol,
            display_name=symbol,
            exchange="NSE",
            country_code="IN",
            country_name="India",
            flag_emoji="🇮🇳",
            currency="INR",
            has_futures=True,
            has_options=True,
            market_status="open",
        )

    monkeypatch.setattr(search, "_get_rows", _fake_rows)
    monkeypatch.setattr(search.market_classifier, "classify", _fake_classify)

    out = asyncio.run(search.search(q="reli"))
    assert len(out.results) == 1
    first = out.results[0]
    assert first.exchange == "NSE"
    assert first.country_code == "IN"
    assert first.flag_emoji == "🇮🇳"


def test_search_fallback_includes_direct_us_ticker_query(monkeypatch) -> None:
    async def _fake_rows():
        return []

    async def _fake_classify(symbol: str):
        return _us_classification(symbol)

    monkeypatch.setattr(search, "_get_rows", _fake_rows)
    monkeypatch.setattr(search.market_classifier, "classify", _fake_classify)

    out = asyncio.run(search.search(q="AAPL"))
    assert len(out.results) == 1
    first = out.results[0]
    assert first.ticker == "AAPL"
    assert first.exchange == "NASDAQ"
    assert first.country_code == "US"
