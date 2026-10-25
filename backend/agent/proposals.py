"""Proposal CRUD and proposal tool specs (C14).

Proposals are *never* executed by the agent — they wait for user confirmation.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4
import math

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

    # A decided action keeps its audit status even after its original expiry.
    if p.status != "pending":
        raise ValueError("not_pending")

    # Expired check
    if p.expires_at < now:
        p.status = "expired"
        p.decided_at = now
        db.commit()
        raise ValueError("expired")

    # Claim atomically: the executors await (market fill), so a second confirm
    # of the same proposal could otherwise pass the pending check and run twice.
    claimed = (
        db.query(AgentProposal)
        .filter(AgentProposal.id == p.id, AgentProposal.status == "pending")
        .update({"status": "executing", "decided_at": now}, synchronize_session=False)
    )
    db.commit()
    if not claimed:
        raise ValueError("not_pending")
    db.refresh(p)
    result: dict = {}

    try:
        if p.type == "paper_order":
            result = await _confirm_paper_order(db, p)
        elif p.type == "alert":
            result = _confirm_alert(db, p)
        elif p.type == "watchlist_add":
            result = _confirm_watchlist_add(db, p)
        elif p.type == "watchlist_remove":
            result = _confirm_watchlist_remove(db, p)
        elif p.type == "journal_entry":
            result = _confirm_journal_note(db, p)
        elif p.type == "rebalance":
            result = await _confirm_rebalance(db, p)
        elif p.type == "screener_alert":
            result = _confirm_screen_alert(db, p)
        else:
            # Unknown extension actions must not be represented as executed.
            result = {"error": f"no executor for proposal type: {p.type}"}
            p.status = "failed"
    except Exception as exc:  # noqa: BLE001
        result = {"error": str(exc)}
        p.status = "failed"

    if p.status == "executing":
        p.status = "confirmed"
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
    if p.status != "pending":
        raise ValueError("not_pending")
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
            .filter(WatchlistORM.id == payload["watchlist_id"], WatchlistORM.user_id == p.user_id)
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


async def _confirm_rebalance(db: Session, p: AgentProposal) -> dict:
    """Fill all reviewed legs in one paper-only database transaction."""
    from sqlalchemy import update
    from backend.models import VirtualPortfolio, VirtualPosition, VirtualOrder, VirtualTrade
    from backend.agent.tools.action_tools import _mark_prices
    payload = p.payload
    baseline = payload.get("portfolio_snapshot")
    legs = payload.get("deltas")
    if not isinstance(baseline, dict) or not isinstance(legs, list):
        raise ValueError("This preview lacks a portfolio snapshot; generate a new proposal")
    if not legs or len(legs) > 100:
        raise ValueError("Rebalance must contain between one and 100 legs")
    symbols = [str(leg.get("symbol", "")) for leg in legs]
    if len(set(symbols)) != len(symbols):
        raise ValueError("Duplicate rebalance symbols")
    prices, provenance = await _mark_prices(symbols)
    for leg in legs:
        symbol = str(leg.get("symbol", ""))
        price = prices.get(symbol)
        preview_price = float(leg.get("price_used") or 0)
        qty = float(leg.get("implied_delta_qty") or 0)
        if price is None or not math.isfinite(price) or price <= 0 or preview_price <= 0 or not math.isfinite(qty):
            raise ValueError("Missing usable price or quantity; generate a new proposal")
        if abs(price / preview_price - 1) > 0.01:
            raise ValueError("Quote moved more than 1% since review; generate a new proposal")
    portfolio_id = str(payload.get("portfolio_id") or "")
    expected_cash = float(baseline.get("cash", -1))
    if not math.isfinite(expected_cash) or expected_cash < 0:
        raise ValueError("Invalid portfolio snapshot")
    orders = []
    with db.begin_nested():
        # Conditional write locks the paper portfolio in SQLite and PostgreSQL.
        locked = db.execute(update(VirtualPortfolio).where(
            VirtualPortfolio.id == portfolio_id, VirtualPortfolio.user_id == p.user_id,
            VirtualPortfolio.current_cash == expected_cash,
        ).values(current_cash=expected_cash)).rowcount
        if not locked:
            raise ValueError("Paper portfolio changed or is unavailable; generate a new proposal")
        portfolio = db.query(VirtualPortfolio).filter_by(id=portfolio_id, user_id=p.user_id).populate_existing().one()
        positions = db.query(VirtualPosition).filter_by(portfolio_id=portfolio_id).populate_existing().all()
        actual = {pos.symbol: float(pos.quantity) for pos in positions}
        expected = {str(k): float(v) for k, v in baseline.get("positions", {}).items()}
        if set(actual) != set(expected) or any(abs(actual[k] - expected[k]) > 1e-8 for k in actual):
            raise ValueError("Paper positions changed; generate a new proposal")
        # Sell first, then buy. Quantities are exactly those shown in the proposal.
        for leg in sorted(legs, key=lambda row: float(row.get("implied_delta_qty") or 0)):
            delta = float(leg.get("implied_delta_qty") or 0)
            if abs(delta) < 1e-8:
                continue
            symbol = leg["symbol"]
            side = "buy" if delta > 0 else "sell"
            qty = abs(delta)
            if side == "sell" and qty > actual.get(symbol, 0) + 1e-8:
                raise ValueError("Rebalance would sell more than the paper holding")
            old_cost = next((float(pos.avg_entry_price) for pos in positions if pos.symbol == symbol), 0)
            fill_price = prices[symbol] * (1.0005 if side == "buy" else 0.9995)
            commission = qty * fill_price * 0.0005
            order = VirtualOrder(portfolio_id=portfolio_id, symbol=symbol, side=side, order_type="market",
                quantity=qty, status="pending", slippage_bps=5.0, commission=commission,
                signal_metadata={"agent_proposal_id": p.id, "valuation_provenance": provenance.get(symbol), "paper_only": True})
            db.add(order); db.flush()
            get_paper_engine()._fill_order(db, order, prices[symbol])
            db.flush()
            if order.status != "filled":
                raise ValueError("Paper rebalance cannot be fully funded after fees; no legs were executed")
            if side == "sell":
                trade = db.query(VirtualTrade).filter_by(order_id=order.id).one()
                trade.pnl_realized = (float(order.fill_price) - old_cost) * qty - commission
            orders.append({"order_id": order.id, "symbol": symbol, "side": side, "quantity": qty,
                           "fill_price": order.fill_price, "commission": commission})
        db.flush()
        if portfolio.current_cash < -1e-8:
            raise ValueError("Paper rebalance would overdraw cash")
        cash = float(portfolio.current_cash)
    return {"portfolio_id": portfolio_id, "paper_only": True, "orders": orders, "remaining_cash": cash}


def _confirm_screen_alert(db: Session, p: AgentProposal) -> dict:
    from backend.agent.screen_alerts import validate_criteria
    from backend.models import AlertORM
    criteria = validate_criteria(p.payload.get("criteria"), p.payload.get("frequency", "on_match"))
    alert_ids = []
    with db.begin_nested():
        for symbol in criteria["symbols"]:
            alert = AlertORM(user_id=p.user_id, symbol=symbol, condition_type="multi_condition", status="active",
                parameters={"name": p.payload.get("name"), "source": "agent_screen_results", "proposal_id": p.id},
                conditions=criteria["conditions"], logic=criteria["logic"], delivery_channels=["in_app"],
                cooldown_minutes=15)
            db.add(alert); db.flush()
            alert_ids.append(alert.id)
    return {"alert_ids": alert_ids, "status": "created", "evaluation": "on market ticks", "symbols": criteria["symbols"]}


def _confirm_watchlist_remove(db: Session, p: AgentProposal) -> dict:
    from backend.models import WatchlistORM
    wl = db.query(WatchlistORM).filter_by(id=p.payload.get("watchlist_id"), user_id=p.user_id).first()
    if wl is None:
        raise ValueError("Watchlist unavailable")
    remove = {str(s).strip().upper() for s in p.payload.get("symbols", [])}
    previous = list(wl.symbols_json or [])
    wl.symbols_json = [s for s in previous if str(s).upper() not in remove]
    db.flush()
    return {"watchlist_id": wl.id, "removed": [s for s in previous if str(s).upper() in remove],
            "total_symbols": len(wl.symbols_json)}


def _confirm_journal_note(db: Session, p: AgentProposal) -> dict:
    # The proposal contains research prose, not trade fills. Preserve it as a
    # research note instead of inventing entry prices/quantities for a trade journal.
    from backend.agent.memory import add_note
    title = str(p.payload.get("title", "")).strip()
    body = str(p.payload.get("body", "")).strip()
    if not title or not body:
        raise ValueError("Research note title and body are required")
    content = title + "\n\n" + body
    tags = p.payload.get("tags") or []
    if tags:
        content += "\n\nTags: " + ", ".join(str(t) for t in tags)
    note = add_note(db, p.user_id, p.payload.get("ticker") or "", "note", content, "agent_proposal")
    return {"note_id": note["id"], "status": "saved", "destination": "research_memory"}


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