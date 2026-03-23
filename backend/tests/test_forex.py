from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes import forex as forex_routes
from backend.services.forex_service import ForexService, SUPPORTED_CURRENCIES

FIXED_NOW = datetime(2026, 3, 22, 12, 0, tzinfo=timezone.utc)


class _FakeCache:
    def __init__(self) -> None:
        self.data: dict[str, object] = {}
        self.get_calls = 0
        self.set_calls = 0

    def build_key(self, data_type: str, symbol: str, params: dict | None = None) -> str:
        serialized = json.dumps(params or {}, sort_keys=True)
        return f"{data_type}:{symbol}:{serialized}"

    async def get(self, key: str):
        self.get_calls += 1
        return self.data.get(key)

    async def set(self, key: str, value, ttl: int = 300):  # noqa: ANN001, ARG002
        self.set_calls += 1
        self.data[key] = value


class _FakeYahoo:
    def __init__(
        self,
        *,
        quotes_payload: list[dict] | None = None,
        chart_payloads: dict[str, dict | Exception] | None = None,
        raise_quotes: Exception | None = None,
    ) -> None:
        self._quotes_payload = quotes_payload or []
        self._chart_payloads = chart_payloads or {}
        self._raise_quotes = raise_quotes
        self.quote_calls = 0
        self.chart_calls: list[tuple[str, str, str]] = []

    async def get_quotes(self, symbols: list[str]):
        self.quote_calls += 1
        if self._raise_quotes is not None:
            raise self._raise_quotes
        wanted = {symbol.upper() for symbol in symbols}
        return [row for row in self._quotes_payload if str(row.get("symbol") or "").upper() in wanted]

    async def get_chart(self, symbol: str, range_str: str = "3mo", interval: str = "1d"):
        self.chart_calls.append((symbol, range_str, interval))
        payload = self._chart_payloads.get(symbol)
        if isinstance(payload, Exception):
            raise payload
        return payload or {"chart": {"result": []}}


class _FakeFinnhub:
    def __init__(
        self,
        *,
        rates_payload: dict | None = None,
        candle_payloads: dict[str, dict | Exception] | None = None,
    ) -> None:
        self._rates_payload = rates_payload or {}
        self._candle_payloads = candle_payloads or {}
        self.rate_calls = 0
        self.candle_calls: list[tuple[str, str, int, int]] = []

    async def get_forex_rates(self, base_currency: str):
        self.rate_calls += 1
        assert base_currency == "USD"
        return self._rates_payload

    async def get_forex_candles(self, symbol: str, resolution: str, from_ts: int, to_ts: int):
        self.candle_calls.append((symbol, resolution, from_ts, to_ts))
        payload = self._candle_payloads.get(symbol)
        if isinstance(payload, Exception):
            raise payload
        return payload or {"s": "no_data"}


def _yahoo_quote_payload() -> list[dict]:
    return [
        {"symbol": "EURUSD=X", "regularMarketPrice": 1.0850},
        {"symbol": "GBPUSD=X", "regularMarketPrice": 1.2740},
        {"symbol": "USDJPY=X", "regularMarketPrice": 151.3200},
        {"symbol": "USDCHF=X", "regularMarketPrice": 0.8844},
        {"symbol": "AUDUSD=X", "regularMarketPrice": 0.6620},
        {"symbol": "USDCAD=X", "regularMarketPrice": 1.3574},
        {"symbol": "USDINR=X", "regularMarketPrice": 83.1400},
    ]


def _yahoo_chart_payload(*, start_price: float, closes: list[float] | None = None) -> dict:
    close_series = closes or [start_price, start_price + 0.0020, start_price + 0.0040]
    open_series = [round(value - 0.0010, 6) for value in close_series]
    high_series = [round(value + 0.0015, 6) for value in close_series]
    low_series = [round(value - 0.0018, 6) for value in close_series]
    timestamps = [1711065600, 1711152000, 1711238400]
    return {
        "chart": {
            "result": [
                {
                    "timestamp": timestamps,
                    "indicators": {
                        "quote": [
                            {
                                "open": open_series,
                                "high": high_series,
                                "low": low_series,
                                "close": close_series,
                                "volume": [1000, 1100, 1200],
                            }
                        ]
                    },
                }
            ]
        }
    }


def _finnhub_candle_payload(*, close_series: list[float]) -> dict:
    return {
        "s": "ok",
        "t": [1711065600, 1711152000, 1711238400],
        "o": [round(value - 0.0009, 6) for value in close_series],
        "h": [round(value + 0.0014, 6) for value in close_series],
        "l": [round(value - 0.0016, 6) for value in close_series],
        "c": close_series,
        "v": [900, 950, 975],
    }


def _build_service(
    *,
    yahoo: _FakeYahoo | None = None,
    finnhub: _FakeFinnhub | None = None,
    cache: _FakeCache | None = None,
) -> ForexService:
    return ForexService(
        yahoo=yahoo,
        finnhub=finnhub,
        cache_backend=cache or _FakeCache(),
        now_factory=lambda: FIXED_NOW,
    )


def _build_app(service: ForexService) -> FastAPI:
    app = FastAPI()
    forex_routes.service = service
    app.include_router(forex_routes.router, prefix="/api")
    return app


def test_cross_rates_endpoint_returns_8x8_matrix_from_yahoo_quotes() -> None:
    cache = _FakeCache()
    yahoo = _FakeYahoo(quotes_payload=_yahoo_quote_payload())
    finnhub = _FakeFinnhub()
    client = TestClient(_build_app(_build_service(yahoo=yahoo, finnhub=finnhub, cache=cache)))

    response = client.get("/api/forex/cross-rates")

    assert response.status_code == 200
    body = response.json()
    assert body["currencies"] == SUPPORTED_CURRENCIES
    assert len(body["matrix"]) == 8
    assert all(len(row) == 8 for row in body["matrix"])
    eur_index = body["currencies"].index("EUR")
    usd_index = body["currencies"].index("USD")
    jpy_index = body["currencies"].index("JPY")
    assert body["matrix"][eur_index][usd_index] == 1.085
    assert body["matrix"][usd_index][jpy_index] == 151.32
    assert body["pair_quotes"]["EURUSD"]["symbol"] == "EURUSD=X"
    assert yahoo.quote_calls == 1
    assert finnhub.rate_calls == 0
    assert cache.set_calls == 2


def test_cross_rates_endpoint_uses_finnhub_fallback_when_yahoo_fails() -> None:
    yahoo = _FakeYahoo(raise_quotes=RuntimeError("429 Too Many Requests"))
    finnhub = _FakeFinnhub(
        rates_payload={
            "base": "USD",
            "quote": {
                "EUR": 0.92,
                "GBP": 0.785,
                "JPY": 151.0,
                "CHF": 0.885,
                "AUD": 1.51,
                "CAD": 1.36,
                "INR": 83.0,
            },
        }
    )
    client = TestClient(_build_app(_build_service(yahoo=yahoo, finnhub=finnhub, cache=_FakeCache())))

    response = client.get("/api/forex/cross-rates")

    assert response.status_code == 200
    body = response.json()
    eur_index = body["currencies"].index("EUR")
    usd_index = body["currencies"].index("USD")
    assert abs(body["matrix"][eur_index][usd_index] - (1 / 0.92)) < 1e-6
    assert finnhub.rate_calls == 1


def test_pair_chart_endpoint_returns_yahoo_ohlcv_and_normalizes_pair() -> None:
    yahoo = _FakeYahoo(
        quotes_payload=_yahoo_quote_payload(),
        chart_payloads={"EURUSD=X": _yahoo_chart_payload(start_price=1.0810)},
    )
    client = TestClient(_build_app(_build_service(yahoo=yahoo, finnhub=_FakeFinnhub(), cache=_FakeCache())))

    response = client.get("/api/forex/pairs/eur/usd?interval=1d&range=1mo")

    assert response.status_code == 200
    body = response.json()
    assert body["pair"] == "EURUSD"
    assert body["source_symbol"] == "EURUSD=X"
    assert body["interval"] == "1d"
    assert len(body["candles"]) == 3
    assert body["candles"][0]["o"] == 1.08
    assert body["current_rate"] == 1.085
    assert yahoo.chart_calls == [("EURUSD=X", "1mo", "1d")]


def test_pair_chart_endpoint_uses_finnhub_fallback_when_yahoo_has_no_chart() -> None:
    yahoo = _FakeYahoo(chart_payloads={"EURUSD=X": {"chart": {"result": []}}})
    finnhub = _FakeFinnhub(
        candle_payloads={"OANDA:EUR_USD": _finnhub_candle_payload(close_series=[1.082, 1.084, 1.086])}
    )
    client = TestClient(_build_app(_build_service(yahoo=yahoo, finnhub=finnhub, cache=_FakeCache())))

    response = client.get("/api/forex/pairs/EURUSD")

    assert response.status_code == 200
    body = response.json()
    assert body["pair"] == "EURUSD"
    assert body["source_symbol"] == "OANDA:EUR_USD"
    assert body["current_rate"] == 1.086
    assert len(body["candles"]) == 3
    assert finnhub.candle_calls


def test_pair_chart_endpoint_reuses_cache_on_repeated_requests() -> None:
    cache = _FakeCache()
    yahoo = _FakeYahoo(chart_payloads={"GBPUSD=X": _yahoo_chart_payload(start_price=1.2710, closes=[1.272, 1.273, 1.274])})
    client = TestClient(_build_app(_build_service(yahoo=yahoo, finnhub=_FakeFinnhub(), cache=cache)))

    first = client.get("/api/forex/pairs/GBPUSD")
    second = client.get("/api/forex/pairs/GBPUSD")

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["current_rate"] == second.json()["current_rate"] == 1.274
    assert len(yahoo.chart_calls) == 1
    assert cache.set_calls == 2


def test_pair_chart_endpoint_rejects_invalid_pair() -> None:
    client = TestClient(_build_app(_build_service(yahoo=_FakeYahoo(), finnhub=_FakeFinnhub(), cache=_FakeCache())))

    response = client.get("/api/forex/pairs/ABC")

    assert response.status_code == 400
    assert "6-letter FX symbol" in response.json()["detail"]


def test_central_banks_endpoint_returns_rate_decision_calendar() -> None:
    client = TestClient(_build_app(_build_service(yahoo=_FakeYahoo(), finnhub=_FakeFinnhub(), cache=_FakeCache())))

    response = client.get("/api/forex/central-banks")

    assert response.status_code == 200
    body = response.json()
    assert len(body["banks"]) == 8
    assert body["banks"][0]["bank"] == "Federal Reserve"
    assert body["banks"][0]["currency"] == "USD"
    assert body["banks"][0]["policy_rate"] == 5.25
    assert body["banks"][0]["days_since_last_decision"] == 32


def test_service_uses_stale_pair_cache_when_live_sources_fail() -> None:
    cache = _FakeCache()
    stale_key = cache.build_key("forex_pair_chart_stale", "EURUSD", {"interval": "1d", "range": "3mo"})
    cache.data[stale_key] = {
        "pair": "EURUSD",
        "source_symbol": "stale-cache",
        "base_currency": "EUR",
        "quote_currency": "USD",
        "interval": "1d",
        "market": "FX",
        "as_of": FIXED_NOW,
        "current_rate": 1.083,
        "candles": [{"t": 1711238400, "o": 1.08, "h": 1.084, "l": 1.079, "c": 1.083, "v": 0}],
    }
    service = _build_service(
        yahoo=_FakeYahoo(chart_payloads={"EURUSD=X": RuntimeError("yahoo unavailable")}),
        finnhub=_FakeFinnhub(),
        cache=cache,
    )

    payload = asyncio.run(service.get_pair_chart("EURUSD"))

    assert payload["source_symbol"] == "stale-cache"
    assert payload["current_rate"] == 1.083
