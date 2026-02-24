from __future__ import annotations

from typing import Any

DESCRIPTION = "CAN SLIM signal grading"
FIELDS_REQUIRED = ["eps_growth_qoq", "annual_eps_growth", "near_52w_high", "volume_surge", "rs_rating", "institutional_holding_change", "market_uptrend"]
VISUALIZATION_CONFIG = {"type": "scorecard_grid", "components": 7}


def _num(row: dict[str, Any], key: str) -> float:
    try:
        return float(row.get(key) or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _grade(ok: bool) -> str:
    return "green" if ok else "red"


def compute(financials: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
    market_uptrend = bool(kwargs.get("market_uptrend", financials.get("market_uptrend", True)))
    letters = {
        "C": _grade(_num(financials, "eps_growth_qoq") > 25),
        "A": _grade(_num(financials, "annual_eps_growth") > 25),
        "N": _grade(_num(financials, "near_52w_high") <= 15),
        "S": _grade(_num(financials, "volume_surge") > 50),
        "L": _grade(_num(financials, "rs_rating") > 80),
        "I": _grade(_num(financials, "institutional_holding_change") > 0),
        "M": _grade(market_uptrend),
    }
    score = sum(1 for v in letters.values() if v == "green")
    overall = "green" if score >= 6 else "yellow" if score >= 4 else "red"
    return {"letters": letters, "value": score, "max": 7, "overall": overall}
