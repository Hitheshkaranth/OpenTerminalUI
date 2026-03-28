from __future__ import annotations

from datetime import date

import pytest

from backend.adapters.alpaca import AlpacaAdapter
from backend.adapters.base import DataAdapter, QuoteResponse
from backend.adapters.yahoo import YahooFinanceAdapter
from backend.adapters.registry import AdapterRegistry, get_adapter_registry


def test_adapter_registry_resolves_known_exchanges() -> None:
    registry = get_adapter_registry()
    assert registry.get_adapter("NSE") is not None
    assert registry.get_adapter("NASDAQ") is not None
    assert registry.get_adapter("CRYPTO") is not None


def test_adapter_chain_has_fallback_for_nse() -> None:
    registry = get_adapter_registry()
    chain = registry.get_chain("NSE")
    assert len(chain) >= 1


def test_adapter_chain_uses_alpaca_then_yahoo_for_us() -> None:
    registry = get_adapter_registry()
    chain = registry.get_chain("NASDAQ")
    assert len(chain) >= 2
    assert isinstance(chain[0], AlpacaAdapter)
    assert isinstance(chain[1], YahooFinanceAdapter)


def test_adapter_health_snapshot_includes_configured_adapters_before_use() -> None:
    registry = AdapterRegistry()
    health = registry.health_snapshot()

    assert "kite" in health
    assert "yahoo" in health
    assert health["kite"]["available"] is True
    assert health["kite"]["failures"] == 0


class _FailingAdapter(DataAdapter):
    async def get_quote(self, symbol: str) -> QuoteResponse | None:
        raise RuntimeError("primary down")

    async def get_history(self, symbol: str, timeframe: str, start: date, end: date):
        raise RuntimeError("primary down")

    async def search_instruments(self, query: str):
        raise RuntimeError("primary down")

    async def get_fundamentals(self, symbol: str):
        return {}

    async def supports_streaming(self) -> bool:
        return False

    async def get_option_chain(self, underlying: str, expiry: date):
        return None

    async def get_futures_chain(self, underlying: str):
        return []


class _HealthyAdapter(DataAdapter):
    async def get_quote(self, symbol: str) -> QuoteResponse | None:
        return QuoteResponse(symbol=symbol, price=101.0)

    async def get_history(self, symbol: str, timeframe: str, start: date, end: date):
        return []

    async def search_instruments(self, query: str):
        return []

    async def get_fundamentals(self, symbol: str):
        return {}

    async def supports_streaming(self) -> bool:
        return False

    async def get_option_chain(self, underlying: str, expiry: date):
        return None

    async def get_futures_chain(self, underlying: str):
        return []


@pytest.mark.asyncio
async def test_adapter_registry_invoke_falls_back_and_tracks_health() -> None:
    registry = AdapterRegistry(failure_threshold=1, cooldown_seconds=60)
    registry._factory = {  # noqa: SLF001
        "kite": lambda: _FailingAdapter(),
        "yahoo": lambda: _HealthyAdapter(),
    }
    registry._config = {  # noqa: SLF001
        "default": {"primary": "kite", "fallback": ["yahoo"]},
        "exchanges": {"NSE": {"primary": "kite", "fallback": ["yahoo"]}},
    }

    quote = await registry.invoke("NSE", "get_quote", "RELIANCE")

    assert quote is not None
    assert quote.symbol == "RELIANCE"
    health = registry.health_snapshot()
    assert health["kite"]["available"] is False
    assert health["kite"]["last_error"] == "primary down"
    assert health["yahoo"]["available"] is True
