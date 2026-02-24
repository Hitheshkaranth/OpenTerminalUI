from __future__ import annotations

from typing import Any

DESCRIPTION = "Piotroski 9-point fundamental strength score"
FIELDS_REQUIRED = [
    "net_income",
    "operating_cash_flow",
    "roa",
    "roa_prev",
    "lt_debt_ratio",
    "lt_debt_ratio_prev",
    "current_ratio",
    "current_ratio_prev",
    "shares_outstanding",
    "shares_outstanding_prev",
    "gross_margin",
    "gross_margin_prev",
    "asset_turnover",
    "asset_turnover_prev",
]
VISUALIZATION_CONFIG = {"type": "scorecard_grid", "components": 9}


def _num(row: dict[str, Any], key: str, default: float = 0.0) -> float:
    value = row.get(key, default)
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def compute(financials: dict[str, Any], **_: Any) -> dict[str, Any]:
    checks = [
        _num(financials, "net_income") > 0,
        _num(financials, "operating_cash_flow") > 0,
        _num(financials, "roa") > _num(financials, "roa_prev"),
        _num(financials, "operating_cash_flow") > _num(financials, "net_income"),
        _num(financials, "lt_debt_ratio") < _num(financials, "lt_debt_ratio_prev", 1e9),
        _num(financials, "current_ratio") > _num(financials, "current_ratio_prev"),
        _num(financials, "shares_outstanding") <= _num(financials, "shares_outstanding_prev", _num(financials, "shares_outstanding")),
        _num(financials, "gross_margin") > _num(financials, "gross_margin_prev"),
        _num(financials, "asset_turnover") > _num(financials, "asset_turnover_prev"),
    ]
    score = int(sum(1 for item in checks if item))
    return {
        "value": score,
        "max": 9,
        "components": [1 if item else 0 for item in checks],
    }
