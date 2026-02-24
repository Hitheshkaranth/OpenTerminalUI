from __future__ import annotations

from typing import Any

DESCRIPTION = "Dividend consistency and sustainability score"
FIELDS_REQUIRED = ["dividend_yield", "payout_ratio", "fcf", "dividends_paid", "debt_equity"]
VISUALIZATION_CONFIG = {"type": "donut", "field": "payout_ratio"}


def _num(row: dict[str, Any], key: str) -> float:
    try:
        return float(row.get(key) or 0.0)
    except (TypeError, ValueError):
        return 0.0


def compute(financials: dict[str, Any], **_: Any) -> dict[str, Any]:
    yield_pct = _num(financials, "dividend_yield")
    payout = _num(financials, "payout_ratio")
    fcf = _num(financials, "fcf")
    dividends = _num(financials, "dividends_paid")
    score = 0
    score += 30 if yield_pct > 2 else 0
    score += 25 if 20 <= payout <= 80 else 0
    score += 25 if fcf > dividends else 0
    score += 20 if _num(financials, "debt_equity") < 1 else 0
    return {"value": score, "max": 100, "payout_ratio": payout}
