from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.deps import get_chart_provider
from backend.api.routes.patterns import router as patterns_router
from backend.providers.chart_data import OHLCVBar
from backend.services.pattern_recognition_service import PatternRecognitionService


def _linspace(start: float, end: float, count: int) -> list[float]:
    if count <= 1:
        return [float(end)]
    step = (end - start) / float(count - 1)
    return [start + step * idx for idx in range(count)]


def _make_ohlcv(closes: list[float], start: datetime | None = None) -> list[dict[str, float | str]]:
    base = start or datetime(2026, 1, 1, tzinfo=timezone.utc)
    rows: list[dict[str, float | str]] = []
    prev = closes[0]
    for idx, close in enumerate(closes):
        open_px = prev
        high = max(open_px, close) + 0.8
        low = min(open_px, close) - 0.8
        rows.append(
            {
                "date": (base + timedelta(days=idx)).date().isoformat(),
                "open": float(open_px),
                "high": float(high),
                "low": float(low),
                "close": float(close),
                "volume": float(1000 + idx * 5),
            }
        )
        prev = close
    return rows


def _fixture_head_shoulders() -> list[dict[str, float | str]]:
    closes = (
        _linspace(100, 112, 14)
        + _linspace(112, 121, 6)
        + _linspace(121, 111, 6)
        + _linspace(111, 128, 7)
        + _linspace(128, 112, 7)
        + _linspace(112, 121, 6)
        + _linspace(121, 106, 12)
    )
    return _make_ohlcv(closes)


def _fixture_double_top() -> list[dict[str, float | str]]:
    closes = (
        _linspace(90, 104, 10)
        + _linspace(104, 118, 8)
        + _linspace(118, 104, 8)
        + _linspace(104, 119, 8)
        + _linspace(119, 100, 14)
    )
    return _make_ohlcv(closes)


def _fixture_ascending_triangle() -> list[dict[str, float | str]]:
    closes = (
        _linspace(102, 114, 8)
        + _linspace(114, 119, 4)
        + _linspace(119, 110, 5)
        + _linspace(110, 120, 5)
        + _linspace(120, 112, 5)
        + _linspace(112, 119.5, 5)
        + _linspace(119.5, 114, 5)
        + _linspace(114, 121, 8)
    )
    return _make_ohlcv(closes)


def _fixture_bull_flag() -> list[dict[str, float | str]]:
    closes = (
        _linspace(100, 122, 11)  # pole
        + _linspace(121.5, 116, 9)  # flag drift down
        + _linspace(116, 119, 6)
    )
    return _make_ohlcv(closes)


def _fixture_cup_handle() -> list[dict[str, float | str]]:
    closes = (
        _linspace(95, 118, 16)
        + _linspace(118, 88, 18)
        + _linspace(88, 116, 18)
        + _linspace(116, 109, 7)  # handle
        + _linspace(109, 114, 8)
    )
    return _make_ohlcv(closes)


def _fixture_no_pattern() -> list[dict[str, float | str]]:
    closes = [100.0]
    for idx in range(1, 100):
        delta = ((idx % 5) - 2) * 0.08
        closes.append(closes[-1] + delta)
    return _make_ohlcv(closes)


def test_detect_head_shoulders() -> None:
    service = PatternRecognitionService()
    patterns = service.detect_patterns(_fixture_head_shoulders(), min_confidence=0.5)
    hs = [p for p in patterns if p.pattern_type == "head_shoulders"]
    assert hs
    assert len(hs[0].anchor_points) == 5


def test_detect_double_top() -> None:
    service = PatternRecognitionService()
    patterns = service.detect_patterns(_fixture_double_top(), min_confidence=0.5)
    dt = [p for p in patterns if p.pattern_type == "double_top"]
    assert dt
    peaks = [a for a in dt[0].anchor_points if "peak" in str(a.get("type"))]
    assert len(peaks) == 2
    assert abs(float(peaks[0]["price"]) - float(peaks[1]["price"])) / max(float(peaks[0]["price"]), 1e-9) <= 0.015


def test_detect_ascending_triangle() -> None:
    service = PatternRecognitionService()
    patterns = service.detect_patterns(_fixture_ascending_triangle(), min_confidence=0.5)
    tri = [p for p in patterns if p.pattern_type == "ascending_triangle"]
    assert tri
    roles = {line.get("role") for line in tri[0].trendlines}
    assert "resistance" in roles
    assert "support" in roles


def test_detect_bull_flag() -> None:
    service = PatternRecognitionService()
    patterns = service.detect_patterns(_fixture_bull_flag(), min_confidence=0.5)
    flags = [p for p in patterns if p.pattern_type == "bull_flag"]
    assert flags
    assert flags[0].direction == "bullish"


def test_detect_cup_handle() -> None:
    service = PatternRecognitionService()
    patterns = service.detect_patterns(_fixture_cup_handle(), min_confidence=0.5)
    cups = [p for p in patterns if p.pattern_type == "cup_handle"]
    assert cups
    assert cups[0].direction == "bullish"


def test_no_false_positives() -> None:
    service = PatternRecognitionService()
    patterns = service.detect_patterns(_fixture_no_pattern(), min_confidence=0.6)
    assert patterns == []


def test_confidence_threshold() -> None:
    service = PatternRecognitionService()
    patterns = service.detect_patterns(_fixture_double_top(), min_confidence=0.999)
    assert patterns == []


def test_pivot_detection() -> None:
    service = PatternRecognitionService()
    fixture = _make_ohlcv([100, 101, 103, 106, 103, 101, 99, 101, 104, 102, 100])
    highs, lows = service.detect_pivots(fixture, window=2)
    assert any(int(row["bar_index"]) in {3, 4} for row in highs)
    assert any(int(row["bar_index"]) in {6, 7} for row in lows)


def test_endpoint_response_schema() -> None:
    fixture = _fixture_head_shoulders()

    class _Provider:
        async def get_ohlcv(self, *args, **kwargs):  # noqa: ANN002, ANN003
            start = datetime(2026, 1, 1, tzinfo=timezone.utc)
            bars: list[OHLCVBar] = []
            for idx, row in enumerate(fixture):
                bars.append(
                    OHLCVBar(
                        timestamp=start + timedelta(days=idx),
                        open=float(row["open"]),
                        high=float(row["high"]),
                        low=float(row["low"]),
                        close=float(row["close"]),
                        volume=float(row["volume"]),
                        symbol="RELIANCE",
                        market="IN",
                    )
                )
            return bars

    app = FastAPI()
    app.include_router(patterns_router)
    app.dependency_overrides[get_chart_provider] = lambda: _Provider()

    client = TestClient(app)
    response = client.get("/api/charts/RELIANCE/patterns?timeframe=1D&min_confidence=0.6&lookback=120")
    assert response.status_code == 200
    payload = response.json()
    assert payload["symbol"] == "RELIANCE"
    assert payload["timeframe"] == "1D"
    assert isinstance(payload["patterns"], list)
    if payload["patterns"]:
        first = payload["patterns"][0]
        assert "pattern_type" in first
        assert "direction" in first
        assert "confidence" in first
        assert "anchor_points" in first
