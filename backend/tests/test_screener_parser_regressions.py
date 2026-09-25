from __future__ import annotations

from backend.screener.parser import parse_query


def test_parse_query_preserves_boolean_ops_with_multiword_fields() -> None:
    q = "Market Capitalization > 500 AND ROE > 15 AND Debt to equity < 0.5"
    parsed = parse_query(q)
    assert parsed.filter_expr == "market_cap > 500 and roe > 15 and debt_equity < 0.5"


def test_parse_query_rejects_pandas_query_code_injection() -> None:
    import pytest

    for q in (
        '@pd.io.common.os.system("echo pwned") == 0',
        "pe.__class__ == 1",
        "roe > 1 and pe.values.__len__() > 0",
    ):
        with pytest.raises(ValueError):
            parse_query(q)
    assert parse_query("abs(pe) > 1").filter_expr == "abs(pe) > 1"


def test_can_slim_missing_52w_distance_is_not_green() -> None:
    from backend.screener.models import can_slim

    assert can_slim.compute({})["letters"]["N"] == "red"
    assert can_slim.compute({"near_52w_high": 0})["letters"]["N"] == "green"
