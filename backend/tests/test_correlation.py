from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.deps import get_unified_fetcher
from backend.api.routes import correlation as correlation_routes
from backend.auth.deps import get_current_user


class _DummyUser:
    id = "test-user"
    email = "test@example.com"
    role = "trader"


class _FakeFetcher:
    async def fetch_history(self, ticker: str, range_str: str = "1y", interval: str = "1d") -> dict[str, Any]:  # noqa: ARG002
        base = {
            "RELIANCE": [100, 102, 104, 103, 105, 108, 110, 111, 113, 116],
            "TCS": [200, 203, 206, 205, 209, 214, 217, 220, 224, 229],
            "HDFCBANK": [300, 301, 299, 302, 300, 304, 303, 306, 305, 307],
            "ICICIBANK": [150, 149, 151, 152, 150, 149, 151, 153, 152, 154],
        }
        closes = base[ticker]
        timestamps = [
            int((datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(days=index)).timestamp())
            for index in range(len(closes))
        ]
        return {
            "chart": {
                "result": [
                    {
                        "timestamp": timestamps,
                        "indicators": {
                            "quote": [
                                {
                                    "open": closes,
                                    "high": closes,
                                    "low": closes,
                                    "close": closes,
                                    "volume": [1_000_000] * len(closes),
                                }
                            ]
                        },
                    }
                ]
            }
        }


def _build_client() -> TestClient:
    app = FastAPI()
    app.include_router(correlation_routes.router)
    app.dependency_overrides[get_current_user] = lambda: _DummyUser()
    async def _override_fetcher() -> _FakeFetcher:
        return _FakeFetcher()
    app.dependency_overrides[get_unified_fetcher] = _override_fetcher
    correlation_routes.get_unified_fetcher = _override_fetcher
    return TestClient(app)


def test_correlation_matrix_returns_symmetric_values() -> None:
    client = _build_client()

    response = client.post(
        "/api/correlation/matrix",
        json={"symbols": ["RELIANCE", "TCS", "HDFCBANK"], "period": "1Y", "frequency": "daily"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["symbols"] == ["RELIANCE", "TCS", "HDFCBANK"]
    matrix = payload["matrix"]
    assert len(matrix) == 3
    assert all(len(row) == 3 for row in matrix)
    for row_index, row in enumerate(matrix):
        for col_index, value in enumerate(row):
            assert -1.0 <= value <= 1.0
            assert value == matrix[col_index][row_index]
            if row_index == col_index:
                assert value == 1.0


def test_correlation_rolling_returns_series_and_valid_regimes() -> None:
    client = _build_client()

    response = client.post(
        "/api/correlation/rolling",
        json={"symbol1": "RELIANCE", "symbol2": "TCS", "window": 5, "period": "3Y"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["series"]
    assert {"current", "avg", "min", "max", "regimes"} <= set(payload)
    assert payload["min"] <= payload["current"] <= payload["max"]
    assert all("date" in point and "correlation" in point for point in payload["series"])
    assert all(regime["label"] in {"high", "medium", "low"} for regime in payload["regimes"])


def test_correlation_clusters_returns_assignments_and_tree() -> None:
    client = _build_client()

    response = client.post(
        "/api/correlation/clusters",
        json={"symbols": ["RELIANCE", "TCS", "HDFCBANK", "ICICIBANK"], "period": "1Y", "n_clusters": 2},
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["clusters"]) == 2
    flattened = sorted(symbol for cluster in payload["clusters"] for symbol in cluster["symbols"])
    assert flattened == ["HDFCBANK", "ICICIBANK", "RELIANCE", "TCS"]
    assert "children" in payload["dendrogram"]
    assert isinstance(payload["dendrogram"]["children"], list)
