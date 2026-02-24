from __future__ import annotations

from typing import Any

DESCRIPTION = "Buffett quality moat composite score"
FIELDS_REQUIRED = ["roe", "roce", "debt_equity", "revenue_growth", "opm", "fcf", "market_cap"]
VISUALIZATION_CONFIG = {"type": "radar", "axes": ["roe", "roce", "opm", "fcf_yield", "debt_equity_inv", "revenue_growth"]}


def _num(row: dict[str, Any], key: str) -> float:
    try:
        return float(row.get(key) or 0.0)
    except (TypeError, ValueError):
        return 0.0


def compute(financials: dict[str, Any], **_: Any) -> dict[str, Any]:
    criteria = {
        "roe": _num(financials, "roe") > 15,
        "roce": _num(financials, "roce") > 12,
        "debt": _num(financials, "debt_equity") < 0.5,
        "growth": _num(financials, "revenue_growth") > 8,
        "margin": _num(financials, "opm") > 15,
        "fcf": _num(financials, "fcf") > 0,
        "mcap": _num(financials, "market_cap") > 500,
    }
    weighted = {
        "roe": 18,
        "roce": 16,
        "debt": 14,
        "growth": 14,
        "margin": 14,
        "fcf": 12,
        "mcap": 12,
    }
    score = sum(weighted[k] for k, ok in criteria.items() if ok)
    return {"value": score, "max": 100, "criteria": criteria}
