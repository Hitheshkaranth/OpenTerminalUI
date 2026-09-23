"""Approval-gated proposal tools for the agent (rebalance, journal, watchlist-remove, screener-alert).

Every handler here is, in effect, read-only: it validates input, computes a
payload, writes a single PENDING row via ``backend.agent.proposals.create_proposal``,
and returns. Nothing is ever executed by the agent — a human confirms the
proposal later via ``backend/api/routes/agent_proposals.py``. This is why
every ``write_class`` below is non-"none": ``ToolRegistry.filtered(allow_writes=False)``
uses that flag as the actual permission gate that keeps a read-only API key
from creating proposal rows at all.
"""

from __future__ import annotations

from typing import Any

from backend.agent.proposals import create_proposal
from backend.agent.tools.envelope import err, ok
from backend.agent.tools.registry import ToolSpec
from backend.shared.db import SessionLocal

_PENDING_NOTE = "This is a PROPOSAL ONLY — nothing has been executed. It is pending human confirmation."


# ---------------------------------------------------------------------------
# 1. propose_rebalance
# ---------------------------------------------------------------------------

async def propose_rebalance(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    from backend.models import VirtualPortfolio, VirtualPosition

    raw_weights = args.get("target_weights")
    if not isinstance(raw_weights, dict) or not raw_weights:
        return err("target_weights must be a non-empty object of symbol -> weight", code="invalid_args")
    try:
        weights = {str(k).strip().upper(): float(v) for k, v in raw_weights.items()}
    except (TypeError, ValueError):
        return err("target_weights values must be numeric", code="invalid_args")
    if any(w < 0 for w in weights.values()):
        return err("target_weights values must be non-negative", code="invalid_args")
    total_weight = sum(weights.values())
    if abs(total_weight - 1.0) > 0.02:
        return err(f"target_weights must sum to ~1.0 (got {total_weight:.4f})", code="invalid_args")
    rationale = str(args.get("rationale") or "").strip()
    if not rationale:
        return err("rationale is required", code="invalid_args")

    portfolio_id = args.get("portfolio_id")
    db = SessionLocal()
    try:
        if portfolio_id:
            portfolio = (
                db.query(VirtualPortfolio)
                .filter(VirtualPortfolio.id == portfolio_id, VirtualPortfolio.user_id == user_id)
                .first()
            )
        else:
            portfolio = (
                db.query(VirtualPortfolio)
                .filter(VirtualPortfolio.user_id == user_id)
                .order_by(VirtualPortfolio.created_at)
                .first()
            )
        if portfolio is None:
            return err("No paper portfolio found for this user — create one before proposing a rebalance", code="not_found")

        positions = db.query(VirtualPosition).filter(VirtualPosition.portfolio_id == portfolio.id).all()
        # No live mark price is available in agent context; use avg_entry_price like
        # portfolio_tools._paper_positions does, for consistent (if approximate) sizing.
        position_value = {p.symbol: float(p.quantity) * float(p.avg_entry_price) for p in positions}
        price_map = {p.symbol: float(p.avg_entry_price) for p in positions if float(p.avg_entry_price) > 0}
        total_equity = float(portfolio.current_cash) + sum(position_value.values())
        if total_equity <= 0:
            return err("Portfolio has no equity to rebalance against", code="invalid_state")

        deltas: list[dict[str, Any]] = []
        for symbol in sorted(set(weights) | set(position_value)):
            current_value = position_value.get(symbol, 0.0)
            current_weight = current_value / total_equity
            target_weight = weights.get(symbol, 0.0)
            target_value = target_weight * total_equity
            delta_value = target_value - current_value
            price = price_map.get(symbol)
            deltas.append({
                "symbol": symbol,
                "current_weight": round(current_weight, 4),
                "target_weight": round(target_weight, 4),
                "delta_weight": round(target_weight - current_weight, 4),
                "current_value": round(current_value, 2),
                "target_value": round(target_value, 2),
                "delta_value": round(delta_value, 2),
                "price_used": price,
                "implied_delta_qty": round(delta_value / price, 4) if price else None,
            })

        payload = {
            "portfolio_id": portfolio.id,
            "target_weights": weights,
            "total_equity": round(total_equity, 2),
            "deltas": deltas,
        }
        summary = f"Rebalance '{portfolio.name}' to {len(weights)} target weight(s)"
        result = create_proposal(db, user_id, None, "rebalance", payload, summary, rationale)
    finally:
        db.close()

    return ok({
        "proposal_id": result["proposal_id"],
        "status": result["status"],
        "summary": result["summary"],
        "deltas": deltas,
        "note": _PENDING_NOTE,
    })


# ---------------------------------------------------------------------------
# 2. propose_journal_entry
# ---------------------------------------------------------------------------

async def propose_journal_entry(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    title = str(args.get("title") or "").strip()
    body = str(args.get("body") or "").strip()
    if not title or not body:
        return err("title and body are required", code="invalid_args")
    raw_ticker = args.get("ticker")
    ticker = str(raw_ticker).strip().upper() if raw_ticker else None
    raw_tags = args.get("tags") or []
    if not isinstance(raw_tags, list):
        return err("tags must be an array of strings", code="invalid_args")
    tags = [str(t).strip() for t in raw_tags if str(t).strip()]

    payload = {"ticker": ticker, "title": title, "body": body, "tags": tags}
    summary = f"Journal entry: {title}" + (f" ({ticker})" if ticker else "")
    db = SessionLocal()
    try:
        # No standalone rationale field for a note — the note body IS the rationale.
        result = create_proposal(db, user_id, None, "journal_entry", payload, summary, rationale=body)
    finally:
        db.close()

    return ok({
        "proposal_id": result["proposal_id"],
        "status": result["status"],
        "summary": result["summary"],
        "note": _PENDING_NOTE,
    })


# ---------------------------------------------------------------------------
# 3. propose_watchlist_remove
# ---------------------------------------------------------------------------

async def propose_watchlist_remove(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    watchlist_id = str(args.get("watchlist_id") or "").strip()
    if not watchlist_id:
        return err("watchlist_id is required", code="invalid_args")
    raw_symbols = args.get("symbols") or []
    if not isinstance(raw_symbols, list):
        return err("symbols must be a non-empty array", code="invalid_args")
    symbols = [str(s).strip().upper() for s in raw_symbols if str(s).strip()]
    if not symbols:
        return err("symbols must be a non-empty array", code="invalid_args")
    rationale = str(args.get("rationale") or "").strip()
    if not rationale:
        return err("rationale is required", code="invalid_args")

    payload = {"watchlist_id": watchlist_id, "symbols": symbols}
    summary = f"Remove {', '.join(symbols)} from watchlist"
    db = SessionLocal()
    try:
        result = create_proposal(db, user_id, None, "watchlist_remove", payload, summary, rationale)
    finally:
        db.close()

    return ok({
        "proposal_id": result["proposal_id"],
        "status": result["status"],
        "summary": result["summary"],
        "note": _PENDING_NOTE,
    })


# ---------------------------------------------------------------------------
# 4. propose_screener_alert
# ---------------------------------------------------------------------------

async def propose_screener_alert(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    name = str(args.get("name") or "").strip()
    if not name:
        return err("name is required", code="invalid_args")
    criteria = args.get("criteria")
    if isinstance(criteria, str):
        criteria = criteria.strip()
        if not criteria:
            return err("criteria is required", code="invalid_args")
    elif isinstance(criteria, dict):
        if not criteria:
            return err("criteria is required", code="invalid_args")
    else:
        return err("criteria must be a non-empty filter expression string or object", code="invalid_args")
    frequency = str(args.get("frequency") or "daily").strip().lower()
    if frequency not in ("daily", "weekly", "on_match"):
        return err("frequency must be one of: daily, weekly, on_match", code="invalid_args")
    rationale = str(args.get("rationale") or "").strip() or f"Saved screen: {name}"

    payload = {"name": name, "criteria": criteria, "frequency": frequency}
    summary = f"Screener alert '{name}' ({frequency})"
    db = SessionLocal()
    try:
        result = create_proposal(db, user_id, None, "screener_alert", payload, summary, rationale)
    finally:
        db.close()

    return ok({
        "proposal_id": result["proposal_id"],
        "status": result["status"],
        "summary": result["summary"],
        "note": _PENDING_NOTE,
    })


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def action_tool_specs(user_id: str) -> list[ToolSpec]:
    """Return the four propose_* action tool specs for *user_id*.

    Every spec here is a proposal-only write: it creates a PENDING row and
    returns — nothing executes. write_class is non-"none" on all four, which
    is what keeps a read-only-permissioned API key from reaching them via
    ToolRegistry.filtered(allow_writes=False).
    """

    async def _propose_rebalance(args: dict[str, Any]) -> dict[str, Any]:
        return await propose_rebalance(args, user_id)

    async def _propose_journal_entry(args: dict[str, Any]) -> dict[str, Any]:
        return await propose_journal_entry(args, user_id)

    async def _propose_watchlist_remove(args: dict[str, Any]) -> dict[str, Any]:
        return await propose_watchlist_remove(args, user_id)

    async def _propose_screener_alert(args: dict[str, Any]) -> dict[str, Any]:
        return await propose_screener_alert(args, user_id)

    return [
        ToolSpec(
            name="propose_rebalance",
            description="Propose a portfolio rebalance to the given target weights. Computes the implied "
            "per-symbol trade (current weight, target weight, delta value, implied delta quantity) so a "
            "human can review before confirming. This tool ONLY PROPOSES — it requires user confirmation "
            "and does not place any trades.",
            parameters={
                "type": "object",
                "properties": {
                    "target_weights": {
                        "type": "object",
                        "description": "Map of symbol -> target portfolio weight (0-1). Must sum to ~1.0.",
                        "additionalProperties": {"type": "number"},
                    },
                    "portfolio_id": {"type": "string", "description": "Optional; defaults to the user's first paper portfolio."},
                    "rationale": {"type": "string"},
                },
                "required": ["target_weights", "rationale"],
            },
            handler=_propose_rebalance,
            read_only=False,
            write_class="order",
        ),
        ToolSpec(
            name="propose_journal_entry",
            description="Propose a research journal note (optionally tied to a ticker) for the user's "
            "record. This tool ONLY PROPOSES — it requires user confirmation and does not save anything "
            "until confirmed.",
            parameters={
                "type": "object",
                "properties": {
                    "ticker": {"type": "string"},
                    "title": {"type": "string"},
                    "body": {"type": "string"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["title", "body"],
            },
            handler=_propose_journal_entry,
            read_only=False,
            write_class="soft",
        ),
        ToolSpec(
            name="propose_watchlist_remove",
            description="Propose removing one or more symbols from a watchlist (the removal counterpart "
            "to propose_watchlist_add). This tool ONLY PROPOSES — it requires user confirmation and does "
            "not modify the watchlist until confirmed.",
            parameters={
                "type": "object",
                "properties": {
                    "watchlist_id": {"type": "string"},
                    "symbols": {"type": "array", "items": {"type": "string"}},
                    "rationale": {"type": "string"},
                },
                "required": ["watchlist_id", "symbols", "rationale"],
            },
            handler=_propose_watchlist_remove,
            read_only=False,
            write_class="soft",
        ),
        ToolSpec(
            name="propose_screener_alert",
            description="Propose a saved screen that notifies the user when new stocks match the given "
            "criteria. This tool ONLY PROPOSES — it requires user confirmation and does not create the "
            "saved screen until confirmed.",
            parameters={
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "criteria": {
                        "description": "Filter expression string (e.g. 'pe_ratio < 20 and roe > 15') or a criteria object.",
                        "oneOf": [{"type": "string"}, {"type": "object"}],
                    },
                    "frequency": {"type": "string", "enum": ["daily", "weekly", "on_match"], "default": "daily"},
                    "rationale": {"type": "string"},
                },
                "required": ["name", "criteria"],
            },
            handler=_propose_screener_alert,
            read_only=False,
            write_class="soft",
        ),
    ]
