from __future__ import annotations

import asyncio
import re
from typing import Any

from sqlalchemy.orm import Session

from backend.business_metrics.models import BusinessMetricORM

# OWNER: agent L (swarm fi_v1).
#
# Peer operational-KPI comparison. Operational KPIs come from agent D's
# `business_metric_points` table; the valuation/margin/profitability rows come
# from the existing fundamentals/snapshot service (GET /api/stocks/{ticker} ->
# `get_stock`). Rows are aligned across the target company and its peers so the
# frontend can render a single comparison matrix.

# Snapshot financial metrics -> peer row. Only fields the snapshot service
# actually exposes are used; honesty rule forbids fabricating ROCE /
# debt/equity / true EBITDA margin, so those rows are emitted only when the
# source supplies a value.
_FINANCIAL_ROWS: tuple[dict[str, Any], ...] = (
    {"key": "revenue_growth", "field": "rev_growth_pct", "label": "Revenue Growth %", "unit": "%", "higher_is_better": True},
    {"key": "operating_margin", "field": "op_margin_pct", "label": "Operating Margin %", "unit": "%", "higher_is_better": True},
    {"key": "net_margin", "field": "net_margin_pct", "label": "Net Margin %", "unit": "%", "higher_is_better": True},
    {"key": "roe", "field": "roe_pct", "label": "ROE %", "unit": "%", "higher_is_better": True},
    {"key": "pe", "field": "pe", "label": "P/E", "unit": None, "higher_is_better": False},
    {"key": "ev_ebitda", "field": "ev_ebitda", "label": "EV/EBITDA", "unit": None, "higher_is_better": False},
)

# A metric where a *lower* number is better (kept narrow so an ordinary
# "return" / "margin" KPI is still treated as better-when-high).
_WORSE_TOKENS: tuple[str, ...] = (
    "ev/ebitda", "ev / ebitda", "price/earnings", "p/e", "pe ratio",
    "debt/equity", "debt to equity", "debt/equity ratio",
    "days payable", "receivable days", "days outstanding",
    "dividend payout", "payout ratio",
)
_BETTER_TOKENS: tuple[str, ...] = (
    "growth", "margin", "return", "roce", "roe", "roic", "roa",
    "order book", "orderbook", "backlog", "order inflow",
    "capacity utilisation", "capacity utilization",
    "utilisation", "utilization", "customers", "subscribers",
    "revenue", "eps", "market share", "realisation", "realization",
)

_UNIT_WORDS = (
    "acre|billion|cpts|cop|crore|gw|ha|kg|lakh|mgd|mnt|mt|mw|mn|pcs?|packs?|sgd|kw|nt|"
    "units?|tonne|tonnes|branch|branches|store|stores|customer|customers|client|clients|bps"
)
_UNIT_RE = re.compile(r"\b(?:" + _UNIT_WORDS + r")\b", re.IGNORECASE)
_PAREN_RE = re.compile(r"\([^)]*\)")
_ALNUM_RE = re.compile(r"[^a-z0-9]+")


# --------------------------------------------------------------------------- #
# Pure helpers (unit-tested directly)
# --------------------------------------------------------------------------- #
def _period_sort_key(period: str | None):
    if not period:
        return (-1, -1, -1, "")
    up = period.upper()
    m_quarter = re.match(r"^Q([1-4])\s*FY\s*(20?\d{2})$", up)
    if m_quarter:
        return (int(m_quarter.group(2)) % 100, int(m_quarter.group(1)), 0, up)
    m_fy = re.match(r"^FY\s*(20?\d{2})$", up)
    if m_fy:
        return (int(m_fy.group(1)) % 100, -1, 0, up)
    m_year = re.search(r"\b(20\d{2})\b", up)
    if m_year:
        return (int(m_year.group(1)), 0, 0, up)
    return (9999, 0, 0, up)


def _normalise_label(label: str | None) -> str:
    if not label:
        return ""
    text = _PAREN_RE.sub(" ", label)
    text = _UNIT_RE.sub(" ", text)
    text = _ALNUM_RE.sub(" ", text.lower())
    return " ".join(text.split())


def _group_key(candidate: dict[str, Any]) -> tuple[str, str | None]:
    return (_normalise_label(candidate.get("label")), candidate.get("unit"))


def _higher_is_better(key: str | None, label: str | None, category: str | None) -> bool | None:
    combined = " ".join(str(x) for x in (key, label, category) if x).lower()
    for token in _WORSE_TOKENS:
        if token in combined:
            return False
    for token in _BETTER_TOKENS:
        if token in combined:
            return True
    return None


def _pick_most_frequent(members: list[dict[str, Any]], field: str) -> Any:
    counts: dict[str, int] = {}
    for c in members:
        value = c.get(field)
        if value:
            counts[value] = counts.get(value, 0) + 1
    if not counts:
        return None
    return max(counts.items(), key=lambda item: item[1])[0]


def _pick_longest_label(members: list[dict[str, Any]]) -> str | None:
    labels = [c["label"] for c in members if c.get("label")]
    if not labels:
        return None
    return max(labels, key=len)


def best_cells(values_by_symbol: dict[str, float | None], higher_is_better: bool | None) -> set[str]:
    """Symbols holding the best value for a row.

    `higher_is_better` True -> highest number; False -> lowest; None -> no best
    (no highlighting), matching the frontend contract.
    """
    good = {s: v for s, v in values_by_symbol.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}
    if not good:
        return set()
    if higher_is_better:
        best = max(good.values())
    elif higher_is_better is False:
        best = min(good.values())
    else:
        return set()
    return {s for s, v in good.items() if v == best}


def _latest_points(rows: list[BusinessMetricORM]) -> list[dict[str, Any]]:
    """Latest point per key for a single symbol, plus derived row metadata."""
    latest: dict[str, BusinessMetricORM] = {}
    for row in rows:
        key = row.key or "metric"
        current = latest.get(key)
        if current is None or _period_sort_key(row.period) >= _period_sort_key(current.period):
            latest[key] = row

    return [_candidate_from_orm(row) for row in latest.values()]


def _candidate_from_orm(row: BusinessMetricORM) -> dict[str, Any]:
    return {
        "key": row.key,
        "label": row.label or None,
        "unit": row.unit,
        "category": row.category,
        "value": row.value,
        "period": row.period,
        "citation": _citation_from_orm(row),
    }


def _citation_from_orm(row: BusinessMetricORM) -> dict[str, Any] | None:
    doc_id = None
    if row.document_id and row.document_id.isdigit():
        doc_id = int(row.document_id)
    if doc_id is None and not row.quote and not row.title:
        return None
    return {
        "doc_id": doc_id,
        "title": row.title,
        "page_start": row.page_start,
        "page_end": row.page_end,
        "section": row.section,
        "quote": row.quote,
        "source_url": row.source_url,
    }


def _align(
    symbols: list[str],
    candidates_by_symbol: list[list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    """Merge per-symbol candidates into aligned comparison rows.

    Two points merge when they share the same normalised label and unit; a unit
    mismatch keeps them as separate rows. `symbols[0]` is the target company.
    """
    per_symbol: list[dict[tuple[str, str | None], dict[str, Any]]] = []
    for candidates in candidates_by_symbol:
        map_by_group: dict[tuple[str, str | None], dict[str, Any]] = {}
        for candidate in candidates:
            map_by_group[_group_key(candidate)] = candidate
        per_symbol.append(map_by_group)

    order: list[tuple[str, str | None]] = []
    group_members: dict[tuple[str, str | None], list[dict[str, Any]]] = {}
    for candidates in candidates_by_symbol:
        for candidate in candidates:
            gk = _group_key(candidate)
            if gk not in group_members:
                group_members[gk] = []
                order.append(gk)
            group_members[gk].append(candidate)

    rows: list[dict[str, Any]] = []
    for gk in order:
        members = group_members[gk]
        key = _pick_most_frequent(members, "key") or members[0]["key"]
        label = _pick_longest_label(members) or str(key).replace("_", " ").strip() or gk[0]
        higher_is_better = _higher_is_better(key, label, members[0].get("category"))
        values: dict[str, Any] = {}
        for idx, gmap in enumerate(per_symbol):
            candidate = gmap.get(gk)
            if candidate is not None and candidate.get("value") is not None:
                values[symbols[idx]] = {
                    "value": candidate["value"],
                    "unit": candidate.get("unit"),
                    "period": candidate.get("period"),
                    "citation": candidate.get("citation"),
                }
        if not values:
            continue
        rows.append(
            {
                "key": key,
                "label": label,
                "unit": members[0]["unit"],
                "higher_is_better": higher_is_better,
                "values": values,
            }
        )
    return rows


async def _fetch_snapshot(ticker: str) -> dict[str, Any]:
    """One snapshot via the existing fundamentals/snapshot service.

    Bounded by a 10s timeout; monkeypatchable in tests so no real network is
    touched.
    """
    from backend.api.routes.stocks import get_stock

    try:
        snap = await asyncio.wait_for(get_stock(ticker), timeout=10)
        # get_stock returns a StockSnapshot model; the row builder reads dicts, so without this
        # every snapshot was discarded and the financial comparison was always empty.
        return snap.model_dump() if hasattr(snap, "model_dump") else (snap if isinstance(snap, dict) else {})
    except asyncio.TimeoutError:
        return {}
    except Exception:  # noqa: BLE001 - snapshot is best effort
        return {}


async def _build_financial_rows(symbols: list[str]) -> list[dict[str, Any]]:
    snapshots = await asyncio.gather(
        *(_fetch_snapshot(s) for s in symbols),
        return_exceptions=True,
    )
    snap_list: list[Any] = []
    for snap in snapshots:
        snap_list.append(snap if isinstance(snap, dict) else {})

    rows: list[dict[str, Any]] = []
    for spec in _FINANCIAL_ROWS:
        values: dict[str, Any] = {}
        for symbol, snap in zip(symbols, snap_list):
            value = snap.get(spec["field"]) if isinstance(snap, dict) else None
            if value is None:
                continue
            try:
                value = float(value)
            except (TypeError, ValueError):
                continue
            values[symbol] = {"value": value, "unit": spec["unit"], "period": None, "citation": None}
        if not values:
            continue
        rows.append(
            {
                "key": spec["key"],
                "label": spec["label"],
                "unit": spec["unit"],
                "higher_is_better": spec["higher_is_better"],
                "values": values,
            }
        )
    return rows


async def _resolve_default_peers(symbol: str) -> list[str]:
    """Peer symbol list from the existing peers service data source."""
    from backend.api.deps import get_unified_fetcher

    try:
        unified = await get_unified_fetcher()
        raw = await unified.fmp.get_peers(symbol)
    except Exception:  # noqa: BLE001 - peer resolution is best effort
        return []

    target = symbol.upper()
    peers: list[str] = []
    seen: set[str] = set()
    for entry in raw or []:
        if isinstance(entry, str):
            raw_symbol = entry
        elif isinstance(entry, dict):
            raw_symbol = entry.get("symbol") or entry.get("ticker") or ""
        else:
            continue
        normalized = str(raw_symbol).split(".")[0].strip().upper()
        if normalized and normalized != target and normalized not in seen:
            seen.add(normalized)
            peers.append(normalized)
    return peers[:6]


def _load_points(db: Session, symbols: list[str]) -> dict[str, list[BusinessMetricORM]]:
    """Raw KPI rows for `symbols`, grouped by symbol (agent D's table)."""
    live = [s for s in symbols if s]
    if not live:
        return {}
    rows = db.query(BusinessMetricORM).filter(BusinessMetricORM.symbol.in_(live)).all()
    by_symbol: dict[str, list[BusinessMetricORM]] = {}
    for row in rows:
        by_symbol.setdefault(row.symbol, []).append(row)
    return by_symbol


async def get_peer_kpis(db: Session, symbol: str, peers: list[str] | None = None) -> dict[str, Any]:
    symbol = symbol.strip().upper()
    warnings: list[str] = []

    if peers:
        resolved: list[str] = [p.strip().upper() for p in peers if p and p.strip()]
    else:
        resolved = await _resolve_default_peers(symbol)
    resolved = [p for p in resolved if p and p != symbol]
    peer_list = resolved[:6]

    all_symbols = [symbol] + peer_list

    points_by_symbol: dict[str, list[BusinessMetricORM]] = {}
    table_available = True
    try:
        points_by_symbol = _load_points(db, all_symbols)
    except Exception:  # noqa: BLE001 - guard when agent D's table is missing
        table_available = False
        points_by_symbol = {}
    if not table_available:
        warnings.append(
            "Business KPI data is unavailable for the company and peers (no KPI table yet); "
            "run the Filings Extract to populate it."
        )

    candidates_by_symbol = [_latest_points(points_by_symbol.get(s, [])) for s in all_symbols]
    missing = [all_symbols[i] for i in range(1, len(all_symbols)) if not candidates_by_symbol[i]]

    rows = _align(all_symbols, candidates_by_symbol)
    financial_rows = await _build_financial_rows(all_symbols)

    return {
        "symbol": symbol,
        "peers": peer_list,
        "rows": rows,
        "financial_rows": financial_rows,
        "missing": missing,
        "warnings": warnings,
    }