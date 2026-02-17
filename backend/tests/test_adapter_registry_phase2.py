from __future__ import annotations

from backend.adapters.registry import get_adapter_registry


def test_adapter_registry_resolves_known_exchanges() -> None:
    registry = get_adapter_registry()
    assert registry.get_adapter("NSE") is not None
    assert registry.get_adapter("NASDAQ") is not None
    assert registry.get_adapter("CRYPTO") is not None


def test_adapter_chain_has_fallback_for_nse() -> None:
    registry = get_adapter_registry()
    chain = registry.get_chain("NSE")
    assert len(chain) >= 1
