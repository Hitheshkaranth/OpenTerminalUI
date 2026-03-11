from __future__ import annotations

import asyncio

from backend.api import deps


class _FakeFetcher:
    async def fetch_stock_snapshot(self, symbol: str):
        return {
            "ticker": symbol,
            "company_name": "Tesla, Inc.",
            "exchange": "NASDAQ",
            "country_code": "US",
        }


def test_fetch_stock_snapshot_coalesced_refreshes_cached_rows_missing_company_name(monkeypatch) -> None:
    calls: list[tuple[str, object]] = []

    def _fake_build_key(data_type: str, symbol: str, params: dict):
        return f"{data_type}:{symbol}"

    async def _fake_cache_get(_key: str):
        return {
            "ticker": "TSLA",
            "company_name": None,
            "exchange": "NASDAQ",
            "country_code": "US",
        }

    async def _fake_cache_set(key: str, value, ttl: int):
        calls.append((key, value))

    async def _fake_get_fetcher():
        return _FakeFetcher()

    monkeypatch.setattr(deps.cache_instance, "build_key", _fake_build_key)
    monkeypatch.setattr(deps.cache_instance, "get", _fake_cache_get)
    monkeypatch.setattr(deps.cache_instance, "set", _fake_cache_set)
    monkeypatch.setattr(deps, "get_unified_fetcher", _fake_get_fetcher)
    monkeypatch.setattr(deps, "ttl_seconds", lambda *_args, **_kwargs: 60)
    monkeypatch.setattr(deps, "market_open_now", lambda: True)

    payload = asyncio.run(deps.fetch_stock_snapshot_coalesced("TSLA"))

    assert payload["company_name"] == "Tesla, Inc."
    assert calls
    assert calls[0][0] == "snapshot:TSLA"
