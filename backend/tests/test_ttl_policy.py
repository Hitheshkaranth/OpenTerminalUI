from __future__ import annotations

from backend.core.ttl_policy import ttl_seconds


def test_ttl_policy_snapshot_stable() -> None:
    assert ttl_seconds("snapshot", market_open=True) == 60
    assert ttl_seconds("snapshot", market_open=False) == 60


def test_ttl_policy_news_latest_open_vs_closed() -> None:
    assert ttl_seconds("news_latest", market_open=True) == 180
    assert ttl_seconds("news_latest", market_open=False) == 600


def test_ttl_policy_default_fallback() -> None:
    assert ttl_seconds("unknown_data_type", market_open=True) == 300
    assert ttl_seconds("unknown_data_type", market_open=False) == 900
