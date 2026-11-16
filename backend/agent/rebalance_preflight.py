"""Pure cash/position simulation of a reviewed multi-leg paper rebalance."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import and_, or_, update

from backend.agent.tools import action_tools
from backend.agent.tools.sizing_tools import _has_ambiguous_aliases, _number
from backend.agent.trade_preflight import _book, _cost, checked_fill, get_risk_policy
from backend.models import VirtualOrder, VirtualPortfolio
from backend.models.agent_proposals import AgentProposal
from backend.models.agent_risk_policy import AgentRiskPolicy
from backend.paper_trading.currency import convert_marked_prices, validate_quote_source


async def preview_rebalance(db, user_id: str, payload: dict, *, exclude_proposal_id: str | None = None,
                            valuation: tuple | None = None) -> dict:
    row = db.query(AgentRiskPolicy).filter_by(user_id=user_id).with_for_update().populate_existing().first()
    policy = dict(row.policy) if row else get_risk_policy(db, user_id)
    if not policy["enabled"]:
        raise ValueError("Guarded rebalance requires enabled saved risk limits")
    portfolio = db.query(VirtualPortfolio).filter_by(id=payload.get("portfolio_id"), user_id=user_id).populate_existing().first()
    if portfolio is None or not portfolio.is_active:
        raise ValueError("Owned active paper portfolio required")
    db.execute(update(VirtualPortfolio).where(VirtualPortfolio.id == portfolio.id)
               .values(current_cash=VirtualPortfolio.current_cash))
    db.refresh(portfolio)
    cash, positions, details = _book(db, portfolio)
    if db.query(VirtualOrder).filter(VirtualOrder.portfolio_id == portfolio.id,
                    VirtualOrder.status.in_(["pending", "open", "partially_filled"])).first():
        raise ValueError("Settle or cancel pending orders before a guarded rebalance")
    now = datetime.now(timezone.utc)
    pending = db.query(AgentProposal).filter(AgentProposal.user_id == user_id,
        AgentProposal.type.in_(["paper_order", "rebalance"]),
        or_(AgentProposal.status == "executing", and_(AgentProposal.status == "pending",
            AgentProposal.expires_at > now.replace(tzinfo=None)))).all()
    for proposal in pending:
        if proposal.id != exclude_proposal_id and proposal.payload.get("portfolio_id") in {None, portfolio.id}:
            raise ValueError("Resolve pending proposals before a guarded rebalance")
    legs = payload.get("deltas")
    if not isinstance(legs, list) or not 1 <= len(legs) <= 50:
        raise ValueError("Rebalance requires one to 50 reviewed legs")
    names = [leg.get("symbol") for leg in legs]
    if any(not isinstance(s, str) or not s.strip() for s in names) or len(set(names)) != len(names):
        raise ValueError("Invalid or duplicate rebalance symbols")
    symbols = sorted(set(names) | set(positions))
    if len(symbols) > 50 or _has_ambiguous_aliases(symbols):
        raise ValueError("Ambiguous or oversized rebalance universe")
    marks, sources = (valuation[0], valuation[1]) if valuation else await action_tools._mark_prices(symbols)
    quotes = {}
    for symbol in symbols:
        quotes[symbol] = _number(marks.get(symbol), f"quote for {symbol}")
        validate_quote_source(sources.get(symbol, {}), policy["max_quote_age_seconds"], symbol=symbol)
    if valuation:
        prices = {s: _number(valuation[2].get(s), f"base quote for {s}") for s in symbols}
        fx = valuation[3]
        for symbol, conversion in fx.items():
            if conversion["base_currency"] != portfolio.base_currency:
                raise ValueError("Paper base currency changed while valuing rebalance")
            if conversion.get("pair"):
                validate_quote_source(conversion["provenance"], policy["max_quote_age_seconds"], symbol=conversion["pair"])
    else:
        prices, fx = await convert_marked_prices(quotes, sources, portfolio.base_currency,
                                               policy["max_quote_age_seconds"], action_tools._mark_prices)
    if get_risk_policy(db, user_id) != policy:
        raise ValueError("Risk policy changed while valuing rebalance")
    from backend.paper_trading.currency import require_verified_foreign_basis
    require_verified_foreign_basis(db, portfolio.id, [s for s, row in fx.items() if row["quote_currency"] != portfolio.base_currency])
    initial = payload.get("portfolio_snapshot") or {}
    if initial.get("cash") != float(cash) or initial.get("positions") != {s: float(q) for s, q in positions.items()}:
        raise ValueError("Paper book changed while valuing rebalance")
    equity = cash + sum((q * prices[s] for s, q in positions.items()), Decimal(0))
    if equity <= 0:
        raise ValueError("Positive marked equity required")
    stops = payload.get("risk_stops") or {}
    if not isinstance(stops, dict):
        raise ValueError("risk_stops must map symbols to hypothetical stop prices")
    orders = []
    for leg in legs:
        delta = leg.get("implied_delta_qty")
        if isinstance(delta, bool) or not isinstance(delta, (int, float)):
            raise ValueError("Invalid reviewed rebalance quantity")
        if delta == 0:
            continue
        quantity = _number(abs(delta), "rebalance quantity")
        orders.append({"symbol": leg["symbol"], "side": "buy" if delta > 0 else "sell", "quantity": float(quantity),
                       "order_type": "market", "slippage_bps": 5.0, "commission": 0.0,
                       "stop_price": stops.get(leg["symbol"]), "portfolio_id": portfolio.id})
    if not orders:
        raise ValueError("Rebalance has no nonzero trades")
    working = dict(positions)
    working_cash = cash
    risk = Decimal(0)
    estimates = []
    for order in sorted(orders, key=lambda o: o["side"] == "buy"):
        symbol, side = order["symbol"], order["side"]
        quantity = Decimal(str(order["quantity"]))
        notional, fee = _cost(prices[symbol], quantity, order)
        if side == "sell":
            if quantity > working.get(symbol, Decimal(0)) or fee > notional:
                raise ValueError("Rebalance would oversell or cannot fund sell costs")
            working[symbol] -= quantity
            working_cash += notional - fee
        else:
            if notional + fee > working_cash:
                raise ValueError("Rebalance cannot fund all legs after costs")
            stop = order["stop_price"]
            if stop is None and policy["require_stop"]:
                raise ValueError(f"risk_stops must include a hypothetical buy stop for {symbol}")
            if stop is not None:
                stop = _number(stop, f"stop for {symbol}")
                if stop >= quotes[symbol]:
                    raise ValueError("Buy stops must be below marked quotes")
                risk += (quotes[symbol] - stop) * quantity * Decimal(str(fx[symbol]["rate"]))
            working[symbol] = working.get(symbol, Decimal(0)) + quantity
            working_cash -= notional + fee
        estimates.append({**order, "notional": float(notional), "commission": float(fee)})
    after_equity = working_cash + sum((q * prices[s] for s, q in working.items()), Decimal(0))
    if risk > equity * Decimal(str(policy["risk_budget_pct"])) / 100:
        raise ValueError("Combined rebalance buy risk exceeds saved stop-risk budget")
    bought = {order["symbol"] for order in orders if order["side"] == "buy"}
    for symbol in bought:
        if after_equity <= 0 or working[symbol] * prices[symbol] / after_equity * 100 > Decimal(str(policy["max_position_pct"])):
            raise ValueError("Rebalance exceeds saved position concentration")
    return {"policy": policy, "snapshot": {"cash": float(cash), "positions": details, "base_currency": portfolio.base_currency},
            "portfolio_id": portfolio.id, "prices": {s: float(p) for s, p in quotes.items()},
            "base_prices": {s: float(p) for s, p in prices.items()}, "fx": fx, "quote_provenance": sources,
            "base_currency": portfolio.base_currency, "orders": estimates, "order_plan": orders,
            "target_weights": payload.get("target_weights"), "estimated_cash_after": float(working_cash),
            "combined_stop_risk": float(risk), "marked_equity": float(equity), "valued_at": now.isoformat()}


async def execute_rebalance(db, proposal, engine) -> dict:
    baseline = proposal.payload.get("risk_preflight")
    if not isinstance(baseline, dict):
        raise ValueError("Saved risk policy requires a new reviewed rebalance")
    with db.begin_nested():
        current = await preview_rebalance(db, proposal.user_id, proposal.payload, exclude_proposal_id=proposal.id)
        for key in ("policy", "snapshot", "portfolio_id", "order_plan", "target_weights"):
            if current[key] != baseline.get(key):
                raise ValueError(f"Rebalance {key} changed; generate a new proposal")
        tolerance = Decimal(str(current["policy"]["max_quote_drift_pct"])) / 100
        for symbol, price in current["prices"].items():
            old_price = _number(baseline.get("prices", {}).get(symbol), "reviewed quote")
            old_fx = _number(baseline.get("fx", {}).get(symbol, {}).get("rate"), "reviewed FX")
            if abs(Decimal(str(price)) / old_price - 1) > tolerance or abs(Decimal(str(current["fx"][symbol]["rate"])) / old_fx - 1) > tolerance:
                raise ValueError("Rebalance quote or FX moved beyond reviewed tolerance")
        filled = []
        for payload in sorted(current["order_plan"], key=lambda o: o["side"] == "buy"):
            order = VirtualOrder(portfolio_id=current["portfolio_id"], symbol=payload["symbol"], side=payload["side"],
                    order_type="market", quantity=payload["quantity"], slippage_bps=5, commission=0, status="pending",
                    signal_metadata={"agent_proposal_id": proposal.id, "paper_only": True, "rebalance_risk": current})
            db.add(order)
            db.flush()
            checked_fill(db, order, engine, current)
            db.flush()
            if order.status != "filled":
                raise ValueError("Rebalance leg failed; every fill rolled back")
            filled.append({"order_id": order.id, "symbol": order.symbol, "quantity": order.quantity,
                           "side": order.side, "fill_price": order.fill_price, "commission": order.commission})
    return {"paper_only": True, "portfolio_id": current["portfolio_id"], "base_currency": current["base_currency"],
            "orders": filled, "preflight": current}
