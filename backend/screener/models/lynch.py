from __future__ import annotations

from typing import Any

DESCRIPTION = "Peter Lynch GARP / PEG analysis"
FIELDS_REQUIRED = ["peg", "eps_growth", "pe", "debt_equity", "revenue_growth"]
VISUALIZATION_CONFIG = {"type": "scatter", "x": "peg", "y": "pe"}


def _num(row: dict[str, Any], key: str) -> float:
    try:
        return float(row.get(key) or 0.0)
    except (TypeError, ValueError):
        return 0.0


def compute(financials: dict[str, Any], **_: Any) -> dict[str, Any]:
    peg = _num(financials, "peg")
    score = 0
    score += 25 if peg > 0 and peg < 1 else 0
    score += 20 if _num(financials, "eps_growth") > 15 else 0
    score += 20 if _num(financials, "pe") < 25 else 0
    score += 15 if _num(financials, "debt_equity") < 0.8 else 0
    score += 20 if _num(financials, "revenue_growth") > 10 else 0
    return {"value": score, "max": 100, "peg": peg}
