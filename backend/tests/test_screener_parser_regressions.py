from __future__ import annotations

from backend.screener.parser import parse_query


def test_parse_query_preserves_boolean_ops_with_multiword_fields() -> None:
    q = "Market Capitalization > 500 AND ROE > 15 AND Debt to equity < 0.5"
    parsed = parse_query(q)
    assert parsed.filter_expr == "market_cap > 500 and roe > 15 and debt_equity < 0.5"
