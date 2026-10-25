"""Translate supported screen-result conditions into the existing tick alert engine."""
from __future__ import annotations
import math


def validate_criteria(criteria, frequency="on_match") -> dict:
    if frequency != "on_match":
        raise ValueError("Only on_match delivery is supported. Scheduled fundamental-screen evaluation is unavailable.")
    if not isinstance(criteria, dict):
        raise ValueError("Use {symbols: [exchange-qualified symbols], conditions: [{field, operator, value}], logic: AND|OR}. Fundamental query expressions are not supported by the tick alert engine.")
    if set(criteria) - {"symbols", "conditions", "logic"}:
        raise ValueError("Unsupported screen alert configuration fields")
    symbols = criteria.get("symbols")
    conditions = criteria.get("conditions")
    if not isinstance(symbols, list) or not 1 <= len(symbols) <= 100:
        raise ValueError("Provide between one and 100 explicit screen-result symbols")
    if any(not isinstance(s, str) or ":" not in s or not s.strip() or len(s) > 64 for s in symbols):
        raise ValueError("Symbols must include their exchange, for example NSE:TCS")
    logic = criteria.get("logic", "AND")
    if logic not in {"AND", "OR"}:
        raise ValueError("logic must be AND or OR")
    supported = {"price": {"above", "below", "cross_above", "cross_below"},
                 "change_pct": {"above", "below"}, "volume": {"above"},
                 "oi_change": {"above", "below"}, "iv": {"above", "below"}}
    if not isinstance(conditions, list) or not 1 <= len(conditions) <= 10:
        raise ValueError("Provide between one and ten supported conditions")
    clean = []
    for condition in conditions:
        if not isinstance(condition, dict) or set(condition) != {"field", "operator", "value"}:
            raise ValueError("Each condition must contain field, operator and value")
        field, operator = condition["field"], condition["operator"]
        if field not in supported or operator not in supported[field]:
            raise ValueError(f"Unsupported alert condition: {field} {operator}")
        try:
            value = float(condition["value"])
        except (TypeError, ValueError):
            raise ValueError("Condition value must be finite")
        if not math.isfinite(value):
            raise ValueError("Condition value must be finite")
        clean.append({"field": field, "operator": operator, "value": value})
    return {"symbols": list(dict.fromkeys(s.strip().upper() for s in symbols)), "conditions": clean, "logic": logic}
