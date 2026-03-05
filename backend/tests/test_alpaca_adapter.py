from __future__ import annotations

from datetime import date
from typing import Any

import pytest

from backend.adapters.alpaca import ALPACA_DATA_URL, AlpacaAdapter


@pytest.mark.asyncio
async def test_alpaca_adapter_get_history_parses_bars(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter = AlpacaAdapter(api_key="key", secret_key="secret", feed="iex")

    async def _fake_request_json(*, base_url: str, path: str, params: dict[str, Any] | None = None, max_attempts: int = 3):  # noqa: ARG001
        assert base_url == ALPACA_DATA_URL
        assert path == "/stocks/bars"
        return {
            "bars": {
                "AAPL": [
                    {"t": "2026-01-01T14:30:00Z", "o": 100, "h": 101, "l": 99.5, "c": 100.5, "v": 1200},
                    {"t": "2026-01-01T14:31:00Z", "o": 100.5, "h": 102, "l": 100.1, "c": 101.8, "v": 1500},
                ]
            }
        }

    monkeypatch.setattr(adapter, "_request_json", _fake_request_json)
    rows = await adapter.get_history("AAPL", "1m", date(2026, 1, 1), date(2026, 1, 2))
    assert len(rows) == 2
    assert rows[0].t < rows[1].t
    assert rows[0].o == 100.0
    assert rows[1].c == 101.8


@pytest.mark.asyncio
async def test_alpaca_adapter_missing_credentials_returns_empty() -> None:
    adapter = AlpacaAdapter(api_key="", secret_key="")
    assert await adapter.get_quote("AAPL") is None
    assert await adapter.get_history("AAPL", "1m", date(2026, 1, 1), date(2026, 1, 2)) == []
    assert await adapter.search_instruments("AAP") == []
    assert await adapter.supports_streaming() is False


@pytest.mark.asyncio
async def test_alpaca_request_json_retries_on_429(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Response:
        def __init__(self, status_code: int, payload: dict[str, Any]) -> None:
            self.status_code = status_code
            self._payload = payload

        def json(self) -> dict[str, Any]:
            return self._payload

    responses = [
        _Response(429, {}),
        _Response(429, {}),
        _Response(200, {"ok": True}),
    ]
    calls = {"count": 0}

    class _FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:  # noqa: ANN401
            pass

        async def __aenter__(self) -> "_FakeClient":
            return self

        async def __aexit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001, ANN201
            return False

        async def get(self, path: str, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None):  # noqa: ANN201, ARG002
            calls["count"] += 1
            return responses.pop(0)

    async def _fake_sleep(_: float) -> None:
        return None

    monkeypatch.setattr("backend.adapters.alpaca.httpx.AsyncClient", _FakeClient)
    monkeypatch.setattr("backend.adapters.alpaca.asyncio.sleep", _fake_sleep)

    adapter = AlpacaAdapter(api_key="key", secret_key="secret")
    payload = await adapter._request_json(base_url=ALPACA_DATA_URL, path="/stocks/bars", params={})
    assert payload == {"ok": True}
    assert calls["count"] == 3
