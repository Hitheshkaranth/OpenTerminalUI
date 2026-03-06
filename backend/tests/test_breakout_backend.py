from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from backend.api.routes import breakouts
from backend.breakout_engine.detectors import detect_pattern, scan_patterns
from backend.services.breakout_builder_service import (
    BreakoutBuilderValidationError,
    BreakoutBuilderService,
)
from backend.services.breakout_occurrence_service import BreakoutOccurrenceService


def _candles_with_up_breakout() -> list[dict[str, float | str]]:
    rows: list[dict[str, float | str]] = []
    close = 100.0
    for i in range(24):
        high = close + 1.0
        low = close - 1.0
        rows.append(
            {
                "timestamp": f"2026-01-{i + 1:02d}T09:15:00Z",
                "open": close,
                "high": high,
                "low": low,
                "close": close,
                "volume": 1000.0,
            }
        )
        close += 0.15

    rows.append(
        {
            "timestamp": "2026-02-01T09:15:00Z",
            "open": 107.0,
            "high": 114.0,
            "low": 106.0,
            "close": 113.0,
            "volume": 2600.0,
        }
    )
    return rows


def _candles_flat() -> list[dict[str, float | str]]:
    return [
        {
            "timestamp": f"2026-01-{i + 1:02d}T09:15:00Z",
            "open": 100.0,
            "high": 100.0,
            "low": 100.0,
            "close": 100.0,
            "volume": 1000.0,
        }
        for i in range(30)
    ]


def test_detect_pattern_confidence_bounds_and_trigger() -> None:
    signal = detect_pattern(_candles_with_up_breakout(), "range_breakout_up", lookback=20, min_volume_ratio=1.2)
    assert signal["triggered"] is True
    assert signal["direction"] == "up"
    assert 0.0 <= signal["confidence"] <= 1.0
    assert signal["metadata"]["volume_ratio"] >= 1.2


def test_detect_pattern_edge_case_insufficient_bars() -> None:
    signal = detect_pattern(_candles_with_up_breakout()[:10], "range_breakout_up", lookback=20)
    assert signal["triggered"] is False
    assert signal["confidence"] == 0.0
    assert signal["metadata"]["reason"] == "insufficient_bars"


def test_scan_patterns_confidence_bounded_for_all_patterns() -> None:
    signals = scan_patterns(_candles_with_up_breakout(), ["range_breakout_up", "range_breakdown_down", "volume_spike_breakout"])
    assert len(signals) == 3
    for signal in signals:
        assert 0.0 <= float(signal["confidence"]) <= 1.0


def test_builder_validation_and_save_load() -> None:
    svc = BreakoutBuilderService()
    valid = svc.validate("close > resistance AND volume >= avg_volume*1.5")
    assert valid["valid"] is True
    saved = svc.save("Momentum", "close > resistance AND volume >= avg_volume*1.5")
    fetched = svc.get(saved["id"])
    listed = svc.list()
    assert fetched is not None
    assert fetched["dsl"] == "close > resistance AND volume >= avg_volume*1.5"
    assert listed and listed[0]["id"] == saved["id"]


def test_builder_validation_rejects_or() -> None:
    svc = BreakoutBuilderService()
    with pytest.raises(BreakoutBuilderValidationError):
        svc.validate("close > resistance OR volume > avg_volume")


@pytest.mark.asyncio
async def test_occurrence_tracker_uses_cache_and_is_deterministic(monkeypatch: pytest.MonkeyPatch) -> None:
    service = BreakoutOccurrenceService()
    candles = _candles_with_up_breakout()

    class _FakeCache:
        def __init__(self) -> None:
            self.store: dict[str, dict] = {}
            self.get_calls = 0
            self.set_calls = 0

        def build_key(self, data_type: str, symbol: str, params: dict) -> str:
            return f"{data_type}:{symbol}:{params['bars']}"

        async def get(self, key: str):
            self.get_calls += 1
            return self.store.get(key)

        async def set(self, key: str, value: dict, ttl: int = 300):
            self.set_calls += 1
            self.store[key] = dict(value)

    fake_cache = _FakeCache()
    monkeypatch.setattr("backend.services.breakout_occurrence_service.cache_instance", fake_cache)

    first = await service.track(symbol="TEST", candles=candles, pattern="range_breakout_up", lookback=20)
    second = await service.track(symbol="TEST", candles=candles, pattern="range_breakout_up", lookback=20)

    assert first["meta"]["cache_hit"] is False
    assert second["meta"]["cache_hit"] is True
    assert first["count"] == second["count"]
    assert fake_cache.set_calls == 1
    assert fake_cache.get_calls >= 2


def _build_client() -> TestClient:
    app = FastAPI()
    app.include_router(breakouts.router, prefix="/api")
    return TestClient(app)


def test_breakout_routes_detect_scan_builder_occurrence() -> None:
    client = _build_client()
    candles = _candles_with_up_breakout()

    detect = client.post(
        "/api/breakouts/detect",
        json={"symbol": "TEST", "candles": candles, "pattern": "range_breakout_up", "lookback": 20},
    )
    assert detect.status_code == 200
    assert detect.json()["signal"]["pattern"] == "range_breakout_up"

    scan = client.post(
        "/api/breakouts/scan",
        json={
            "items": [{"symbol": "TEST", "candles": candles}],
            "patterns": ["range_breakout_up", "volume_spike_breakout"],
            "lookback": 20,
            "min_confidence": 0.0,
        },
    )
    assert scan.status_code == 200
    scan_body = scan.json()
    assert scan_body["count"] == 1
    assert len(scan_body["rows"][0]["signals"]) == 2

    bad_validate = client.post("/api/breakouts/builder/validate", json={"dsl": "close > resistance OR volume > avg_volume"})
    assert bad_validate.status_code == 400

    save = client.post(
        "/api/breakouts/builder/save",
        json={"name": "Breakout+Volume", "dsl": "close > resistance AND volume >= avg_volume*1.2"},
    )
    assert save.status_code == 200
    builder_id = save.json()["id"]

    listing = client.get("/api/breakouts/builder")
    assert listing.status_code == 200
    assert any(item["id"] == builder_id for item in listing.json()["items"])

    evaluate = client.post(
        "/api/breakouts/builder/evaluate",
        json={
            "symbol": "TEST",
            "candles": candles,
            "dsl": "close > resistance AND volume >= avg_volume*1.2",
            "lookback": 20,
        },
    )
    assert evaluate.status_code == 200
    assert "result" in evaluate.json()

    occurrence = client.post(
        "/api/breakouts/occurrences",
        json={"symbol": "TEST", "candles": candles, "pattern": "range_breakout_up", "lookback": 20},
    )
    assert occurrence.status_code == 200
    occ_body = occurrence.json()
    assert occ_body["symbol"] == "TEST"
    assert occ_body["count"] >= 1


def test_flat_price_edge_case_no_breakout_trigger() -> None:
    signal = detect_pattern(_candles_flat(), "range_breakout_up", lookback=20, min_volume_ratio=1.2)
    assert signal["triggered"] is False
    assert 0.0 <= signal["confidence"] <= 1.0
