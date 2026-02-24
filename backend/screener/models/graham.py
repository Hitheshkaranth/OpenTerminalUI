from __future__ import annotations

from typing import Any

DESCRIPTION = "Graham defensive and net-net checks"
FIELDS_REQUIRED = ["current_assets", "total_liabilities", "current_ratio", "pe", "pb", "market_cap"]
VISUALIZATION_CONFIG = {"type": "checklist"}


def _num(row: dict[str, Any], key: str, default: float = 0.0) -> float:
    try:
        return float(row.get(key, default) or default)
    except (TypeError, ValueError):
        return default


def compute(financials: dict[str, Any], **_: Any) -> dict[str, Any]:
    ncav = _num(financials, "current_assets") - _num(financials, "total_liabilities")
    defensive_checks = {
        "size": _num(financials, "market_cap") > 1000,
        "liquidity": _num(financials, "current_ratio") > 2,
        "pe": _num(financials, "pe") < 15,
        "pb": _num(financials, "pb") < 1.5,
        "pe_pb": _num(financials, "pe") * _num(financials, "pb", 1.0) < 22.5,
    }
    return {
        "ncav": ncav,
        "defensive_pass": sum(1 for ok in defensive_checks.values() if ok),
        "defensive_total": len(defensive_checks),
        "checks": defensive_checks,
    }
