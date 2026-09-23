"""Compact, provenance-carrying envelopes for agent tool results.

Tool handlers return raw provider payloads today, which are serialised straight
into the model's context. Two problems follow: the payloads are large enough to
crowd out reasoning, and the agent cannot tell live data from the synthetic
fallback the provider waterfall emits when NSE/Kite/Finnhub reject the caller.

``ok``/``err`` wrap a result in a fixed shape that answers both. Provenance
reuses ``backend.core.provenance.make_provenance`` so tools and HTTP routes
report data quality the same way.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping, Sequence

from backend.core.provenance import make_provenance

# Keep list-shaped tool results bounded; the agent asks for more by paging.
DEFAULT_ROW_CAP = 25


def ok(
    data: Any,
    *,
    source: str = "openterminalui",
    quality: str = "live",
    as_of: str | None = None,
    note: str | None = None,
    truncated: int | None = None,
) -> dict[str, Any]:
    """Wrap a successful tool result.

    ``truncated`` is the number of rows dropped by a cap, so the agent can say
    "showing 25 of 340" instead of silently reasoning over a partial set.
    """
    env: dict[str, Any] = {
        "ok": True,
        "data": data,
        "provenance": make_provenance(source, quality, as_of=as_of, note=note),
    }
    if truncated:
        env["truncated"] = truncated
    return env


def err(message: str, *, code: str = "tool_error", hint: str | None = None) -> dict[str, Any]:
    """Wrap a failure. Tools must never raise into the MCP client."""
    env: dict[str, Any] = {
        "ok": False,
        "error": {"code": code, "message": str(message)},
        "provenance": make_provenance("openterminalui", "unavailable"),
    }
    if hint:
        env["error"]["hint"] = hint
    return env


def project(rows: Iterable[Mapping[str, Any]], fields: Sequence[str]) -> list[dict[str, Any]]:
    """Keep only ``fields`` from each row, dropping keys whose value is None.

    Screener and scanner rows carry sparklines, viz blobs and per-column scores
    that cost context without informing a decision.
    """
    out = []
    for row in rows:
        out.append({f: row[f] for f in fields if f in row and row[f] is not None})
    return out


def cap(rows: Sequence[Any], limit: int | None = None) -> tuple[list[Any], int]:
    """Truncate ``rows`` to ``limit``. Returns (kept, dropped_count)."""
    n = DEFAULT_ROW_CAP if limit is None else max(1, int(limit))
    if len(rows) <= n:
        return list(rows), 0
    return list(rows[:n]), len(rows) - n


def is_envelope(value: Any) -> bool:
    """True when a tool already returned an ``ok``/``err`` envelope."""
    return isinstance(value, Mapping) and "ok" in value and ("data" in value or "error" in value)


def ensure_envelope(result: Any) -> dict[str, Any]:
    """Normalise any tool result into an envelope.

    The tools added for the agent surface return envelopes natively, but the
    original market tools predate them and the in-app agent console renders
    their raw shape directly (``frontend/src/agent/components/artifacts.tsx``
    reads ``current_price`` off the result). Rather than break that contract,
    the MCP boundary wraps legacy results on the way out, so an external MCP
    client sees one consistent shape across every tool.
    """
    if is_envelope(result):
        return dict(result)
    # Legacy handlers signal failure with a bare {"error": ...} dict.
    if isinstance(result, Mapping) and "error" in result and len(result) <= 2:
        return err(str(result["error"]))
    return ok(result, quality="delayed", note="legacy tool result; provenance not reported by this tool")
