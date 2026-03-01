from __future__ import annotations

import re
import math
from dataclasses import dataclass
from typing import Any


_PERIOD_RE = re.compile(r"^\s*(\d+)\s*([dwmDWM])\s*$")


@dataclass(frozen=True)
class VolumeProfileResult:
    bins: list[dict[str, float]]
    poc_price: float | None
    value_area_high: float | None
    value_area_low: float | None
    total_volume: float
    bars_count: int


def parse_period_to_days(period: str) -> int:
    text = (period or "").strip()
    match = _PERIOD_RE.match(text)
    if not match:
        raise ValueError("period must match <int>[d|w|m], e.g. 5d, 2w, 1m")
    amount = int(match.group(1))
    unit = match.group(2).lower()
    if amount <= 0:
        raise ValueError("period must be greater than zero")

    if unit == "d":
        days = amount
    elif unit == "w":
        days = amount * 7
    else:
        days = amount * 30
    return max(1, min(365, days))


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
        if parsed != parsed:  # NaN check
            return default
        return parsed
    except Exception:
        return default


def _bar_bounds(bar: dict[str, Any]) -> tuple[float, float, float, float, float]:
    open_px = _safe_float(bar.get("open"))
    high_px = _safe_float(bar.get("high"), open_px)
    low_px = _safe_float(bar.get("low"), open_px)
    close_px = _safe_float(bar.get("close"), open_px)
    vol = max(0.0, _safe_float(bar.get("volume")))

    bar_low = min(open_px, high_px, low_px, close_px)
    bar_high = max(open_px, high_px, low_px, close_px)
    return open_px, close_px, bar_low, bar_high, vol


def _compute_value_area_indices(volumes: list[float], poc_idx: int, target_volume: float) -> tuple[int, int]:
    included = {poc_idx}
    cumulative = max(0.0, volumes[poc_idx])
    left = poc_idx - 1
    right = poc_idx + 1

    while cumulative < target_volume and (left >= 0 or right < len(volumes)):
        left_vol = volumes[left] if left >= 0 else -1.0
        right_vol = volumes[right] if right < len(volumes) else -1.0
        if right_vol > left_vol:
            included.add(right)
            cumulative += max(0.0, right_vol)
            right += 1
        else:
            included.add(left)
            cumulative += max(0.0, left_vol)
            left -= 1

    return min(included), max(included)


def compute_volume_profile(
    bars: list[dict[str, Any]],
    *,
    bins: int,
    value_area_ratio: float = 0.70,
) -> VolumeProfileResult:
    if bins < 1:
        raise ValueError("bins must be at least 1")

    normalized = [_bar_bounds(bar) for bar in bars]
    normalized = [item for item in normalized if item[4] > 0.0]

    if not normalized:
        empty_bins = [
            {
                "price_low": float(i),
                "price_high": float(i + 1),
                "volume": 0.0,
                "buy_volume": 0.0,
                "sell_volume": 0.0,
            }
            for i in range(bins)
        ]
        return VolumeProfileResult(
            bins=empty_bins,
            poc_price=None,
            value_area_high=None,
            value_area_low=None,
            total_volume=0.0,
            bars_count=0,
        )

    global_low = min(item[2] for item in normalized)
    global_high = max(item[3] for item in normalized)

    if global_high <= global_low:
        anchor = global_low
        epsilon = max(abs(anchor) * 1e-6, 1e-4)
        global_low = anchor - (epsilon / 2.0)
        global_high = anchor + (epsilon / 2.0)

    step = (global_high - global_low) / float(bins)
    if step <= 0:
        step = 1e-6

    profile = []
    for i in range(bins):
        p_low = global_low + (i * step)
        p_high = global_low + ((i + 1) * step)
        profile.append(
            {
                "price_low": p_low,
                "price_high": p_high,
                "volume": 0.0,
                "buy_volume": 0.0,
                "sell_volume": 0.0,
            }
        )

    for open_px, close_px, bar_low, bar_high, vol in normalized:
        if bar_high <= bar_low:
            idx = int((close_px - global_low) / step)
            idx = min(bins - 1, max(0, idx))
            bucket = profile[idx]
            bucket["volume"] += vol
            if close_px >= open_px:
                bucket["buy_volume"] += vol
            else:
                bucket["sell_volume"] += vol
            continue

        start_idx = int((bar_low - global_low) / step)
        end_idx = int((bar_high - global_low) / step)
        start_idx = min(bins - 1, max(0, start_idx))
        end_idx = min(bins - 1, max(0, end_idx))
        span = bar_high - bar_low
        if span <= 0:
            continue

        for i in range(start_idx, end_idx + 1):
            bin_low = profile[i]["price_low"]
            bin_high = profile[i]["price_high"]
            overlap = max(0.0, min(bin_high, bar_high) - max(bin_low, bar_low))
            if overlap <= 0:
                continue
            allocated = vol * (overlap / span)
            bucket = profile[i]
            bucket["volume"] += allocated
            if close_px >= open_px:
                bucket["buy_volume"] += allocated
            else:
                bucket["sell_volume"] += allocated

    volumes = [float(bucket["volume"]) for bucket in profile]
    total_volume = sum(volumes)

    if total_volume <= 0:
        return VolumeProfileResult(
            bins=profile,
            poc_price=None,
            value_area_high=None,
            value_area_low=None,
            total_volume=0.0,
            bars_count=len(normalized),
        )

    poc_idx = max(range(len(profile)), key=lambda i: volumes[i])
    poc_bin = profile[poc_idx]
    poc_price = (float(poc_bin["price_low"]) + float(poc_bin["price_high"])) / 2.0

    target_volume = total_volume * value_area_ratio
    val_idx, vah_idx = _compute_value_area_indices(volumes, poc_idx, target_volume)
    value_area_low = float(profile[val_idx]["price_low"])
    value_area_high = float(profile[vah_idx]["price_high"])

    return VolumeProfileResult(
        bins=profile,
        poc_price=poc_price,
        value_area_high=value_area_high,
        value_area_low=value_area_low,
        total_volume=total_volume,
        bars_count=len(normalized),
    )


def update_volume_profile_incremental(
    profile: VolumeProfileResult,
    *,
    price: float,
    volume_delta: float,
    is_buy: bool,
    value_area_ratio: float = 0.70,
) -> VolumeProfileResult:
    if not profile.bins:
        return profile
    if volume_delta <= 0 or not math.isfinite(volume_delta):
        return profile
    if not math.isfinite(price):
        return profile

    bins = [
        {
            "price_low": float(row.get("price_low", 0.0)),
            "price_high": float(row.get("price_high", 0.0)),
            "volume": float(row.get("volume", 0.0)),
            "buy_volume": float(row.get("buy_volume", 0.0)),
            "sell_volume": float(row.get("sell_volume", 0.0)),
        }
        for row in profile.bins
    ]
    bins.sort(key=lambda row: row["price_low"])

    target_idx = -1
    for idx, row in enumerate(bins):
        in_range = row["price_low"] <= price < row["price_high"]
        in_last = idx == len(bins) - 1 and row["price_low"] <= price <= row["price_high"]
        if in_range or in_last:
            target_idx = idx
            break
    if target_idx < 0:
        return profile

    target = bins[target_idx]
    target["volume"] += volume_delta
    if is_buy:
        target["buy_volume"] += volume_delta
    else:
        target["sell_volume"] += volume_delta

    volumes = [max(0.0, float(row["volume"])) for row in bins]
    total_volume = sum(volumes)
    if total_volume <= 0:
        return VolumeProfileResult(
            bins=bins,
            poc_price=None,
            value_area_high=None,
            value_area_low=None,
            total_volume=0.0,
            bars_count=profile.bars_count,
        )

    poc_idx = max(range(len(bins)), key=lambda i: volumes[i])
    target_volume = total_volume * value_area_ratio
    val_idx, vah_idx = _compute_value_area_indices(volumes, poc_idx, target_volume)
    poc_bin = bins[poc_idx]

    return VolumeProfileResult(
        bins=bins,
        poc_price=(float(poc_bin["price_low"]) + float(poc_bin["price_high"])) / 2.0,
        value_area_low=float(bins[val_idx]["price_low"]),
        value_area_high=float(bins[vah_idx]["price_high"]),
        total_volume=total_volume,
        bars_count=profile.bars_count,
    )
