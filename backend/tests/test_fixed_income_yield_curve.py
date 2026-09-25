from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from backend.services import fixed_income_service as fis


class _FakeCache:
    def __init__(self) -> None:
        self.data: dict = {}

    def build_key(self, data_type: str, symbol: str, params: dict | None = None) -> str:
        return f"{data_type}:{symbol}:{sorted((params or {}).items())}"

    async def get(self, key: str):
        return self.data.get(key)

    async def set(self, key: str, value, ttl: int = 300):  # noqa: ANN001, ARG002
        self.data[key] = value


def _service(monkeypatch, quotes=None, fail=False) -> fis.FixedIncomeService:
    class _Yahoo:
        async def get_quotes(self, symbols):  # noqa: ARG002
            if fail:
                raise RuntimeError("yahoo down")
            return quotes or []

    class _Fetcher:
        yahoo = _Yahoo()

    async def _fake_fetcher():
        return _Fetcher()

    monkeypatch.setattr("backend.api.deps.get_unified_fetcher", _fake_fetcher)
    monkeypatch.setattr(fis, "cache", _FakeCache())
    svc = fis.FixedIncomeService()
    svc.api_key = None
    return svc


def test_no_fred_key_uses_live_yahoo_treasury_yields(monkeypatch) -> None:
    ts = int(datetime(2026, 9, 24, 20, 0, tzinfo=timezone.utc).timestamp())
    quotes = [
        {"symbol": "^IRX", "regularMarketPrice": 3.9, "regularMarketChange": -0.02, "regularMarketTime": ts},
        {"symbol": "^FVX", "regularMarketPrice": 3.7, "regularMarketTime": ts},
        {"symbol": "^TNX", "regularMarketPrice": 4.1, "regularMarketTime": ts},
        {"symbol": "^TYX", "regularMarketPrice": 4.7, "regularMarketTime": ts},
    ]
    out = asyncio.run(_service(monkeypatch, quotes=quotes).get_yield_curve())

    assert not out.get("mock")
    assert out["source"] == "yahoo"
    assert out["date"] == "2026-09-24"
    assert [p["label"] for p in out["data"]] == ["3M", "5Y", "10Y", "30Y"]
    assert out["data"][0]["yield"] == 3.9
    assert abs(out["spreads"]["3m10y"] - 0.2) < 1e-9


def test_no_fred_key_and_no_yahoo_returns_flagged_mock_without_todays_date(monkeypatch) -> None:
    out = asyncio.run(_service(monkeypatch, fail=True).get_yield_curve())

    assert out["mock"] is True
    assert out["date"] is None
    assert all(p["date"] is None for p in out["data"])
