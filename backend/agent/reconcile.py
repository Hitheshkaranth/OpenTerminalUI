"""Cross-source reconciliation and staleness for the grounding ledger.

Grounding proves a figure matches *a* source, not that the source is right. In a live run the
screener fundamentals store said AAPL ROE = 18 while Yahoo's snapshot said 148.75: the answer
"matched its source" and was still wrong. Likewise a synthetic order book carried an as-of a
week old. This module surfaces both, so the reader sees when the evidence itself is suspect:

- ``find_conflicts`` — the same metric for the same ticker differs across sources.
- ``find_stale``     — a source is older than the freshness budget for its kind of data.

Deterministic, and ``reconcile`` never raises: it runs inside a live answer stream.
"""

from __future__ import annotations

import statistics
from datetime import datetime, time, timedelta, timezone
from typing import Any

from backend.agent.grounding import _FRACTION_METRICS, GroundingLedger

# Intraday prints differ legitimately between feeds/snapshot times; "score" is tool-specific.
_NON_COMPARABLE_METRICS = {"score", "open", "day_high", "day_low", "change_pct"}

# Freshness budgets in hours. The default covers a weekend plus a holiday, so a Friday close
# read on Monday (or Tuesday after a holiday) is not flagged.
_INTRADAY_TOOLS = {"get_market_depth", "get_option_chain", "get_fno_flow"}
_INTRADAY_HOURS = 24.0
_CACHED_HOURS = 7 * 24.0
_DEFAULT_HOURS = 96.0

_SEVERITY_ORDER = {"high": 0, "medium": 1}


def _skip_source(src: Any) -> bool:
    return src is None or src.quality == "user" or str(src.tool).startswith("computed:")


def find_conflicts(ledger: GroundingLedger, *, rel_tol: float = 0.05) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str], dict[str, Any]] = {}
    for src in ledger.sources:
        if _skip_source(src):
            continue
        for leaf in src.leaves:
            if leaf.kind != "value" or leaf.metric is None or leaf.subject is None:
                continue
            if leaf.metric in _NON_COMPARABLE_METRICS:
                continue
            per_source = groups.setdefault((leaf.subject, leaf.metric), {})
            per_source.setdefault(src.id, (src, leaf))  # first leaf of each source wins

    conflicts: list[dict[str, Any]] = []
    for (subject, metric), per_source in groups.items():
        if len(per_source) < 2:
            continue
        entries = list(per_source.values())
        raw = [leaf.value for _, leaf in entries]
        normalised = list(raw)
        if metric in _FRACTION_METRICS:
            for i, value in enumerate(raw):
                others = [abs(v) for j, v in enumerate(raw) if j != i]
                if abs(value) <= 1.5 and statistics.median(others) > 1.5:
                    normalised[i] = value * 100
        hi, lo = max(normalised), min(normalised)
        denom = max(abs(hi), abs(lo))
        if denom == 0:
            continue
        spread_pct = round((hi - lo) / denom * 100, 1)
        if spread_pct <= rel_tol * 100:
            continue
        conflicts.append({
            "subject": subject,
            "metric": metric,
            "values": [{"source_id": src.id, "path": leaf.path, "value": leaf.value,
                        "provider": src.provider, "quality": src.quality} for src, leaf in entries],
            "spread_pct": spread_pct,
            "severity": "high" if spread_pct >= 20 else "medium",
        })
    conflicts.sort(key=lambda c: (_SEVERITY_ORDER[c["severity"]], -c["spread_pct"]))
    return conflicts


def _parse_as_of(as_of: Any) -> datetime | None:
    if not isinstance(as_of, str) or not as_of.strip():
        return None
    text = as_of.strip()
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        if len(text) == 10:  # date-only: the data is good through the end of that day
            return datetime.combine(datetime.strptime(text, "%Y-%m-%d").date(), time(23, 59, 59),
                                    tzinfo=timezone.utc)
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _budget_hours(tool: str, quality: str) -> float:
    if tool in _INTRADAY_TOOLS:
        return _INTRADAY_HOURS
    if quality == "cached":
        return _CACHED_HOURS
    return _DEFAULT_HOURS


def find_stale(ledger: GroundingLedger, *, now: datetime | None = None) -> list[dict[str, Any]]:
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    stale: list[dict[str, Any]] = []
    for src in ledger.sources:
        if src.as_of is None or src.quality in {"user", "computed"}:
            continue
        stamp = _parse_as_of(src.as_of)
        if stamp is None:
            continue
        age = (now - stamp) / timedelta(hours=1)
        threshold = _budget_hours(src.tool, src.quality)
        if age > threshold:
            stale.append({"source_id": src.id, "tool": src.tool, "as_of": src.as_of,
                          "age_hours": round(age, 1), "threshold_hours": float(threshold)})
    stale.sort(key=lambda s: -s["age_hours"])
    return stale


def reconcile(ledger: GroundingLedger, *, now: datetime | None = None) -> dict[str, list[dict[str, Any]]]:
    try:
        return {"conflicts": find_conflicts(ledger), "stale": find_stale(ledger, now=now)}
    except Exception:
        return {"conflicts": [], "stale": []}
