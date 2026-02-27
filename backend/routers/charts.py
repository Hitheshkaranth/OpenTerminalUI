from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from typing import Any, Optional
from backend.services.extended_hours_service import get_extended_hours_service, ExtendedHoursService

router = APIRouter(prefix="/api/charts", tags=["charts"])


def _period_to_days(period: str) -> int:
    value = (period or "20d").strip().lower()
    if value.endswith("d") and value[:-1].isdigit():
        return max(1, min(180, int(value[:-1])))
    if value.endswith("w") and value[:-1].isdigit():
        return max(1, min(180, int(value[:-1]) * 7))
    if value.endswith("m") and value[:-1].isdigit():
        return max(1, min(365, int(value[:-1]) * 30))
    return 20


def _compute_value_area(bounds: list[dict[str, Any]], poc_idx: int, target_volume: float) -> tuple[float, float]:
    included = {poc_idx}
    cum = float(bounds[poc_idx]["volume"])
    left = poc_idx - 1
    right = poc_idx + 1

    while cum < target_volume and (left >= 0 or right < len(bounds)):
        lv = float(bounds[left]["volume"]) if left >= 0 else -1.0
        rv = float(bounds[right]["volume"]) if right < len(bounds) else -1.0
        if rv > lv:
            included.add(right)
            cum += max(0.0, rv)
            right += 1
        else:
            included.add(left)
            cum += max(0.0, lv)
            left -= 1

    low_idx = min(included)
    high_idx = max(included)
    return float(bounds[low_idx]["price_low"]), float(bounds[high_idx]["price_high"])

@router.get("/{ticker}")
async def get_chart_data(
    ticker: str,
    timeframe: str = "1D",
    extended: bool = False,
    session_filter: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    market: str = "IN",
    service: ExtendedHoursService = Depends(get_extended_hours_service),
):
    """
    Returns OHLCV chart data with optional extended hours.
    """
    bars = await service.get_chart_data(
        symbol=ticker,
        timeframe=timeframe,
        market=market,
        extended=extended,
        date_from=date_from,
        date_to=date_to,
    )

    if session_filter and session_filter != "all":
        sessions = session_filter.split(",")
        bars = [b for b in bars if b.get("session") in sessions]

    return {
        "ticker": ticker,
        "timeframe": timeframe,
        "market": market,
        "extended": extended,
        "bars": bars,
        "sessionMeta": {
            "hasPreMarket": any(b.get("session") in ["pre", "pre_open"] for b in bars),
            "hasAfterHours": any(b.get("session") in ["post", "closing"] for b in bars),
            "preMarketBars": sum(1 for b in bars if b.get("session") in ["pre", "pre_open"]),
            "afterHoursBars": sum(1 for b in bars if b.get("session") in ["post", "closing"]),
        }
    }


@router.get("/volume-profile/{symbol}")
async def get_volume_profile(
    symbol: str,
    period: str = Query(default="20d"),
    bins: int = Query(default=50, ge=10, le=200),
    market: str = Query(default="NSE"),
    service: ExtendedHoursService = Depends(get_extended_hours_service),
):
    """
    Compute volume-at-price profile from 1m bars.
    """
    days = _period_to_days(period)
    bars = await service.get_chart_data(
        symbol=symbol,
        timeframe="1m",
        market=market,
        extended=True,
    )
    if not bars:
        return {
            "symbol": symbol.upper(),
            "period": period,
            "bins": [],
            "poc_price": None,
            "value_area_high": None,
            "value_area_low": None,
        }

    max_points = days * 24 * 60
    sample = bars[-max_points:] if len(bars) > max_points else bars
    prices = [float(b.get("close", 0.0)) for b in sample if b.get("close") is not None]
    if not prices:
        return {
            "symbol": symbol.upper(),
            "period": period,
            "bins": [],
            "poc_price": None,
            "value_area_high": None,
            "value_area_low": None,
        }

    lo = min(prices)
    hi = max(prices)
    if hi <= lo:
        hi = lo + 1e-6
    step = (hi - lo) / bins
    step = step if step > 0 else 1e-6

    profile: list[dict[str, Any]] = []
    for i in range(bins):
        p_low = lo + i * step
        p_high = lo + (i + 1) * step
        profile.append(
            {
                "price_low": p_low,
                "price_high": p_high,
                "volume": 0.0,
                "buy_volume": 0.0,
                "sell_volume": 0.0,
            }
        )

    for bar in sample:
        close = float(bar.get("close", 0.0))
        open_px = float(bar.get("open", close))
        vol = float(bar.get("volume", 0.0))
        idx = int((close - lo) / step)
        if idx < 0:
            idx = 0
        if idx >= bins:
            idx = bins - 1
        bucket = profile[idx]
        bucket["volume"] += vol
        if close >= open_px:
            bucket["buy_volume"] += vol
        else:
            bucket["sell_volume"] += vol

    total_volume = sum(float(b["volume"]) for b in profile)
    if total_volume <= 0:
        poc_idx = 0
        poc_price = None
        vah = None
        val = None
    else:
        poc_idx = max(range(len(profile)), key=lambda i: float(profile[i]["volume"]))
        poc_bin = profile[poc_idx]
        poc_price = (float(poc_bin["price_low"]) + float(poc_bin["price_high"])) / 2.0
        val, vah = _compute_value_area(profile, poc_idx, total_volume * 0.70)

    return {
        "symbol": symbol.upper(),
        "period": period,
        "bins": profile,
        "poc_price": poc_price,
        "value_area_high": vah,
        "value_area_low": val,
    }
