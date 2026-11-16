"""Actual failover identity must distinguish synthetic from market history."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from backend.adapters.base import OHLCV
from backend.adapters.mock import MockDataAdapter
from backend.adapters.registry import AdapterRegistry
from backend.adapters.yahoo import YahooFinanceAdapter, active_exchange
from backend.agent.strategy_loop.holdout import load_sma_holdout_session
from backend.agent.tools.market_tools import _history_provenance
from backend.core import unified_fetcher


class BrokenHistory:
    async def get_history(self, *args):
        raise RuntimeError("primary offline")


def registry_with(primary, fallback=None):
    registry = AdapterRegistry()
    registry._config = {"default": {"primary": "primary", "fallback": ["fallback"] if fallback else []}}
    registry._factory["primary"] = lambda: primary
    if fallback:
        registry._factory["fallback"] = lambda: fallback
    return registry


async def install_fetcher(monkeypatch, registry):
    async def exchange(symbol):
        return "NSE", symbol

    async def no_network(*args, **kwargs):
        pytest.fail("test history must be served by the configured offline adapter")

    monkeypatch.setattr(unified_fetcher, "get_adapter_registry", lambda: registry)
    monkeypatch.setattr(unified_fetcher, "_adapter_exchange_and_symbol", exchange)
    fetcher = unified_fetcher.UnifiedFetcher(nse=SimpleNamespace(), yahoo=SimpleNamespace(get_chart=no_network),
        fmp=SimpleNamespace(get_historical_price_full=no_network), finnhub=SimpleNamespace(), kite=SimpleNamespace())
    from backend.api import deps

    async def injected_fetcher():
        return fetcher

    monkeypatch.setattr(deps, "get_unified_fetcher", injected_fetcher)
    return fetcher


@pytest.mark.asyncio
async def test_actual_primary_failure_to_mock_is_synthetic_and_rejected_by_holdout(monkeypatch):
    registry = registry_with(BrokenHistory(), MockDataAdapter(seed=17))
    fetcher = await install_fetcher(monkeypatch, registry)
    raw = await fetcher.fetch_history("TCS", range_str="3y")
    assert raw["_adapter_name"] == "mock" and raw["_quality"] == "synthetic"
    assert raw["_source"] == "adapter:mock"
    assert raw["_adapter_slot"] == "fallback"  # identity is the successful instance, not slot alias
    assert registry._slots["primary"].failures == 1
    assert registry._slots["fallback"].last_success_at is not None
    assert _history_provenance(raw, "research")["quality"] == "synthetic"
    with pytest.raises(ValueError, match="source-reported"):
        await load_sma_holdout_session("TCS")


@pytest.mark.asyncio
async def test_mock_configured_as_primary_cannot_inherit_exchange_live_quality(monkeypatch):
    registry = registry_with(MockDataAdapter(seed=3))
    fetcher = await install_fetcher(monkeypatch, registry)
    raw = await fetcher.fetch_history("TCS", range_str="3y")
    assert raw["_quality"] == "synthetic"
    assert _history_provenance(raw, "research")["quality"] == "synthetic"


class OfflineYahoo:
    def __init__(self):
        self.symbols = []

    async def get_chart(self, symbol, **kwargs):
        self.symbols.append(symbol)
        start = datetime(2023, 1, 1, tzinfo=timezone.utc)
        rows = [OHLCV(t=int((start + timedelta(days=index)).timestamp()), o=100 + index * .1,
                      h=102 + index * .1, l=98 + index * .1, c=101 + index * .1, v=1000) for index in range(240)]
        return unified_fetcher._chart_payload_from_rows(rows)


@pytest.mark.asyncio
async def test_known_real_adapter_has_truthful_name_quality_and_retains_exchange_context(monkeypatch):
    client = OfflineYahoo()
    registry = registry_with(BrokenHistory(), YahooFinanceAdapter(yahoo=client))
    fetcher = await install_fetcher(monkeypatch, registry)
    raw = await fetcher.fetch_history("TCS", range_str="3y")
    assert raw["_adapter_name"] == raw["_data_provider"] == "yahoo"
    assert raw["_quality"] == "delayed"
    assert raw["_source"] == "adapter:yahoo"
    assert client.symbols == ["TCS.NS"]
    assert active_exchange.get() == ""
    assert _history_provenance(raw, "research")["quality"] == "delayed"
    session = await load_sma_holdout_session("TCS")
    assert session.provenance["source"] == "adapter:yahoo"
    assert session.split_metadata()["train_bars"] == 168


@pytest.mark.asyncio
async def test_unknown_adapter_is_unreported_even_under_known_slot_alias(monkeypatch):
    class Unknown:
        async def get_history(self, symbol, timeframe, start, end):
            return await MockDataAdapter(seed=1).get_history(symbol, timeframe, start, end)

    registry = registry_with(Unknown())
    fetcher = await install_fetcher(monkeypatch, registry)
    raw = await fetcher.fetch_history("TCS")
    assert raw["_quality"] == "unreported"
    assert _history_provenance(raw, "research")["quality"] == "unreported"
    with pytest.raises(ValueError, match="source-reported"):
        await load_sma_holdout_session("TCS")


@pytest.mark.asyncio
async def test_regular_registry_invoke_keeps_its_original_payload_contract():
    registry = registry_with(MockDataAdapter(seed=1))
    end = datetime.now(timezone.utc).date()
    rows = await registry.invoke("NSE", "get_history", "TCS", "1d", end - timedelta(days=30), end)
    assert isinstance(rows, list) and rows and isinstance(rows[0], OHLCV)


@pytest.mark.parametrize("raw,expected", [
    ({"_source": "adapter:NSE"}, "unreported"),
    ({"_source": "adapter:NSE", "_quality": "live"}, "unreported"),
    ({"_source": "adapter:mock", "_adapter_name": "mock", "_quality": "live"}, "synthetic"),
    ({"_source": "adapter:yahoo", "_adapter_name": "yahoo", "_quality": "live"}, "unreported"),
    ({"_source": "yahoo"}, "delayed"),
])
def test_generic_exchange_label_does_not_prove_market_history(raw, expected):
    assert _history_provenance(raw, "research")["quality"] == expected
