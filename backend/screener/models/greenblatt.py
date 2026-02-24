from __future__ import annotations

from typing import Any

DESCRIPTION = "Greenblatt Magic Formula rank"
FIELDS_REQUIRED = ["earnings_yield", "return_on_capital"]
VISUALIZATION_CONFIG = {"type": "scatter", "x": "earnings_yield", "y": "return_on_capital"}


def _num(row: dict[str, Any], key: str) -> float:
    try:
        return float(row.get(key) or 0.0)
    except (TypeError, ValueError):
        return 0.0


def compute(financials: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
    ey = _num(financials, "earnings_yield")
    roc = _num(financials, "return_on_capital")
    ey_rank = kwargs.get("ey_rank")
    roc_rank = kwargs.get("roc_rank")
    combined = None
    if ey_rank is not None and roc_rank is not None:
        combined = int(ey_rank) + int(roc_rank)
    return {
        "earnings_yield": ey,
        "return_on_capital": roc,
        "ey_rank": ey_rank,
        "roc_rank": roc_rank,
        "combined_rank": combined,
    }
