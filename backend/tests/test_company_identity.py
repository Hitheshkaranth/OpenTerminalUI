from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from backend.shared.company_identity import company_url, first_company_url
from backend.core.models import StockSnapshot
from backend.core.unified_fetcher import UnifiedFetcher
from backend.api.routes import stocks


@pytest.mark.parametrize("value", [None, 123, "", "javascript:alert(1)", "data:image/svg+xml,x", "//example.com/logo.png", "https://user:secret@example.com/logo", "https://example.com:bad/logo", "https://example.com/\nlogo", "https://"])
def test_invalid_provider_branding_is_absent(value):
    snapshot = StockSnapshot(ticker="AAPL", symbol="AAPL", logo_url=value, website=value)
    assert snapshot.logo_url is None
    assert snapshot.website is None


def test_optional_identity_survives_json_serialization():
    result = StockSnapshot(ticker="AAPL", symbol="AAPL", company_name="Apple Inc.",
        logo_url="https://static.example.com/apple.png", website="https://www.apple.com/").model_dump(mode="json")
    assert result["logo_url"] == "https://static.example.com/apple.png"
    assert result["website"] == "https://www.apple.com/"
    assert first_company_url("javascript:bad", " https://www.apple.com/ ") == "https://www.apple.com/"


def test_unified_snapshot_reuses_existing_profile_metadata(monkeypatch):
    from backend.shared.market_classifier import StockClassification, market_classifier
    cls = StockClassification(symbol="AAPL", display_name="Apple", exchange="NASDAQ", country_code="US",
        country_name="United States", flag_emoji="US", currency="USD", has_futures=False, has_options=True, market_status="open")
    monkeypatch.setattr(market_classifier, "classify", AsyncMock(return_value=cls))
    monkeypatch.setattr(market_classifier, "yfinance_symbol", AsyncMock(return_value="AAPL"))
    yahoo = SimpleNamespace(get_quote_summary=AsyncMock(return_value={"assetProfile": {"website": "https://www.apple.com/"}}),
                            get_quotes=AsyncMock(return_value=[{"shortName": "Apple Inc."}]))
    finnhub = SimpleNamespace(get_company_profile=AsyncMock(return_value={"logo": "https://static.example.com/apple.png", "weburl": "https://apple.com"}))
    fmp = SimpleNamespace(get_quote=AsyncMock(return_value={}))
    fetcher = UnifiedFetcher(nse=SimpleNamespace(), yahoo=yahoo, fmp=fmp, finnhub=finnhub, kite=SimpleNamespace())
    monkeypatch.setattr(fetcher, "fetch_quote", AsyncMock(return_value={}))
    result = asyncio.run(fetcher.fetch_stock_snapshot("AAPL"))
    assert result["logo_url"] == "https://static.example.com/apple.png"
    assert result["website"] == "https://www.apple.com/"
    assert result["company_name"] == "Apple Inc."
    finnhub.get_company_profile.assert_awaited_once()
    yahoo.get_quote_summary.assert_awaited_once()


def test_stock_route_passes_provider_identity_without_extra_fetches(monkeypatch):
    cls = SimpleNamespace(exchange="NASDAQ", country_code="US", currency="USD", flag_emoji="US", has_futures=False, has_options=True)
    monkeypatch.setattr(stocks.market_classifier, "classify", AsyncMock(return_value=cls))
    monkeypatch.setattr(stocks.market_classifier, "yfinance_symbol", AsyncMock(return_value="AAPL"))
    monkeypatch.setattr(stocks, "fetch_stock_snapshot_coalesced", AsyncMock(return_value={"company_name": "Apple Inc.", "logo_url": "https://static.example.com/apple.png", "website": "https://apple.com"}))
    monkeypatch.setattr(stocks, "_fetch_history_for_stats", AsyncMock(return_value={}))
    monkeypatch.setattr(stocks, "get_adapter_registry", lambda: SimpleNamespace(invoke=AsyncMock(return_value=None)))
    result = asyncio.run(stocks.get_stock("AAPL")).model_dump(mode="json")
    assert result["logo_url"] == "https://static.example.com/apple.png"
    assert result["website"] == "https://apple.com"
