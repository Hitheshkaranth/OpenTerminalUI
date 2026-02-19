from __future__ import annotations

from backend.alerts.service import AlertEvaluatorService


def test_custom_expression_allows_simple_comparison() -> None:
    ok = AlertEvaluatorService._eval_custom("ltp > 100 and change_pct > 0", {"ltp": 101, "change_pct": 1.2, "volume": 50})
    assert ok is True


def test_custom_expression_blocks_function_calls() -> None:
    ok = AlertEvaluatorService._eval_custom("__import__('os').system('echo hi')", {"ltp": 101, "change_pct": 1.2, "volume": 50})
    assert ok is False


def test_custom_expression_blocks_unknown_names() -> None:
    ok = AlertEvaluatorService._eval_custom("secret > 0", {"ltp": 101, "change_pct": 1.2, "volume": 50})
    assert ok is False
