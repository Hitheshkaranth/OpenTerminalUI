from __future__ import annotations

import re
from dataclasses import dataclass

from .fields import field_aliases, resolve_field_name


_ORDER_RE = re.compile(r"\bORDER\s+BY\s+([A-Za-z0-9_\s]+?)(?:\s+(ASC|DESC))?(?=\s+LIMIT\b|$)", re.IGNORECASE)
_LIMIT_RE = re.compile(r"\bLIMIT\s+(\d+)\b", re.IGNORECASE)


@dataclass
class ParsedQuery:
    raw: str
    normalized: str
    filter_expr: str
    sort_by: str | None
    sort_order: str
    limit: int | None


def _strip_comments(query: str) -> str:
    lines = []
    for line in query.splitlines():
        clean = line.strip()
        if clean.startswith("//"):
            continue
        lines.append(line)
    return "\n".join(lines)


def _strip_time_qualifiers(query: str) -> str:
    return re.sub(r"\[[^\]]+\]", "", query)


def _replace_between(expr: str) -> str:
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
    expr = expr.replace("<>", "!=")
    expr = re.sub(r"(?<![<>=!])=(?!=)", "==", expr)
    expr = re.sub(r"\bAND\b", "and", expr, flags=re.IGNORECASE)
    expr = re.sub(r"\bOR\b", "or", expr, flags=re.IGNORECASE)
    expr = re.sub(r"\bNOT\b", "not", expr, flags=re.IGNORECASE)
    return expr


def _map_fields(expr: str) -> str:
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


def parse_query(query: str) -> ParsedQuery:
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

    return ParsedQuery(
        raw=query,
        normalized=mapped,
        filter_expr=mapped,
        sort_by=sort_by,
        sort_order=sort_order,
        limit=limit,
    )
