from __future__ import annotations

import pytest

from backend.services.volume_profile_service import (
    compute_volume_profile,
    parse_period_to_days,
    update_volume_profile_incremental,
)


def test_compute_volume_profile_distributes_volume_and_value_area_deterministically() -> None:
    bars = [
        {"open": 100.0, "high": 102.0, "low": 100.0, "close": 102.0, "volume": 100.0},
        {"open": 102.0, "high": 103.0, "low": 101.0, "close": 101.0, "volume": 50.0},
    ]

    result = compute_volume_profile(bars, bins=4)

    assert len(result.bins) == 4
    assert result.total_volume == pytest.approx(150.0, abs=1e-6)
    assert result.poc_price == pytest.approx(101.125, abs=1e-6)
    assert result.value_area_low == pytest.approx(100.0, abs=1e-6)
    assert result.value_area_high == pytest.approx(102.25, abs=1e-6)
    assert result.bars_count == 2
    assert result.bins[1]["buy_volume"] == pytest.approx(37.5, abs=1e-6)
    assert result.bins[1]["sell_volume"] == pytest.approx(12.5, abs=1e-6)


def test_compute_volume_profile_handles_flat_price_range() -> None:
    bars = [
        {"open": 250.0, "high": 250.0, "low": 250.0, "close": 250.0, "volume": 30.0},
        {"open": 250.0, "high": 250.0, "low": 250.0, "close": 250.0, "volume": 20.0},
    ]

    result = compute_volume_profile(bars, bins=3)

    assert len(result.bins) == 3
    assert result.total_volume == pytest.approx(50.0, abs=1e-9)
    assert result.poc_price is not None
    assert result.value_area_low is not None
    assert result.value_area_high is not None
    assert result.value_area_low <= result.poc_price <= result.value_area_high


def test_parse_period_to_days_valid_and_invalid() -> None:
    assert parse_period_to_days("5d") == 5
    assert parse_period_to_days("2w") == 14
    assert parse_period_to_days("1m") == 30

    with pytest.raises(ValueError):
        parse_period_to_days("abc")
    with pytest.raises(ValueError):
        parse_period_to_days("0d")


def test_update_volume_profile_incremental_updates_bin_and_recomputes_value_area() -> None:
    bars = [
        {"open": 100.0, "high": 102.0, "low": 100.0, "close": 102.0, "volume": 100.0},
        {"open": 102.0, "high": 103.0, "low": 101.0, "close": 101.0, "volume": 50.0},
    ]
    profile = compute_volume_profile(bars, bins=4)

    updated = update_volume_profile_incremental(profile, price=101.2, volume_delta=25.0, is_buy=True)

    assert updated.total_volume == pytest.approx(profile.total_volume + 25.0, abs=1e-6)
    assert updated.bars_count == profile.bars_count
    assert updated.poc_price == pytest.approx(101.125, abs=1e-6)
    assert updated.value_area_low == pytest.approx(100.0, abs=1e-6)
    assert updated.value_area_high == pytest.approx(102.25, abs=1e-6)
    assert updated.bins[1]["volume"] == pytest.approx(profile.bins[1]["volume"] + 25.0, abs=1e-6)
    assert updated.bins[1]["buy_volume"] == pytest.approx(profile.bins[1]["buy_volume"] + 25.0, abs=1e-6)
    assert updated.bins[1]["sell_volume"] == pytest.approx(profile.bins[1]["sell_volume"], abs=1e-6)


def test_update_volume_profile_incremental_ignores_invalid_or_out_of_range_ticks() -> None:
    profile = compute_volume_profile(
        [{"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5, "volume": 10.0}],
        bins=5,
    )

    unchanged_1 = update_volume_profile_incremental(profile, price=500.0, volume_delta=5.0, is_buy=False)
    unchanged_2 = update_volume_profile_incremental(profile, price=100.0, volume_delta=0.0, is_buy=True)

    assert unchanged_1 == profile
    assert unchanged_2 == profile
