from __future__ import annotations

from typing import Any

DESCRIPTION = "Quality-Value-Momentum composite"
FIELDS_REQUIRED = ["roe", "roce", "fcf_yield", "pe", "pb", "earnings_yield", "price_1y_return", "rs_rating"]
VISUALIZATION_CONFIG = {"type": "scatter", "x": "quality", "y": "value", "z": "momentum"}


def _num(row: dict[str, Any], key: str) -> float:
    try:
        return float(row.get(key) or 0.0)
    except (TypeError, ValueError):
        return 0.0


def compute(financials: dict[str, Any], **_: Any) -> dict[str, Any]:
    quality = (_num(financials, "roe") + _num(financials, "roce") + _num(financials, "fcf_yield")) / 3.0
    value = (_num(financials, "earnings_yield") + max(0.0, 20 - _num(financials, "pe")) + max(0.0, 3 - _num(financials, "pb"))) / 3.0
    momentum = (_num(financials, "price_1y_return") + _num(financials, "rs_rating")) / 2.0
    combined = 0.4 * quality + 0.3 * value + 0.3 * momentum
    return {
        "quality": round(quality, 2),
        "value_score": round(value, 2),
        "momentum": round(momentum, 2),
        "value": round(combined, 2),
    }
