from __future__ import annotations

import ast
import re
from dataclasses import dataclass

from .fields import field_aliases, resolve_field_name


_ORDER_RE = re.compile(r"\bORDER\s+BY\s+([A-Za-z0-9_\s]+?)(?:\s+(ASC|DESC))?(?=\s+LIMIT\b|$)", re.IGNORECASE)
_LIMIT_RE = re.compile(r"\bLIMIT\s+(\d+)\b", re.IGNORECASE)


@dataclass
class ParsedQuery:
    """
    Structure representing a parsed scanner query, split into filters, sorting, and limits.

    Attributes:
        raw (str): The original raw query input text.
        normalized (str): The normalized and parsed Python-evaluable filter expression.
        filter_expr (str): Identical to normalized, representing the filter expression.
        sort_by (str | None): Canonical column name to sort by, or None if not specified.
        sort_order (str): 'asc' or 'desc'. Defaults to 'desc'.
        limit (int | None): The maximum number of results to return, or None if not specified.
    """
    raw: str
    normalized: str
    filter_expr: str
    sort_by: str | None
    sort_order: str
    limit: int | None


def _strip_comments(query: str) -> str:
    """
    Removes comments starting with '//' from the query text.
    """
    lines = []
    for line in query.splitlines():
        clean = line.strip()
        if clean.startswith("//"):
            continue
        lines.append(line)
    return "\n".join(lines)


def _strip_time_qualifiers(query: str) -> str:
    """
    Strips timeframe qualifiers formatted as [timeframe] (e.g., [1d], [15m]) from fields.
    """
    return re.sub(r"\[[^\]]+\]", "", query)


def _replace_between(expr: str) -> str:
    """
    Converts SQL-like 'BETWEEN lower AND upper' expressions to explicit compound comparisons.

    Example:
        'price BETWEEN 100 AND 200' -> '(price >= 100 and price <= 200)'
    """
    pattern = re.compile(
        r"\b([A-Za-z_][A-Za-z0-9_]*)\s+BETWEEN\s+([^\s\)]+)\s+AND\s+([^\s\)]+)",
        re.IGNORECASE,
    )

    def _repl(match: re.Match[str]) -> str:
        field, lower, upper = match.group(1), match.group(2), match.group(3)
        return f"({field} >= {lower} and {field} <= {upper})"

    prev = expr
    while True:
        updated = pattern.sub(_repl, prev)
        if updated == prev:
            return updated
        prev = updated


def _normalize_ops(expr: str) -> str:
    """
    Translates standard comparison/logical operators to standard Python operators.

    Converts '<>' to '!=', single '=' to '==', and 'AND', 'OR', 'NOT' to lowercase.
    """
    expr = expr.replace("<>", "!=")
    expr = re.sub(r"(?<![<>=!])=(?!=)", "==", expr)
    expr = re.sub(r"\bAND\b", "and", expr, flags=re.IGNORECASE)
    expr = re.sub(r"\bOR\b", "or", expr, flags=re.IGNORECASE)
    expr = re.sub(r"\bNOT\b", "not", expr, flags=re.IGNORECASE)
    return expr


def _map_fields(expr: str) -> str:
    """
    Resolves human-readable labels/aliases to canonical database or DataFrame column names.

    Uses a two-pass approach:
    1. Direct exact alias match from field_aliases().
    2. Fuzzy fallback matching for remaining unmapped terms near operators.
    """
    aliases = sorted(field_aliases().keys(), key=len, reverse=True)
    updated = expr
    for alias in aliases:
        canonical = field_aliases()[alias]
        escaped = re.escape(alias)
        updated = re.sub(rf"(?<![A-Za-z0-9_]){escaped}(?![A-Za-z0-9_])", canonical, updated, flags=re.IGNORECASE)

    # Secondary fuzzy pass for bare names near comparators.
    comparator_pattern = re.compile(r"\b([A-Za-z][A-Za-z0-9_\s]{1,40})\s*(<=|>=|!=|==|=|<|>|\bIN\b)", re.IGNORECASE)

    def _fuzzy(match: re.Match[str]) -> str:
        raw_field = " ".join(match.group(1).split())
        # Avoid rewriting across boolean operators. The alias pass above already
        # handles known multi-word labels; this fuzzy pass should be conservative.
        if re.search(r"\b(and|or|not)\b", raw_field, flags=re.IGNORECASE):
            return match.group(0)
        canonical = resolve_field_name(raw_field)
        if canonical is None:
            return match.group(0)
        return f"{canonical} {match.group(2)}"

    return comparator_pattern.sub(_fuzzy, updated)


_UNSAFE_NODES = (ast.Attribute, ast.Subscript, ast.Lambda, ast.Starred, ast.NamedExpr)


def _validate_expr(expr: str) -> None:
    """
    Rejects filter expressions that could escape pandas.query's evaluator.

    The filter is later run through ``DataFrame.query(engine="python")`` which
    resolves ``@name`` against the caller's scope and allows attribute access, so
    user input like ``@pd.io.common.os.system(...)`` would execute arbitrary code.
    Only plain column names, literals, comparisons, arithmetic and bare function
    calls (pandas restricts these to its math functions) are allowed.
    """
    if not expr.strip():
        return
    if "@" in expr or "`" in expr:
        raise ValueError("Invalid screener expression: '@' and backtick references are not allowed")
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as exc:
        raise ValueError(f"Invalid screener expression: {exc.msg}") from exc
    for node in ast.walk(tree):
        if isinstance(node, _UNSAFE_NODES):
            raise ValueError(f"Invalid screener expression: {type(node).__name__} is not allowed")
        if isinstance(node, ast.Call) and not isinstance(node.func, ast.Name):
            raise ValueError("Invalid screener expression: only plain function calls are allowed")
        if isinstance(node, ast.Name) and node.id.startswith("__"):
            raise ValueError(f"Invalid screener expression: {node.id} is not allowed")


def parse_query(query: str) -> ParsedQuery:
    """
    Parses a scanner query string containing filter expressions, sorting, and limits.

    Processes comments, timeframe qualifiers, alias mapping, SQL-to-python operators,
    extracts the ORDER BY field/order, and extracts the LIMIT quantity.

    Args:
        query (str): The raw text query string.

    Returns:
        ParsedQuery: The structured ParsedQuery object containing resolved filters, sort, and limits.
    """
    clean = _strip_time_qualifiers(_strip_comments(query or "")).strip()
    sort_by: str | None = None
    sort_order = "desc"
    limit: int | None = None

    order_match = _ORDER_RE.search(clean)
    if order_match:
        sort_raw = order_match.group(1).strip()
        resolved = resolve_field_name(sort_raw) or sort_raw.strip().lower().replace(" ", "_")
        sort_by = resolved
        if order_match.group(2):
            sort_order = order_match.group(2).lower()
        clean = (clean[: order_match.start()] + clean[order_match.end() :]).strip()

    limit_match = _LIMIT_RE.search(clean)
    if limit_match:
        limit = int(limit_match.group(1))
        clean = (clean[: limit_match.start()] + clean[limit_match.end() :]).strip()

    mapped = _map_fields(clean)
    mapped = _replace_between(mapped)
    mapped = _normalize_ops(mapped)
    _validate_expr(mapped)

    return ParsedQuery(
        raw=query,
        normalized=mapped,
        filter_expr=mapped,
        sort_by=sort_by,
        sort_order=sort_order,
        limit=limit,
    )
