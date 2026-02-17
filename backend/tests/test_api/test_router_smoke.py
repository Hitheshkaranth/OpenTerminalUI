from __future__ import annotations

from backend.api.routes import backtest, futures, indicators, news, quotes, screener, stocks
from backend.equity.routes import mutual_funds


def test_quotes_router_registered() -> None:
    assert quotes.router is not None


def test_stocks_router_registered() -> None:
    assert stocks.router is not None


def test_futures_router_registered() -> None:
    assert futures.router is not None


def test_news_router_registered() -> None:
    assert news.router is not None


def test_mutual_funds_router_registered() -> None:
    assert mutual_funds.router is not None


def test_screener_router_registered() -> None:
    assert screener.router is not None


def test_indicators_router_registered() -> None:
    assert indicators.router is not None


def test_backtesting_router_registered() -> None:
    assert backtest.router is not None
