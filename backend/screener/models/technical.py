from __future__ import annotations

from typing import Any

DESCRIPTION = "Technical momentum and trend composite"
FIELDS_REQUIRED = ["price", "sma_50", "sma_150", "sma_200", "rsi", "volume", "avg_volume_20", "delivery_pct", "high_52w", "low_52w"]
VISUALIZATION_CONFIG = {"type": "candlestick"}


def _num(row: dict[str, Any], key: str) -> float:
    try:
        return float(row.get(key) or 0.0)
    except (TypeError, ValueError):
        return 0.0


def compute(financials: dict[str, Any], **_: Any) -> dict[str, Any]:
    price = _num(financials, "price")
    sma50 = _num(financials, "sma_50")
    sma150 = _num(financials, "sma_150")
    sma200 = _num(financials, "sma_200")
    rs = _num(financials, "rs_rating")
    rsi = _num(financials, "rsi")
    vol = _num(financials, "volume")
    avg_vol = max(_num(financials, "avg_volume_20"), 1.0)
    score = 0
    score += 20 if price > sma50 else 0
    score += 20 if price > sma150 else 0
    score += 20 if price > sma200 else 0
    score += 20 if rs > 70 else 0
    score += 10 if 50 <= rsi <= 75 else 0
    score += 10 if vol > 1.5 * avg_vol else 0
    return {"value": score, "max": 100, "signals": {"price": price, "rsi": rsi, "rs_rating": rs}}
