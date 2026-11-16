"""Deterministic checks shared by proposal creation and atomic confirmation.

Policies are configured by authenticated HTTP requests, never by an LLM tool.
Enabled policies support long-only market, limit and stop-trigger paper trades.
Orders and proposals reserve capacity; every delayed fill repeats current checks.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import math

from sqlalchemy import and_, or_, update

from backend.agent.tools import action_tools
from backend.agent.tools.sizing_tools import _has_ambiguous_aliases, _number
from backend.models import VirtualOrder, VirtualPortfolio, VirtualPosition
from backend.models.agent_proposals import AgentProposal
from backend.models.agent_risk_policy import AgentRiskPolicy


DEFAULT_POLICY = {"enabled": False, "max_position_pct": 20.0, "risk_budget_pct": 1.0,
                  "require_stop": True, "max_quote_drift_pct": 1.0, "max_quote_age_seconds": 3600}


def get_risk_policy(db, user_id: str) -> dict:
    row = db.get(AgentRiskPolicy, user_id, populate_existing=True)
    return dict(row.policy) if row else dict(DEFAULT_POLICY)


def set_risk_policy(db, user_id: str, policy: dict) -> dict:
    if not isinstance(policy, dict) or set(policy) - set(DEFAULT_POLICY):
        raise ValueError("Unknown risk policy fields")
    result = {**get_risk_policy(db, user_id), **policy}
    for field in ("enabled", "require_stop"):
        if not isinstance(result[field], bool):
            raise ValueError(f"{field} must be boolean")
    for field, maximum in (("max_position_pct", 100), ("risk_budget_pct", 5),
                           ("max_quote_drift_pct", 10), ("max_quote_age_seconds", 86400)):
        try:
            value = _number(result[field], field)
            if value > maximum:
                raise ValueError(f"{field} must be <= {maximum}")
            result[field] = float(value)
        except (OverflowError, TypeError) as exc:
            raise ValueError(f"Invalid {field}") from exc
    row = db.get(AgentRiskPolicy, user_id)
    if row is None:
        db.add(AgentRiskPolicy(user_id=user_id, policy=result))
    else:
        row.policy = result
    db.commit()
    return dict(result)


def _cost(price: Decimal, quantity: Decimal, payload: dict) -> tuple[Decimal, Decimal]:
    slip = _number(payload.get("slippage_bps", 5), "slippage_bps", allow_zero=True)
    if slip > 1000:
        raise ValueError("slippage_bps must be <=1000 for guarded orders")
    commission = _number(payload.get("commission", 0), "commission", allow_zero=True)
    fill = price * (1 + slip / 10000 if payload.get("side") == "buy" else 1 - slip / 10000)
    notional = quantity * fill
    fee = commission if commission else notional * Decimal("0.0005")
    return notional, fee


def _book(db, portfolio) -> tuple[Decimal, dict, dict]:
    cash = _number(portfolio.current_cash, "cash", allow_zero=True)
    positions, details = {}, {}
    for row in db.query(VirtualPosition).filter_by(portfolio_id=portfolio.id).populate_existing().all():
        if row.side != "long":
            raise ValueError("Guarded paper trades require a long-only portfolio")
        quantity = _number(row.quantity, "holding quantity", allow_zero=True)
        _number(row.avg_entry_price, "holding cost basis", allow_zero=True)
        name = row.symbol.strip().upper()
        if not name or name in positions:
            raise ValueError("Invalid or duplicate position symbols")
        positions[name] = quantity
        details[name] = {"quantity": float(quantity), "side": row.side, "avg_entry_price": row.avg_entry_price}
    return cash, positions, details


def _execution_reference(payload: dict, marked_price: Decimal, policy: dict, *, executing: bool = False) -> Decimal:
    if executing or payload.get("order_type", "market") == "market":
        return marked_price
    order_type = payload.get("order_type")
    price = _number(payload.get("limit_price" if order_type == "limit" else "sl_price"), "order trigger price")
    if order_type == "sl":
        collar = Decimal(str(policy["max_quote_drift_pct"])) / 100
        return price * (1 + collar if payload["side"] == "buy" else 1 - collar)
    return price


async def build_preflight(db, user_id: str, payload: dict, *, exclude_proposal_id: str | None = None,
                         exclude_order_id: str | None = None, executing: bool = False) -> dict:
    """Return an auditable preview, retaining a portfolio write lock until commit."""
    policy_row = db.query(AgentRiskPolicy).filter_by(user_id=user_id).with_for_update().populate_existing().first()
    policy = dict(policy_row.policy) if policy_row else dict(DEFAULT_POLICY)
    if not policy["enabled"]:
        raise ValueError("Paper trade risk policy is disabled")
    if payload.get("order_type", "market") not in {"market", "limit", "sl"}:
        raise ValueError("Unsupported paper order type")
    side = payload.get("side")
    if side not in ("buy", "sell"):
        raise ValueError("side must be buy or sell")
    symbol = payload.get("symbol")
    if not isinstance(symbol, str) or not symbol.strip() or len(symbol) > 64:
        raise ValueError("Invalid symbol")
    symbol = symbol.strip().upper()
    quantity = _number(payload.get("quantity"), "quantity")
    requested_book = payload.get("portfolio_id")
    if requested_book is not None and (not isinstance(requested_book, str) or not requested_book.strip()):
        raise ValueError("portfolio_id must be a non-empty string")
    query = db.query(VirtualPortfolio).filter_by(user_id=user_id)
    if payload.get("portfolio_id"):
        query = query.filter_by(id=payload["portfolio_id"])
    portfolio = query.order_by(VirtualPortfolio.created_at, VirtualPortfolio.id).populate_existing().first()
    if portfolio is None or not portfolio.is_active:
        raise ValueError("Owned active paper portfolio required")
    # Conditional update serializes proposals and confirmations for this book.
    db.execute(update(VirtualPortfolio).where(VirtualPortfolio.id == portfolio.id,
               VirtualPortfolio.user_id == user_id).values(current_cash=VirtualPortfolio.current_cash))
    db.refresh(portfolio)
    if not portfolio.is_active:
        raise ValueError("Owned active paper portfolio required")
    cash, positions, details = _book(db, portfolio)
    orders = db.query(VirtualOrder).filter(VirtualOrder.portfolio_id == portfolio.id,
                VirtualOrder.status.in_(["pending", "open", "partially_filled"])).populate_existing().all()
    reserved = []
    for order in orders:
        if order.id == exclude_order_id:
            continue
        previous = (order.signal_metadata or {}).get("risk_order")
        if not isinstance(previous, dict):
            raise ValueError("Cancel or settle legacy pending paper orders before guarded trades")
        reserved.append(previous)
    now = datetime.now(timezone.utc)
    pending = db.query(AgentProposal).filter(AgentProposal.user_id == user_id,
                AgentProposal.type.in_(["paper_order", "rebalance"]),
                or_(AgentProposal.status == "executing", and_(AgentProposal.status == "pending",
                    AgentProposal.expires_at > now.replace(tzinfo=None)))).populate_existing().all()
    for proposal in pending:
        if proposal.id == exclude_proposal_id:
            continue
        previous = proposal.payload
        if previous.get("portfolio_id") != portfolio.id:
            # Unresolved legacy books may resolve to this same default book.
            if previous.get("portfolio_id"):
                continue
            raise ValueError("Resolve unscoped pending paper proposals before guarded trades")
        if proposal.type != "paper_order" or not isinstance(previous.get("preflight"), dict):
            raise ValueError("Resolve pending legacy or rebalance proposals before guarded trades")
        reserved.append(previous)
    symbols = sorted({symbol, *positions, *(p["symbol"] for p in reserved)})
    if len(symbols) > 50 or _has_ambiguous_aliases(symbols):
        raise ValueError("Too many symbols or ambiguous aliases in paper exposure")
    marks, provenance = await action_tools._mark_prices(symbols)
    now = datetime.now(timezone.utc)
    if get_risk_policy(db, user_id) != policy:
        raise ValueError("Paper risk policy changed while obtaining quotes; retry proposal")
    prices = {}
    from backend.paper_trading.currency import convert_marked_prices, validate_quote_source
    for name in symbols:
        prices[name] = _number(marks.get(name), f"marked price for {name}")
        validate_quote_source(provenance.get(name, {}), policy["max_quote_age_seconds"], symbol=name)
    base_prices, fx = await convert_marked_prices(prices, provenance, portfolio.base_currency,
                        policy["max_quote_age_seconds"], action_tools._mark_prices)
    from backend.paper_trading.currency import require_verified_foreign_basis
    require_verified_foreign_basis(db, portfolio.id, [s for s, row in fx.items() if row["quote_currency"] != portfolio.base_currency])
    if get_risk_policy(db, user_id) != policy:
        raise ValueError("Paper risk policy changed while obtaining FX quotes; retry proposal")
    equity = cash + sum((q * base_prices[name] for name, q in positions.items()), Decimal(0))
    if not math.isfinite(float(equity)) or equity <= 0:
        raise ValueError("Positive finite marked equity required")
    reserved_cash = Decimal(0)
    reserved_risk = Decimal(0)
    reserved_buys = Decimal(0)
    reserved_sells = Decimal(0)
    reserved_fees = Decimal(0)
    for previous in reserved:
        q = _number(previous["quantity"], "reserved quantity")
        name = previous["symbol"]
        mark = _execution_reference(previous, prices[name], policy)
        rate = Decimal(str(fx[name]["rate"]))
        notional, fee = _cost(mark * rate, q, previous)
        if previous["side"] == "buy":
            reserved_cash += notional + fee
            reserved_fees += max(Decimal(0), notional - q * base_prices[name]) + fee
            stop = previous.get("stop_price")
            if stop is not None:
                reserved_risk += max(Decimal(0), mark - _number(stop, "reserved stop")) * q * rate
            if previous["symbol"] == symbol:
                reserved_buys += q
        elif previous["symbol"] == symbol:
            reserved_sells += q
    quote_price = _execution_reference(payload, prices[symbol], policy, executing=executing)
    rate = Decimal(str(fx[symbol]["rate"]))
    price = quote_price * rate
    notional, fee = _cost(price, quantity, payload)
    stop_loss = None
    if side == "buy":
        if notional + fee > cash - reserved_cash:
            raise ValueError("Trade exceeds available cash after costs and pending proposals")
        post_equity = equity - reserved_fees - (notional - quantity * price) - fee
        exposure = (positions.get(symbol, Decimal(0)) + reserved_buys) * base_prices[symbol] + quantity * price
        if post_equity <= 0 or exposure / post_equity * 100 > Decimal(str(policy["max_position_pct"])):
            raise ValueError("Trade exceeds maximum position concentration")
        stop = payload.get("stop_price")
        if stop is None and policy["require_stop"]:
            raise ValueError("stop_price is required by the paper risk policy")
        if stop is not None:
            stop = _number(stop, "stop_price")
            if stop >= quote_price:
                raise ValueError("stop_price must be below marked buy price")
            stop_loss = (quote_price - stop) * quantity * rate
            if stop_loss + reserved_risk > equity * Decimal(str(policy["risk_budget_pct"])) / 100:
                raise ValueError("Trade exceeds stop-risk budget including pending proposals")
    else:
        if quantity > positions.get(symbol, Decimal(0)) - reserved_sells:
            raise ValueError("Trade would oversell owned shares after pending proposals")
        if fee > notional:
            raise ValueError("Commission exceeds sell proceeds; unsupported by the paper engine")
    return {"policy": policy, "portfolio_id": portfolio.id,
            "portfolio_snapshot": {"cash": float(cash), "positions": details, "base_currency": portfolio.base_currency},
            "prices": {name: float(p) for name, p in prices.items()}, "quote_provenance": provenance,
            "base_prices": {name: float(p) for name, p in base_prices.items()}, "fx": fx,
            "risk_reference_price": float(quote_price), "base_currency": portfolio.base_currency,
            "valued_at": now.isoformat(), "estimated_notional": float(notional), "estimated_commission": float(fee),
            "marked_equity": float(equity), "reserved_cash": float(reserved_cash),
            "estimated_stop_loss": float(stop_loss) if stop_loss is not None else None,
            "order": {key: payload.get(key) for key in ("symbol", "side", "quantity", "order_type", "stop_price", "limit_price", "sl_price", "slippage_bps", "commission")}}


async def confirm_guarded_order(db, proposal, engine) -> dict:
    payload = proposal.payload
    baseline = payload.get("preflight")
    if not isinstance(baseline, dict):
        raise ValueError("Risk policy requires a new proposal with preflight review")
    with db.begin_nested():
        current = await build_preflight(db, proposal.user_id, payload, exclude_proposal_id=proposal.id)
        for key in ("policy", "portfolio_snapshot", "portfolio_id", "order"):
            if current[key] != baseline.get(key):
                raise ValueError(f"Paper {key} changed; create a new proposal for review")
        tolerance = Decimal(str(current["policy"]["max_quote_drift_pct"])) / 100
        for symbol, price in current["prices"].items():
            old = _number(baseline.get("prices", {}).get(symbol), "reviewed quote")
            if abs(Decimal(str(price)) / old - 1) > tolerance:
                raise ValueError("Quote moved beyond reviewed tolerance; create a new proposal")
            old_fx = _number(baseline.get("fx", {}).get(symbol, {}).get("rate"), "reviewed FX rate")
            if abs(Decimal(str(current["fx"][symbol]["rate"])) / old_fx - 1) > tolerance:
                raise ValueError("FX rate moved beyond reviewed tolerance; create a new proposal")
        order = VirtualOrder(portfolio_id=current["portfolio_id"], symbol=payload["symbol"],
                side=payload["side"], order_type=payload.get("order_type", "market"), quantity=payload["quantity"],
                limit_price=payload.get("limit_price"), sl_price=payload.get("sl_price"),
                slippage_bps=payload.get("slippage_bps", 5), commission=payload.get("commission", 0),
                status="pending", signal_metadata={"agent_proposal_id": proposal.id, "preflight": current,
                    "risk_order": {k: v for k, v in payload.items() if k != "preflight"}, "paper_only": True})
        old_cost = current["portfolio_snapshot"]["positions"].get(payload["symbol"], {}).get("avg_entry_price", 0)
        db.add(order)
        db.flush()
        if order.order_type != "market":
            return {"order_id": order.id, "status": "pending", "symbol": order.symbol,
                    "paper_only": True, "preflight": current}
        checked_fill(db, order, engine, current)
        db.flush()
        if order.status != "filled":
            raise ValueError("Paper engine rejected guarded order; no fill committed")
        if payload["side"] == "sell":
            from backend.models import VirtualTrade
            trade = db.query(VirtualTrade).filter_by(order_id=order.id).one()
            trade.pnl_realized = (order.fill_price - old_cost) * order.quantity - order.commission
        result = {"order_id": order.id, "status": order.status, "symbol": order.symbol,
                  "fill_price": order.fill_price, "paper_only": True, "preflight": current}
    return result


def checked_fill(db, order, engine, current: dict) -> None:
    """Authorize one synchronous fill after verified risk checks, in base units."""
    from backend.paper_trading.service import risk_checked_fill
    price = current["base_prices"][order.symbol]
    token = risk_checked_fill.set((order.id, price))
    try:
        order.signal_metadata = {**(order.signal_metadata or {}), "fill_preflight": current}
        engine._fill_order(db, order, price)
        for symbol, marked in current["base_prices"].items():
            engine._base_marks[(order.portfolio_id, symbol)] = marked
            conversion = current.get("fx", {}).get(symbol)
            if conversion:
                engine._quote_currencies[(order.portfolio_id, symbol)] = conversion["quote_currency"]
                engine._fx_marks[(order.portfolio_id, symbol)] = conversion
    finally:
        risk_checked_fill.reset(token)


async def execute_guarded_pending(db, order, engine) -> bool:
    """Check a pending/manual fill against current policy, marks and reservations."""
    if order.status != "pending":
        return False
    try:
        with db.begin_nested():
            metadata = order.signal_metadata or {}
            payload = metadata.get("risk_order")
            if not isinstance(payload, dict):
                raise ValueError("Legacy paper order lacks risk review; cancel and replace it")
            baseline = metadata.get("preflight")
            if not isinstance(baseline, dict):
                raise ValueError("Paper order lacks a reviewed preflight")
            portfolio = db.get(VirtualPortfolio, order.portfolio_id)
            if portfolio is None:
                raise ValueError("Paper portfolio is unavailable")
            current = await build_preflight(db, portfolio.user_id, payload,
                    exclude_order_id=order.id, exclude_proposal_id=metadata.get("agent_proposal_id"), executing=True)
            db.refresh(order)
            if order.status != "pending":
                return False
            actual = {"symbol": order.symbol, "side": order.side, "quantity": order.quantity,
                      "order_type": order.order_type, "stop_price": payload.get("stop_price"),
                      "limit_price": order.limit_price, "sl_price": order.sl_price,
                      "slippage_bps": order.slippage_bps, "commission": order.commission}
            if actual != baseline.get("order") or current["policy"] != baseline.get("policy"):
                raise ValueError("Order parameters or risk policy changed; replace the order")
            if current["base_currency"] != baseline.get("base_currency"):
                raise ValueError("Paper base currency changed; replace the order")
            quote = current["prices"][order.symbol]
            if not engine._fillable(order, quote):
                return False
            reference = Decimal(str(baseline["risk_reference_price"]))
            drift = abs(Decimal(str(quote)) / reference - 1) * 100
            # Limit orders can fill at an arbitrarily better price. Gap risk in
            # stop/market orders is bounded by the reviewed execution collar.
            favorable = order.order_type == "limit" and (
                (order.side == "buy" and quote <= order.limit_price) or
                (order.side == "sell" and quote >= order.limit_price))
            beyond_stop_collar = order.order_type == "sl" and (
                (order.side == "buy" and Decimal(str(quote)) > reference) or
                (order.side == "sell" and Decimal(str(quote)) < reference))
            beyond_market_collar = order.order_type == "market" and drift > Decimal(str(current["policy"]["max_quote_drift_pct"]))
            if beyond_stop_collar or (not favorable and beyond_market_collar):
                raise ValueError("Execution price moved beyond the reviewed collar")
            for symbol, conversion in current["fx"].items():
                old = _number(baseline.get("fx", {}).get(symbol, {}).get("rate"), "reviewed FX rate")
                if abs(Decimal(str(conversion["rate"])) / old - 1) * 100 > Decimal(str(current["policy"]["max_quote_drift_pct"])):
                    raise ValueError("FX moved beyond the reviewed collar")
            checked_fill(db, order, engine, current)
            db.flush()
            if order.status != "filled":
                raise ValueError("Paper engine rejected guarded fill")
        return True
    except (ValueError, TypeError, OverflowError) as exc:
        order.status = "rejected"
        order.signal_metadata = {**(order.signal_metadata or {}), "risk_rejection": str(exc)}
        return False
