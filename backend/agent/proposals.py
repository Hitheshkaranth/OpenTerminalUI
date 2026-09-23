"""Proposal CRUD and proposal tool specs (C14).

Proposals are *never* executed by the agent — they wait for user confirmation.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import or_
from sqlalchemy.orm import Session

from backend.agent.tools.registry import ToolSpec
from backend.models.agent_proposals import AgentProposal
from backend.paper_trading import get_paper_engine  # noqa: F401 — for test monkeypatching
from backend.shared.db import SessionLocal  # noqa: F401 — for test monkeypatching

# Lazy imports to avoid circular deps at import time.


def _now() -> datetime:
    dt = datetime.now(timezone.utc)
    # Make naive for SQLite compatibility (SQLite stores naive datetimes)
    return dt.replace(tzinfo=None) if dt.tzinfo else dt


def _fmt_expiry() -> datetime:
    return _now() + timedelta(hours=24)


# ---------------------------------------------------------------------------
# Core CRUD
# ---------------------------------------------------------------------------

def create_proposal(
    db: Session,
    user_id: str,
    run_id: str | None,
    type: str,
    payload: dict,
    summary: str,
    rationale: str,
) -> dict:
    """Create a new pending proposal and return its dict representation."""
    p = AgentProposal(
        id=str(uuid4()),
        user_id=user_id,
        run_id=run_id,
        type=type,
        payload=payload,
        summary=summary,
        rationale=rationale,
        status="pending",
        created_at=_now(),
        expires_at=_fmt_expiry(),
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _proposal_to_dict(p)


def list_proposals(db: Session, user_id: str, status: str | None = None) -> list[dict]:
    """Return proposals for *user_id*, optionally filtered by status."""
    q = db.query(AgentProposal).filter(AgentProposal.user_id == user_id)
    if status:
        q = q.filter(AgentProposal.status == status)
    rows = q.order_by(AgentProposal.created_at.desc()).all()
    return [_proposal_to_dict(r) for r in rows]


async def confirm_proposal(
    db: Session,
    user_id: str,
    proposal_id: str,
) -> dict:
    """Confirm a pending proposal — execute the action.

    Returns {id, status, result}.
    Raises on non-pending or expired.
    """
    from backend.models import AlertORM, VirtualOrder, VirtualOrderStatus, VirtualPortfolio

    p = (
        db.query(AgentProposal)
        .filter(AgentProposal.id == proposal_id, AgentProposal.user_id == user_id)
        .first()
    )
    if p is None:
        raise ValueError("not_found")

    now = _now()

    # Expired check
    if p.expires_at < now:
        p.status = "expired"
        p.decided_at = now
        db.commit()
        raise ValueError("expired")

    # Only pending can be confirmed
    if p.status != "pending":
        raise ValueError("not_pending")

    p.status = "confirmed"
    p.decided_at = now
    result: dict = {}

    try:
        if p.type == "paper_order":
            result = await _confirm_paper_order(db, p)
        elif p.type == "alert":
            result = _confirm_alert(db, p)
        elif p.type == "watchlist_add":
            result = _confirm_watchlist_add(db, p)
        else:
            # No executor for this type yet (rebalance, journal_entry,
            # watchlist_remove and screener_alert are proposal-only for now).
            # Leaving status as "confirmed" would tell the user the action ran,
            # so fail loudly instead.
            result = {"error": f"no executor for proposal type: {p.type}"}
            p.status = "failed"
    except Exception as exc:  # noqa: BLE001
        result = {"error": str(exc)}
        p.status = "failed"

    p.result = result
    db.commit()
    db.refresh(p)
    return {"id": p.id, "status": p.status, "result": result}


def reject_proposal(db: Session, user_id: str, proposal_id: str) -> dict:
    """Mark a proposal as rejected."""
    p = (
        db.query(AgentProposal)
        .filter(AgentProposal.id == proposal_id, AgentProposal.user_id == user_id)
        .first()
    )
    if p is None:
        raise ValueError("not_found")
    p.status = "rejected"
    p.decided_at = _now()
    db.commit()
    db.refresh(p)
    return {"id": p.id, "status": p.status}


def expire_stale(db: Session) -> int:
    """Expire all proposals whose expires_at has passed. Returns count."""
    now = _now()
    rows = db.query(AgentProposal).filter(
        AgentProposal.status == "pending",
        AgentProposal.expires_at < now,
    ).all()
    for r in rows:
        r.status = "expired"
        r.decided_at = now
    if rows:
        db.commit()
    return len(rows)


# ---------------------------------------------------------------------------
# Internal execution helpers
# ---------------------------------------------------------------------------

async def _confirm_paper_order(db: Session, p: AgentProposal) -> dict:
    from backend.models import VirtualOrder, VirtualOrderStatus, VirtualPortfolio

    payload = p.payload
    symbol = str(payload.get("symbol", "")).strip().upper()
    if ":" not in symbol:
        symbol = f"NSE:{symbol}"

    # Find default portfolio: first VirtualPortfolio for user
    portfolio_id = payload.get("portfolio_id")
    if portfolio_id:
        portfolio = (
            db.query(VirtualPortfolio)
            .filter(VirtualPortfolio.id == portfolio_id, VirtualPortfolio.user_id == p.user_id)
            .first()
        )
    else:
        portfolio = (
            db.query(VirtualPortfolio)
            .filter(VirtualPortfolio.user_id == p.user_id)
            .order_by(VirtualPortfolio.created_at)
            .first()
        )
    if portfolio is None:
        # First agent-confirmed paper order for this user: create a default paper book
        # rather than failing — the user already approved the trade.
        portfolio = VirtualPortfolio(
            user_id=p.user_id,
            name="Agent Paper Book",
            initial_capital=1_000_000.0,
            current_cash=1_000_000.0,
            is_active=True,
        )
        db.add(portfolio)
        db.flush()

    order = VirtualOrder(
        portfolio_id=portfolio.id,
        symbol=symbol,
        side=payload.get("side", "buy"),
        order_type=payload.get("order_type", "market"),
        quantity=float(payload.get("quantity", 0)),
        limit_price=payload.get("limit_price"),
        sl_price=payload.get("sl_price"),
        status=VirtualOrderStatus.PENDING.value,
        slippage_bps=payload.get("slippage_bps", 5.0),
        commission=payload.get("commission", 0.0),
    )
    db.add(order)
    db.commit()
    db.refresh(order)

    # Fill immediately (market order)
    await get_paper_engine().maybe_fill_market_order_now(db, order)
    db.commit()
    db.refresh(order)

    return {
        "order_id": order.id,
        "status": order.status,
        "symbol": order.symbol,
        "fill_price": order.fill_price,
    }


def _confirm_alert(db: Session, p: AgentProposal) -> dict:
    from backend.models import AlertORM

    payload = p.payload
    alert = AlertORM(
        user_id=p.user_id,
        symbol=payload.get("symbol", ""),
        condition_type=payload.get("condition_type", "price_above"),
        parameters={"threshold": payload.get("threshold", 0)},
        status="active",
        delivery_channels=["in_app"],
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return {"alert_id": alert.id, "status": "created"}


def _confirm_watchlist_add(db: Session, p: AgentProposal) -> dict:
    from backend.models import WatchlistORM

    payload = p.payload
    symbol = str(payload.get("symbol", "")).strip().upper()

    if payload.get("watchlist_id"):
        wl = (
            db.query(WatchlistORM)
            .filter(WatchlistORM.id == payload["watchlist_id"])
            .first()
        )
    else:
        wl = (
            db.query(WatchlistORM)
            .filter(WatchlistORM.user_id == p.user_id)
            .order_by(WatchlistORM.created_at)
            .first()
        )

    if wl is None:
        raise ValueError("No watchlist found")

    symbols = list(wl.symbols_json) if isinstance(wl.symbols_json, list) else []
    if symbol not in symbols:
        symbols.append(symbol)
    wl.symbols_json = symbols
    db.commit()
    db.refresh(wl)
    return {"watchlist_id": wl.id, "symbol": symbol, "total_symbols": len(symbols)}


# ---------------------------------------------------------------------------
# Schema helpers
# ---------------------------------------------------------------------------

def _proposal_to_dict(p: AgentProposal) -> dict:
    return {
        "proposal_id": p.id,
        "user_id": p.user_id,
        "run_id": p.run_id,
        "type": p.type,
        "payload": p.payload,
        "summary": p.summary,
        "rationale": p.rationale,
        "status": p.status,
        "result": p.result,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "expires_at": p.expires_at.isoformat() if p.expires_at else None,
        "decided_at": p.decided_at.isoformat() if p.decided_at else None,
    }


# ---------------------------------------------------------------------------
# Tool specs for proposals
# ---------------------------------------------------------------------------

def _fmt_paper_order_summary(payload: dict) -> str:
    symbol = payload.get("symbol", "?")
    side = payload.get("side", "buy")
    qty = payload.get("quantity", "?")
    order_type = payload.get("order_type", "market")
    return f"Paper {side.upper()} {qty} {symbol} ({order_type})"


def _fmt_alert_summary(payload: dict) -> str:
    symbol = payload.get("symbol", "?")
    ctype = payload.get("condition_type", "?")
    threshold = payload.get("threshold", "?")
    return f"Alert {symbol} {ctype} {threshold}"


def _fmt_watchlist_summary(payload: dict) -> dict:
    symbol = payload.get("symbol", "?")
    return f"Add {symbol} to watchlist"


def proposal_tool_specs(
    user_id: str,
    run_id: str | None = None,
) -> list[ToolSpec]:
    """Return the three propose_* tool specs for *user_id*."""

    async def _propose_paper_order(args: dict) -> dict:
        symbol = str(args.get("symbol", "")).strip().upper()
        side = str(args.get("side", "buy")).strip().lower()
        if side not in ("buy", "sell"):
            return {"error": "side must be buy or sell"}
        quantity = args.get("quantity")
        if not isinstance(quantity, (int, float)) or quantity <= 0:
            return {"error": "quantity must be a positive number"}
        rationale = str(args.get("rationale", ""))
        payload = {
            "symbol": symbol,
            "side": side,
            "quantity": float(quantity),
            "order_type": str(args.get("order_type", "market")),
            "portfolio_id": args.get("portfolio_id"),
            "limit_price": args.get("limit_price"),
            "sl_price": args.get("sl_price"),
            "slippage_bps": args.get("slippage_bps", 5.0),
            "commission": args.get("commission", 0.0),
        }
        db = SessionLocal()
        try:
            summary = _fmt_paper_order_summary(payload)
            result = create_proposal(
                db, user_id, run_id, "paper_order", payload, summary, rationale,
            )
            return result
        finally:
            db.close()

    async def _propose_alert(args: dict) -> dict:
        symbol = str(args.get("symbol", "")).strip().upper()
        condition_type = str(args.get("condition_type", "price_above"))
        if condition_type not in ("price_above", "price_below"):
            return {"error": "condition_type must be price_above or price_below"}
        threshold = args.get("threshold")
        if not isinstance(threshold, (int, float)):
            return {"error": "threshold must be a number"}
        rationale = str(args.get("rationale", ""))
        payload = {
            "symbol": symbol,
            "condition_type": condition_type,
            "threshold": float(threshold),
        }
        db = SessionLocal()
        try:
            summary = _fmt_alert_summary(payload)
            return create_proposal(
                db, user_id, run_id, "alert", payload, summary, rationale,
            )
        finally:
            db.close()

    async def _propose_watchlist_add(args: dict) -> dict:
        symbol = str(args.get("symbol", "")).strip().upper()
        if not symbol:
            return {"error": "symbol is required"}
        rationale = str(args.get("rationale", ""))
        payload = {
            "symbol": symbol,
            "watchlist_id": args.get("watchlist_id"),
        }
        db = SessionLocal()
        try:
            summary = _fmt_watchlist_summary(payload)
            return create_proposal(
                db, user_id, run_id, "watchlist_add", payload, summary, rationale,
            )
        finally:
            db.close()

    return [
        ToolSpec(
            name="propose_paper_order",
            description="Propose a paper trade order. The order is NOT executed until the user confirms. "
            "Returns a pending proposal with proposal_id. Always include a rationale.",
            parameters={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "side": {"type": "string", "enum": ["buy", "sell"]},
                    "quantity": {"type": "number", "minimum": 0.001},
                    "order_type": {"type": "string", "default": "market", "enum": ["market", "limit", "sl"]},
                    "portfolio_id": {"type": "string"},
                    "limit_price": {"type": "number"},
                    "sl_price": {"type": "number"},
                    "slippage_bps": {"type": "number", "default": 5.0},
                    "commission": {"type": "number", "default": 0.0},
                    "rationale": {"type": "string"},
                },
                "required": ["symbol", "side", "quantity", "rationale"],
            },
            handler=_propose_paper_order,
            read_only=False,
            write_class="order",
        ),
        ToolSpec(
            name="propose_alert",
            description="Propose a price alert. The alert is NOT created until the user confirms. "
            "Returns a pending proposal with proposal_id.",
            parameters={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "condition_type": {"type": "string", "enum": ["price_above", "price_below"]},
                    "threshold": {"type": "number"},
                    "rationale": {"type": "string"},
                },
                "required": ["symbol", "condition_type", "threshold", "rationale"],
            },
            handler=_propose_alert,
            read_only=False,
            write_class="soft",
        ),
        ToolSpec(
            name="propose_watchlist_add",
            description="Propose adding a symbol to a watchlist. The change is NOT applied until the user confirms. "
            "Returns a pending proposal with proposal_id.",
            parameters={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "watchlist_id": {"type": "string"},
                    "rationale": {"type": "string"},
                },
                "required": ["symbol", "rationale"],
            },
            handler=_propose_watchlist_add,
            read_only=False,
            write_class="soft",
        ),
    ]