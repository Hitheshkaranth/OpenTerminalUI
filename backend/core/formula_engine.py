from __future__ import annotations

import ast
import math
from typing import Any


ALLOWED_FIELDS: tuple[str, ...] = (
    "pe",
    "pb",
    "ps",
    "ev_ebitda",
    "roe",
    "roa",
    "roce",
    "debt_equity",
    "current_ratio",
    "revenue_growth",
    "eps_growth",
    "net_profit_growth",
    "dividend_yield",
    "market_cap",
    "price",
    "volume",
    "turnover",
    "net_profit_margin",
    "operating_margin",
    "ebitda_margin",
    "free_cash_flow",
    "promoter_holding",
    "fii_holding",
    "dii_holding",
    "high_52w",
    "low_52w",
    "beta",
    "book_value",
    "face_value",
)

ALLOWED_FUNCTIONS: dict[str, Any] = {
    "abs": abs,
    "min": min,
    "max": max,
    "round": round,
    "sqrt": math.sqrt,
}

FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "pe": ("pe", "pe_ratio"),
    "pb": ("pb", "pb_calc", "pb_ratio"),
    "ps": ("ps", "ps_calc", "ps_ratio"),
    "ev_ebitda": ("ev_ebitda",),
    "roe": ("roe", "roe_pct"),
    "roa": ("roa", "roa_pct"),
    "roce": ("roce",),
    "debt_equity": ("debt_equity", "debt_to_equity"),
    "current_ratio": ("current_ratio",),
    "revenue_growth": ("revenue_growth", "rev_growth_pct", "revenue_growth_yoy"),
    "eps_growth": ("eps_growth", "eps_growth_pct", "earnings_growth_yoy"),
    "net_profit_growth": ("net_profit_growth", "net_profit_growth_pct"),
    "dividend_yield": ("dividend_yield", "div_yield_pct"),
    "market_cap": ("market_cap", "mcap"),
    "price": ("price", "current_price"),
    "volume": ("volume", "avg_volume_10d", "avg_volume"),
    "turnover": ("turnover",),
    "net_profit_margin": ("net_profit_margin", "net_margin_pct"),
    "operating_margin": ("operating_margin", "op_margin_pct", "operating_margin_pct"),
    "ebitda_margin": ("ebitda_margin", "ebitda_margin_pct"),
    "free_cash_flow": ("free_cash_flow", "fcf"),
    "promoter_holding": ("promoter_holding",),
    "fii_holding": ("fii_holding", "fii_holding_change_qoq"),
    "dii_holding": ("dii_holding", "dii_holding_change_qoq"),
    "high_52w": ("high_52w", "fifty_two_week_high"),
    "low_52w": ("low_52w", "fifty_two_week_low"),
    "beta": ("beta",),
    "book_value": ("book_value",),
    "face_value": ("face_value",),
}

_ALLOWED_BIN_OPS = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod)
_ALLOWED_UNARY_OPS = (ast.USub, ast.UAdd)
_ALLOWED_COMPARE_OPS = (ast.Gt, ast.GtE, ast.Lt, ast.LtE, ast.Eq, ast.NotEq)
_ALLOWED_BOOL_OPS = (ast.And, ast.Or)


def _as_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number):
        return None
    return number


def _resolve_name(name: str, data: dict[str, Any]) -> Any:
    aliases = FIELD_ALIASES.get(name, (name,))
    for key in aliases:
        if key in data:
            return data[key]
    return None


class _FormulaValidator(ast.NodeVisitor):
    def __init__(self, *, allow_filters: bool = False) -> None:
        self.allow_filters = allow_filters

    def generic_visit(self, node: ast.AST) -> None:
        allowed = (
            ast.Expression,
            ast.Load,
            ast.BinOp,
            ast.UnaryOp,
            ast.Call,
            ast.Name,
            ast.Constant,
        )
        if self.allow_filters:
            allowed = allowed + (ast.Compare, ast.BoolOp,)
        if not isinstance(node, allowed):
            raise ValueError(f"Unsupported expression element: {type(node).__name__}")
        super().generic_visit(node)

    def visit_BinOp(self, node: ast.BinOp) -> None:
        if not isinstance(node.op, _ALLOWED_BIN_OPS):
            raise ValueError("Only +, -, *, /, ** and % operators are allowed")
        self.visit(node.left)
        self.visit(node.right)

    def visit_UnaryOp(self, node: ast.UnaryOp) -> None:
        if not isinstance(node.op, _ALLOWED_UNARY_OPS):
            raise ValueError("Only unary + and - are allowed")
        self.visit(node.operand)

    def visit_Call(self, node: ast.Call) -> None:
        if not isinstance(node.func, ast.Name):
            raise ValueError("Only direct function calls are allowed")
        if node.func.id not in ALLOWED_FUNCTIONS:
            raise ValueError(f"Function '{node.func.id}' is not allowed")
        if node.keywords:
            raise ValueError("Keyword arguments are not allowed")
        for arg in node.args:
            self.visit(arg)

    def visit_Name(self, node: ast.Name) -> None:
        if node.id not in ALLOWED_FIELDS:
            raise ValueError(f"Unknown field '{node.id}'")

    def visit_Constant(self, node: ast.Constant) -> None:
        if isinstance(node.value, bool):
            raise ValueError("Boolean literals are not allowed")
        if not isinstance(node.value, (int, float, str)):
            raise ValueError("Only numeric and string literals are allowed")

    def visit_Compare(self, node: ast.Compare) -> None:
        if not self.allow_filters:
            raise ValueError("Comparison operators are not allowed in formulas")
        if len(node.ops) != 1 or len(node.comparators) != 1:
            raise ValueError("Only simple comparisons are allowed")
        if not isinstance(node.ops[0], _ALLOWED_COMPARE_OPS):
            raise ValueError("Unsupported comparison operator")
        self.visit(node.left)
        self.visit(node.comparators[0])

    def visit_BoolOp(self, node: ast.BoolOp) -> None:
        if not self.allow_filters:
            raise ValueError("Boolean operators are not allowed in formulas")
        if not isinstance(node.op, _ALLOWED_BOOL_OPS):
            raise ValueError("Unsupported boolean operator")
        for value in node.values:
            self.visit(value)


def _parse(formula: str, *, allow_filters: bool = False) -> ast.Expression:
    expr = (formula or "").strip()
    if not expr:
        raise ValueError("Formula is required")
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as exc:
        raise ValueError(f"Invalid formula syntax: {exc.msg}") from exc
    _FormulaValidator(allow_filters=allow_filters).visit(tree)
    return tree


def _eval_numeric(node: ast.AST, data: dict[str, Any]) -> float:
    if isinstance(node, ast.Expression):
        return _eval_numeric(node.body, data)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            return float(node.value)
        raise ValueError("Only numeric literals are allowed in formulas")
    if isinstance(node, ast.Name):
        value = _resolve_name(node.id, data)
        number = _as_float(value)
        if number is None:
            raise ValueError(f"Field '{node.id}' is missing or non-numeric")
        return number
    if isinstance(node, ast.UnaryOp):
        operand = _eval_numeric(node.operand, data)
        return operand if isinstance(node.op, ast.UAdd) else -operand
    if isinstance(node, ast.BinOp):
        left = _eval_numeric(node.left, data)
        right = _eval_numeric(node.right, data)
        try:
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                return left / right
            if isinstance(node.op, ast.Pow):
                return left**right
            if isinstance(node.op, ast.Mod):
                return left % right
        except ZeroDivisionError:
            return float("nan")
        raise ValueError("Unsupported binary operator")
    if isinstance(node, ast.Call):
        func = ALLOWED_FUNCTIONS[node.func.id]
        args = [_eval_numeric(arg, data) for arg in node.args]
        try:
            result = func(*args)
        except ZeroDivisionError:
            return float("nan")
        except ValueError:
            return float("nan")
        return float(result)
    raise ValueError(f"Unsupported expression element: {type(node).__name__}")


def _eval_filter_value(node: ast.AST, data: dict[str, Any]) -> Any:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return _eval_numeric(node, data)


def _eval_filter(node: ast.AST, data: dict[str, Any]) -> bool:
    if isinstance(node, ast.Expression):
        return _eval_filter(node.body, data)
    if isinstance(node, ast.BoolOp):
        if isinstance(node.op, ast.And):
            return all(_eval_filter(value, data) for value in node.values)
        return any(_eval_filter(value, data) for value in node.values)
    if isinstance(node, ast.Compare):
        left = _eval_filter_value(node.left, data)
        right = _eval_filter_value(node.comparators[0], data)
        op = node.ops[0]
        if isinstance(op, ast.Gt):
            return bool(left > right)
        if isinstance(op, ast.GtE):
            return bool(left >= right)
        if isinstance(op, ast.Lt):
            return bool(left < right)
        if isinstance(op, ast.LtE):
            return bool(left <= right)
        if isinstance(op, ast.Eq):
            return bool(left == right)
        if isinstance(op, ast.NotEq):
            return bool(left != right)
    raise ValueError("Unsupported filter expression")


def validate(formula: str) -> tuple[bool, str]:
    try:
        _parse(formula)
        return True, ""
    except ValueError as exc:
        return False, str(exc)


def evaluate(formula: str, data: dict[str, Any]) -> float:
    tree = _parse(formula)
    return _eval_numeric(tree, data)


def validate_filter(filter_expr: str) -> tuple[bool, str]:
    try:
        _parse(filter_expr, allow_filters=True)
        return True, ""
    except ValueError as exc:
        return False, str(exc)


def evaluate_filter(filter_expr: str, data: dict[str, Any]) -> bool:
    tree = _parse(filter_expr, allow_filters=True)
    return _eval_filter(tree, data)
