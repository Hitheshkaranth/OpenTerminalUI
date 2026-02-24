from __future__ import annotations

from typing import Any

DESCRIPTION = "Altman Z-Score bankruptcy predictor"
FIELDS_REQUIRED = ["working_capital", "total_assets", "retained_earnings", "ebit", "market_cap", "total_liabilities", "sales"]
VISUALIZATION_CONFIG = {"type": "gauge", "zones": [1.81, 2.99]}


def _num(row: dict[str, Any], key: str, default: float = 0.0) -> float:
    try:
        return float(row.get(key, default) or default)
    except (TypeError, ValueError):
        return default


def compute(financials: dict[str, Any], **_: Any) -> dict[str, Any]:
    total_assets = _num(financials, "total_assets", 1.0)
    total_liabilities = max(_num(financials, "total_liabilities", 1.0), 1e-9)

    components = {
        "wc_ta": 1.2 * (_num(financials, "working_capital") / total_assets),
        "re_ta": 1.4 * (_num(financials, "retained_earnings") / total_assets),
        "ebit_ta": 3.3 * (_num(financials, "ebit") / total_assets),
        "mcap_tl": 0.6 * (_num(financials, "market_cap") / total_liabilities),
        "sales_ta": 1.0 * (_num(financials, "sales") / total_assets),
    }
    score = sum(components.values())
    zone = "safe" if score > 2.99 else "distress" if score < 1.81 else "grey"
    return {"value": round(score, 3), "zone": zone, "components": components}
