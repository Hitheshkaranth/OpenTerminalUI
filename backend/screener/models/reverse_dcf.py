from __future__ import annotations

from typing import Any

DESCRIPTION = "Reverse DCF implied growth"
FIELDS_REQUIRED = ["market_cap", "fcf", "revenue_growth"]
VISUALIZATION_CONFIG = {"type": "heatmap", "x": "discount_rate", "y": "terminal_growth"}


def _num(row: dict[str, Any], key: str) -> float:
    try:
        return float(row.get(key) or 0.0)
    except (TypeError, ValueError):
        return 0.0


def compute(financials: dict[str, Any], **_: Any) -> dict[str, Any]:
    market_cap = max(_num(financials, "market_cap"), 1.0)
    fcf = max(_num(financials, "fcf"), 1.0)
    implied_growth = min(max((market_cap / fcf) / 10.0, 0.0), 100.0)
    actual_growth = _num(financials, "revenue_growth")
    return {
        "implied_growth": round(implied_growth, 2),
        "actual_growth": round(actual_growth, 2),
        "gap": round(actual_growth - implied_growth, 2),
        "value": round(implied_growth, 2),
    }
