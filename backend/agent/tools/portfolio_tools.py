"""Portfolio-aware read-only tools for the agent.

Each handler opens ``SessionLocal()`` (from ``backend.shared.db``),
filters by ``user_id`` where the table has it, closes the session in
``finally``, and returns plain JSON-able dicts.
"""

from __future__ import annotations

from typing import Any

from backend.agent.tools.registry import ToolSpec
from backend.shared.db import SessionLocal

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _holdings_snapshot(user_id: str) -> dict[str, Any]:
    """Legacy ``holdings`` table has no user_id — return all rows."""
    from backend.db.models import Holding

    db = SessionLocal()
    try:
        holdings = db.query(Holding).all()
        total_cost = 0.0
        total_value = 0.0
        items = []
        for h in holdings:
            cost = float(h.quantity) * float(h.avg_buy_price)
            total_cost += cost
            cp = h.avg_buy_price  # no live price available in agent context
            value = float(h.quantity) * cp
            total_value += value
            pnl = value - cost
            items.append({
                "ticker": h.ticker,
                "quantity": h.quantity,
                "avg_buy_price": h.avg_buy_price,
                "current_price": cp,
                "pnl": round(pnl, 2) if pnl else None,
                "weight_pct": round(pnl / total_cost * 100, 2) if total_cost else None,
            })
        total_cost = round(total_cost, 2)
        total_value = round(total_value, 2)
        return {
            "items": items,
            "total_value": total_value,
            "total_cost": total_cost,
            "unrealized_pnl": round(total_value - total_cost, 2) if total_cost else None,
        }
    finally:
        db.close()


def _paper_positions(user_id: str) -> dict[str, Any]:
    from backend.models import VirtualPortfolio, VirtualPosition

    db = SessionLocal()
    try:
        mark_map = {}  # placeholder: mark prices not available here
        portfolios = (
            db.query(VirtualPortfolio)
            .filter(VirtualPortfolio.user_id == user_id)
            .all()
        )
        portfolio_items = []
        for p in portfolios:
            equity = p.current_cash  # simplified: equity ≈ cash
            portfolio_items.append({
                "id": p.id,
                "name": p.name,
                "cash": p.current_cash,
                "equity": round(equity, 2),
            })

        pos_rows = (
            db.query(VirtualPosition)
            .filter(VirtualPosition.portfolio_id.in_([p.id for p in portfolios]))
            .all()
        )
        position_items = []
        for pos in pos_rows:
            mark = mark_map.get(pos.symbol, pos.avg_entry_price)
            unrealized = round((mark - pos.avg_entry_price) * pos.quantity, 2)
            position_items.append({
                "portfolio_id": pos.portfolio_id,
                "symbol": pos.symbol,
                "quantity": pos.quantity,
                "avg_entry_price": pos.avg_entry_price,
                "mark_price": mark,
                "unrealized_pnl": unrealized,
            })
        return {"portfolios": portfolio_items, "positions": position_items}
    finally:
        db.close()


def _watchlists(user_id: str) -> dict[str, Any]:
    from backend.models import WatchlistORM

    db = SessionLocal()
    try:
        rows = (
            db.query(WatchlistORM)
            .filter(WatchlistORM.user_id == user_id)
            .all()
        )
        items = [
            {"id": r.id, "name": r.name, "symbols": list(r.symbols_json or [])}
            for r in rows
        ]
        return {"items": items}
    finally:
        db.close()


def _alerts(user_id: str, symbol: str | None = None) -> dict[str, Any]:
    from backend.models import AlertORM

    db = SessionLocal()
    try:
        q = db.query(AlertORM).filter(AlertORM.user_id == user_id)
        if symbol:
            sym_upper = symbol.strip().upper()
            suffix = sym_upper.split(":", 1)[-1]
            from sqlalchemy import or_
            q = q.filter(
                or_(
                    AlertORM.symbol == sym_upper,
                    AlertORM.symbol == suffix,
                    AlertORM.symbol.like(f"%:{suffix}"),
                )
            )
        rows = q.all()
        items = []
        for r in rows:
            params = r.parameters if isinstance(r.parameters, dict) else {}
            items.append({
                "id": r.id,
                "symbol": r.symbol,
                "condition_type": r.condition_type,
                "parameters": params,
                "status": r.status,
            })
        return {"items": items}
    finally:
        db.close()


async def _upcoming_events(user_id: str, symbols: list[str] | None = None, days: int = 30) -> dict[str, Any]:
    from backend.services.events_hub import get_upcoming_events

    syms = symbols or []
    return await get_upcoming_events(symbols=syms, days=days)


async def _provider_status(user_id: str) -> dict[str, Any]:
    from backend.api.routes.providers import providers_status

    return await providers_status()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def portfolio_tool_specs(user_id: str) -> list[ToolSpec]:
    """Return the six read-only portfolio-aware tool specs for *user_id*."""

    def _get_portfolio(args: dict[str, Any]) -> dict[str, Any]:
        # read-only; user_id scoping handled by caller (legacy holdings have no user_id → all rows)
        return _holdings_snapshot(user_id)

    def _get_paper_positions(args: dict[str, Any]) -> dict[str, Any]:
        return _paper_positions(user_id)

    def _get_watchlists(args: dict[str, Any]) -> dict[str, Any]:
        return _watchlists(user_id)

    def _get_alerts(args: dict[str, Any]) -> dict[str, Any]:
        symbol = args.get("symbol")
        return _alerts(user_id, symbol=symbol)

    async def _get_upcoming_events_handler(args: dict[str, Any]) -> dict[str, Any]:
        symbols = args.get("symbols", [])
        days = args.get("days", 30)
        return await _upcoming_events(user_id, symbols=symbols, days=days)

    async def _get_provider_status_handler(args: dict[str, Any]) -> dict[str, Any]:
        return await _provider_status(user_id)

    return [
        ToolSpec(
            name="get_portfolio",
            description="Return the user's current portfolio holdings (legacy holdings table). "
            "Returns items with ticker, quantity, avg_buy_price, current_price, pnl, weight_pct "
            "plus total_value, total_cost, unrealized_pnl. Note: the legacy holdings table has "
            "no user_id — this returns all rows.",
            parameters={"type": "object", "properties": {}},
            handler=_get_portfolio,
            read_only=True,
            write_class="none",
        ),
        ToolSpec(
            name="get_paper_positions",
            description="Return paper-trading portfolios and positions for the user. "
            "Returns portfolios (id, name, cash, equity) and positions "
            "(portfolio_id, symbol, quantity, avg_entry_price, mark_price, unrealized_pnl).",
            parameters={"type": "object", "properties": {}},
            handler=_get_paper_positions,
            read_only=True,
            write_class="none",
        ),
        ToolSpec(
            name="get_watchlists",
            description="Return the user's watchlists. Each watchlist has id, name, and symbols[].",
            parameters={"type": "object", "properties": {}},
            handler=_get_watchlists,
            read_only=True,
            write_class="none",
        ),
        ToolSpec(
            name="get_alerts",
            description="Return the user's price alerts, optionally filtered by symbol. "
            "Returns items with id, symbol, condition_type, parameters, status.",
            parameters={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Optional symbol filter."},
                },
            },
            handler=_get_alerts,
            read_only=True,
            write_class="none",
        ),
        ToolSpec(
            name="get_upcoming_events",
            description="Return upcoming corporate/earnings/expiry/macro events for the given symbols.",
            parameters={
                "type": "object",
                "properties": {
                    "symbols": {"type": "array", "items": {"type": "string"}, "default": []},
                    "days": {"type": "integer", "default": 30},
                },
            },
            handler=_get_upcoming_events_handler,
            read_only=True,
            write_class="none",
        ),
        ToolSpec(
            name="get_provider_status",
            description="Return the configured data-provider status dict (same as /api/providers/status).",
            parameters={"type": "object", "properties": {}},
            handler=_get_provider_status_handler,
            read_only=True,
            write_class="none",
        ),
    ]