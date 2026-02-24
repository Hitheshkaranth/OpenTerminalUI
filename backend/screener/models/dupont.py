from __future__ import annotations

from typing import Any

DESCRIPTION = "DuPont ROE decomposition"
FIELDS_REQUIRED = ["net_margin", "asset_turnover", "equity_multiplier"]
VISUALIZATION_CONFIG = {"type": "waterfall", "components": ["net_margin", "asset_turnover", "equity_multiplier"]}


def _num(row: dict[str, Any], key: str) -> float:
    try:
        return float(row.get(key) or 0.0)
    except (TypeError, ValueError):
        return 0.0


def compute(financials: dict[str, Any], **_: Any) -> dict[str, Any]:
    margin = _num(financials, "net_margin")
    turnover = _num(financials, "asset_turnover")
    leverage = _num(financials, "equity_multiplier")
    roe = margin * turnover * leverage
    return {"margin": margin, "turnover": turnover, "leverage": leverage, "value": roe}
