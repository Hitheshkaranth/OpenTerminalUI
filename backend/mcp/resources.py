"""MCP resources: addressable, readable blobs the agent can pull without a tool call.

Resources are cheaper than tools for an agent to consult — no arguments to get
right, no side effects to reason about — but only if the payloads stay small.
Every read here goes through ``project``/``cap`` from
``backend.agent.tools.envelope`` for the same reason tool handlers do: an
agent that has to page through 500 journal rows to find the last three trades
is worse off than one with no journal access at all.

URI scheme: ``otui://<kind>/<id>``. ``<id>`` is omitted for a collection
listing (e.g. ``otui://watchlist`` lists all watchlists) and required for a
single-item read (e.g. ``otui://watchlist/<uuid>``). ``portfolio`` and
``journal`` use a fixed pseudo-id (``default`` / ``recent``) since there is
one holdings snapshot and one "recent entries" view per user.

DB access follows the same pattern as ``backend.agent.tools.portfolio_tools``:
open ``SessionLocal()``, filter by ``user_id`` where the table has one, close
in ``finally``. That module's helpers are private to it, so the queries below
are written fresh rather than imported.
"""

from __future__ import annotations

from typing import Any

from backend.agent.tools.envelope import cap, err, ok, project
from backend.shared.db import SessionLocal

# Recent-journal and active-alerts reads are capped tighter than the tool
# default — these are context for a resource pull, not a paged listing.
JOURNAL_RECENT_LIMIT = 10
ALERTS_LIMIT = 25
WATCHLIST_SYMBOL_LIMIT = 50


# ---------------------------------------------------------------------------
# URI parsing
# ---------------------------------------------------------------------------

def _parse_uri(uri: str) -> tuple[str, str | None]:
    """Split ``otui://<kind>/<id>`` into ``(kind, id_or_None)``.

    Raises ``ValueError`` on anything that isn't a well-formed ``otui://`` URI
    with a non-empty kind segment. Callers must catch this — resources never
    raise into the MCP client.
    """
    if not isinstance(uri, str) or "://" not in uri:
        raise ValueError(f"malformed resource uri: {uri!r}")
    scheme, _, rest = uri.partition("://")
    if scheme != "otui" or not rest:
        raise ValueError(f"malformed resource uri: {uri!r}")
    kind, _, rid = rest.partition("/")
    if not kind:
        raise ValueError(f"malformed resource uri: {uri!r}")
    return kind, (rid or None)


# ---------------------------------------------------------------------------
# list_resources
# ---------------------------------------------------------------------------

def list_resources(user_id: str) -> list[dict[str, Any]]:
    """Enumerate addressable resources for *user_id*.

    This is a thin catalog — uri/name/description/mimeType only, no payload —
    so it is safe to list every row a user owns even though reading any one
    of them stays capped.
    """
    from backend.models import SavedViewORM, WatchlistORM

    items: list[dict[str, Any]] = [
        {
            "uri": "otui://watchlist",
            "name": "All watchlists",
            "description": "Every watchlist owned by the user, with symbols.",
            "mimeType": "application/json",
        },
        {
            "uri": "otui://portfolio/default",
            "name": "Portfolio holdings",
            "description": "Current holdings snapshot: quantity, cost basis, unrealized P&L.",
            "mimeType": "application/json",
        },
        {
            "uri": "otui://saved-view",
            "name": "All saved views",
            "description": "Every saved screener/scanner view owned by the user.",
            "mimeType": "application/json",
        },
        {
            "uri": "otui://journal/recent",
            "name": "Recent journal entries",
            "description": f"The user's last {JOURNAL_RECENT_LIMIT} trade journal entries.",
            "mimeType": "application/json",
        },
        {
            "uri": "otui://alerts/active",
            "name": "Active alerts",
            "description": "Alerts currently in the 'active' state (not triggered, paused, or expired).",
            "mimeType": "application/json",
        },
    ]

    db = SessionLocal()
    try:
        watchlists = db.query(WatchlistORM).filter(WatchlistORM.user_id == user_id).all()
        for w in watchlists:
            items.append({
                "uri": f"otui://watchlist/{w.id}",
                "name": f"Watchlist: {w.name}",
                "description": f"{len(list(w.symbols_json or []))} symbols.",
                "mimeType": "application/json",
            })

        saved_views = db.query(SavedViewORM).filter(SavedViewORM.user_id == user_id).all()
        for v in saved_views:
            items.append({
                "uri": f"otui://saved-view/{v.id}",
                "name": f"Saved view: {v.name}",
                "description": f"{v.scope}/{v.page}",
                "mimeType": "application/json",
            })
    finally:
        db.close()

    return items


# ---------------------------------------------------------------------------
# read_resource
# ---------------------------------------------------------------------------

def read_resource(uri: str, user_id: str) -> dict[str, Any]:
    """Resolve *uri* and return an envelope. Never raises."""
    try:
        kind, rid = _parse_uri(uri)
    except ValueError as exc:
        return err(str(exc), code="unknown_resource", hint="expected otui://<kind>[/<id>]")

    dispatch = {
        "watchlist": _read_watchlist,
        "portfolio": _read_portfolio,
        "saved-view": _read_saved_view,
        "journal": _read_journal,
        "alerts": _read_alerts,
    }
    handler = dispatch.get(kind)
    if handler is None:
        return err(
            f"unknown resource kind: {kind!r}",
            code="unknown_resource",
            hint="known kinds: watchlist, portfolio, saved-view, journal, alerts",
        )
    return handler(rid, user_id)


def _read_watchlist(rid: str | None, user_id: str) -> dict[str, Any]:
    from backend.models import WatchlistORM

    db = SessionLocal()
    try:
        if rid is None:
            rows = db.query(WatchlistORM).filter(WatchlistORM.user_id == user_id).all()
            items = [
                {"id": r.id, "name": r.name, "symbols": list(r.symbols_json or [])[:WATCHLIST_SYMBOL_LIMIT]}
                for r in rows
            ]
            return ok(items, source="openterminalui", quality="live")

        row = (
            db.query(WatchlistORM)
            .filter(WatchlistORM.id == rid, WatchlistORM.user_id == user_id)
            .first()
        )
        if row is None:
            return err(f"watchlist not found: {rid}", code="not_found")

        symbols = list(row.symbols_json or [])
        kept, dropped = cap(symbols, WATCHLIST_SYMBOL_LIMIT)
        data = {"id": row.id, "name": row.name, "symbols": kept}
        return ok(data, source="openterminalui", quality="live", truncated=dropped)
    finally:
        db.close()


def _read_portfolio(rid: str | None, user_id: str) -> dict[str, Any]:
    from backend.db.models import Holding

    # Legacy holdings table has no user_id column — mirrors
    # backend.agent.tools.portfolio_tools._holdings_snapshot's scoping.
    del rid  # only "default" is meaningful; anything else resolves the same snapshot

    db = SessionLocal()
    try:
        holdings = db.query(Holding).all()
        total_cost = 0.0
        total_value = 0.0
        rows = []
        for h in holdings:
            cost = float(h.quantity) * float(h.avg_buy_price)
            total_cost += cost
            value = float(h.quantity) * float(h.avg_buy_price)  # no live mark in resource context
            total_value += value
            rows.append({
                "ticker": h.ticker,
                "quantity": h.quantity,
                "avg_buy_price": h.avg_buy_price,
                "cost": round(cost, 2),
            })
        total_cost = round(total_cost, 2)
        total_value = round(total_value, 2)
        kept, dropped = cap(rows)
        data = {
            "items": kept,
            "total_value": total_value,
            "total_cost": total_cost,
            "unrealized_pnl": round(total_value - total_cost, 2) if total_cost else None,
        }
        note = "No live mark price in resource context — cost basis only." if kept else None
        return ok(data, source="openterminalui", quality="delayed", note=note, truncated=dropped)
    finally:
        db.close()


def _read_saved_view(rid: str | None, user_id: str) -> dict[str, Any]:
    from backend.saved_views.models import SavedViewORM

    db = SessionLocal()
    try:
        if rid is None:
            rows = db.query(SavedViewORM).filter(SavedViewORM.user_id == user_id).all()
            fields = ["id", "name", "scope", "page", "description"]
            items = project([_saved_view_row(r) for r in rows], fields)
            return ok(items, source="openterminalui", quality="live")

        row = (
            db.query(SavedViewORM)
            .filter(SavedViewORM.id == rid, SavedViewORM.user_id == user_id)
            .first()
        )
        if row is None:
            return err(f"saved view not found: {rid}", code="not_found")

        data = _saved_view_row(row)
        data["payload"] = row.payload_json or {}
        return ok(data, source="openterminalui", quality="live")
    finally:
        db.close()


def _saved_view_row(r: Any) -> dict[str, Any]:
    return {
        "id": r.id,
        "name": r.name,
        "scope": r.scope,
        "page": r.page,
        "description": r.description,
    }


def _read_journal(rid: str | None, user_id: str) -> dict[str, Any]:
    from backend.models.journal import JournalEntry

    del rid  # only "recent" is meaningful; any id resolves the same recent-N view

    db = SessionLocal()
    try:
        rows = (
            db.query(JournalEntry)
            .filter(JournalEntry.user_id == user_id)
            .order_by(JournalEntry.entry_date.desc())
            .limit(JOURNAL_RECENT_LIMIT)
            .all()
        )
        fields = [
            "id", "symbol", "direction", "entry_date", "entry_price",
            "exit_date", "exit_price", "quantity", "pnl", "pnl_pct", "strategy", "setup",
        ]
        raw = [
            {
                "id": r.id,
                "symbol": r.symbol,
                "direction": r.direction,
                "entry_date": r.entry_date.isoformat() if r.entry_date else None,
                "entry_price": r.entry_price,
                "exit_date": r.exit_date.isoformat() if r.exit_date else None,
                "exit_price": r.exit_price,
                "quantity": r.quantity,
                "pnl": r.pnl,
                "pnl_pct": r.pnl_pct,
                "strategy": r.strategy,
                "setup": r.setup,
            }
            for r in rows
        ]
        items = project(raw, fields)
        return ok(items, source="openterminalui", quality="live")
    finally:
        db.close()


def _read_alerts(rid: str | None, user_id: str) -> dict[str, Any]:
    from backend.models import AlertORM, AlertStatus

    del rid  # only "active" is meaningful; any id resolves the same active-alerts view

    db = SessionLocal()
    try:
        rows = (
            db.query(AlertORM)
            .filter(AlertORM.user_id == user_id, AlertORM.status == AlertStatus.ACTIVE.value)
            .all()
        )
        raw = [
            {
                "id": r.id,
                "symbol": r.symbol,
                "condition_type": r.condition_type,
                "parameters": r.parameters if isinstance(r.parameters, dict) else {},
                "status": r.status,
            }
            for r in rows
        ]
        kept, dropped = cap(raw, ALERTS_LIMIT)
        return ok(kept, source="openterminalui", quality="live", truncated=dropped)
    finally:
        db.close()
