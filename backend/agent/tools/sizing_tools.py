"""Deterministic, read-only sizing for incremental long paper positions.

This is an estimate from marked positions, not an order authorization. Budgets
apply to the new shares only; existing positions' stop risk is not inferred.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, ROUND_FLOOR
import math
from typing import Any

from backend.agent.tools import action_tools
from backend.agent.tools.envelope import err, ok
from backend.agent.tools.registry import ToolSpec
from backend.shared.db import SessionLocal

_BUFFER = Decimal("0.002")
_MAX_SYMBOLS = 50


def _number(value: Any, name: str, *, allow_zero: bool = False) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise ValueError(f"{name} must be numeric")
    if not math.isfinite(value):
        raise ValueError(f"{name} must be finite")
    result = Decimal(str(value))
    if result < 0 or (result == 0 and not allow_zero):
        raise ValueError(f"{name} must be {'non-negative' if allow_zero else 'positive'}")
    return result


def _whole(value: Decimal) -> int:
    return max(0, int(value.to_integral_value(rounding=ROUND_FLOOR)))


def _symbol_identity(symbol: str) -> tuple[str | None, str]:
    """Preserve share-class dots; recognize explicit exchange aliases only."""
    if ":" in symbol:
        exchange, base = symbol.split(":", 1)
        return exchange, base
    for suffix, exchange in ((".NS", "NSE"), (".BO", "BSE")):
        if symbol.endswith(suffix):
            return exchange, symbol[:-len(suffix)]
    return None, symbol


def _has_ambiguous_aliases(symbols: list[str]) -> bool:
    for index, left in enumerate(symbols):
        left_exchange, left_base = _symbol_identity(left)
        for right in symbols[index + 1:]:
            right_exchange, right_base = _symbol_identity(right)
            if left_base == right_base and (
                left_exchange is None or right_exchange is None or left_exchange == right_exchange
            ):
                return True
    return False


async def get_trade_size(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    """Size a buy without creating proposals, orders, or database changes."""
    from backend.models import VirtualPortfolio, VirtualPosition

    try:
        symbol = args.get("symbol")
        if not isinstance(symbol, str) or not symbol.strip() or len(symbol.strip()) > 64:
            raise ValueError("symbol must be a non-empty string of at most 64 characters")
        symbol = symbol.strip().upper()
        stop = _number(args.get("stop_price"), "stop_price")
        risk_pct = _number(args.get("risk_budget_pct", 1), "risk_budget_pct")
        max_pct = _number(args.get("max_position_pct", 20), "max_position_pct")
        if risk_pct > 5 or max_pct > 100:
            raise ValueError("risk_budget_pct must be <=5 and max_position_pct must be <=100")
        portfolio_id = args.get("portfolio_id")
        if portfolio_id is not None and (not isinstance(portfolio_id, str) or not portfolio_id.strip()):
            raise ValueError("portfolio_id must be a non-empty string")
    except (ValueError, TypeError, OverflowError) as exc:
        return err(str(exc), code="invalid_args")

    try:
        db = SessionLocal()
        try:
            from backend.agent.trade_preflight import get_risk_policy
            policy = get_risk_policy(db, user_id)
            if policy["enabled"]:
                risk_pct = min(risk_pct, Decimal(str(policy["risk_budget_pct"])))
                max_pct = min(max_pct, Decimal(str(policy["max_position_pct"])))
            query = db.query(VirtualPortfolio).filter(VirtualPortfolio.user_id == user_id)
            if portfolio_id is not None:
                query = query.filter(VirtualPortfolio.id == portfolio_id)
            portfolio = query.order_by(VirtualPortfolio.created_at, VirtualPortfolio.id).first()
            if portfolio is None:
                return err("Paper portfolio not found for this user", code="not_found")
            if not portfolio.is_active:
                return err("Paper portfolio is inactive", code="invalid_state")
            try:
                cash = _number(portfolio.current_cash, "portfolio cash", allow_zero=True)
                rows = db.query(VirtualPosition).filter(VirtualPosition.portfolio_id == portfolio.id).all()
                quantities: dict[str, Decimal] = {}
                for row in rows:
                    if str(row.side).lower() != "long":
                        raise ValueError("Short positions are unsupported by this long-only sizing tool")
                    name = str(row.symbol).strip().upper()
                    if not name:
                        raise ValueError("Portfolio contains an empty position symbol")
                    quantity = _number(row.quantity, "position quantity", allow_zero=True)
                    if quantity:
                        quantities[name] = quantities.get(name, Decimal(0)) + quantity
            except (ValueError, TypeError, OverflowError) as exc:
                return err(str(exc), code="invalid_state")
            resolved_id = portfolio.id
            base_currency = portfolio.base_currency
        finally:
            db.close()

        symbols = sorted(set(quantities) | {symbol})
        if len(symbols) > _MAX_SYMBOLS:
            return err(f"Sizing supports at most {_MAX_SYMBOLS} marked symbols", code="too_many_symbols")
        if _has_ambiguous_aliases(symbols):
            return err("Portfolio and requested symbol contain ambiguous aliases for the same exposure",
                       code="ambiguous_symbols",
                       hint="Use the exact stored position symbol and reconcile duplicate exchange aliases first.")
        marks, sources = await action_tools._mark_prices(symbols)
        prices: dict[str, Decimal] = {}
        missing = []
        for name in symbols:
            try:
                prices[name] = _number(marks.get(name), f"price for {name}")
            except (ValueError, TypeError, OverflowError):
                missing.append(name)
        if missing:
            return err("Usable marked prices unavailable for: " + ", ".join(missing), code="missing_prices",
                       hint="Entry prices are never used as current valuations.")
        quote_price = prices[symbol]
        if stop >= quote_price:
            return err("stop_price must be below the marked price for a long buy", code="invalid_args")
        from backend.paper_trading.currency import convert_marked_prices
        base_prices, fx = await convert_marked_prices(prices, sources, base_currency,
                            policy["max_quote_age_seconds"], action_tools._mark_prices)
        foreign = [s for s, conversion in fx.items() if conversion["quote_currency"] != base_currency]
        if foreign:
            from backend.paper_trading.currency import require_verified_foreign_basis
            audit_db = SessionLocal()
            try:
                require_verified_foreign_basis(audit_db, resolved_id, foreign)
            finally:
                audit_db.close()
        price = base_prices[symbol]
        equity = cash + sum((qty * base_prices[name] for name, qty in quantities.items()), Decimal(0))
        if equity <= 0 or not math.isfinite(float(equity)):
            return err("Portfolio must have positive, finite marked equity", code="invalid_state")
        current_qty = quantities.get(symbol, Decimal(0))
        current_value = current_qty * price
        budget = equity * risk_pct / 100
        loss_per_share = (quote_price - stop) * Decimal(str(fx[symbol]["rate"]))
        max_weight = max_pct / 100
        # Paying the buffer reduces post-trade equity. Include that reduction in
        # the concentration cap so fees cannot push a boundary trade over it.
        cap_quantities = {
            "stop_risk": _whole(budget / loss_per_share),
            "cash": _whole(cash / (price * (1 + _BUFFER))),
            "concentration": _whole((equity * max_weight - current_value) /
                                     (price * (1 + max_weight * _BUFFER))),
        }
        quantity = min(cap_quantities.values())
        bindings = [name for name, cap in cap_quantities.items() if cap == quantity]
        notional = quantity * price
        buffer = notional * _BUFFER
        post_equity = equity - buffer
        data = {
            "portfolio_id": resolved_id, "symbol": symbol, "side": "buy",
            "quantity": quantity, "quantity_unit": "whole_shares",
            "valuation_basis": "marked_prices", "valued_at": datetime.now(timezone.utc).isoformat(),
            "marked_prices": {name: float(value) for name, value in prices.items()},
            "base_marked_prices": {name: float(value) for name, value in base_prices.items()},
            "base_currency": base_currency, "fx": fx,
            "price_provenance": {name: sources.get(name, {}) for name in symbols},
            "price_used": float(quote_price), "stop_price": float(stop),
            "cash": float(cash), "marked_equity": float(equity),
            "current_quantity": float(current_qty), "current_position_value": float(current_value),
            "risk_budget_pct": float(risk_pct), "risk_budget": float(budget),
            "risk_policy_applied": policy if policy["enabled"] else None,
            "stop_loss_per_share": float(loss_per_share), "estimated_stop_loss": float(quantity * loss_per_share),
            "max_position_pct": float(max_pct), "cost_buffer_pct": float(_BUFFER * 100),
            "notional": float(notional), "cost_buffer": float(buffer),
            "estimated_cash_after": float(cash - notional - buffer),
            "estimated_position_pct_after": float((current_value + notional) / post_equity * 100),
            "cap_quantities": cap_quantities, "binding_constraints": bindings,
            "zero_size_reasons": bindings if quantity == 0 else [],
            "notes": [
                "Advisory paper estimate only; no proposal or order has been created.",
                "Risk budget covers incremental shares only, excluding existing positions' stop risk and fees.",
                "Stops are hypothetical and not placed; gaps and slippage can exceed the estimated stop loss.",
                "Pending orders and proposals are not reserved; recheck cash, positions and quotes before confirmation.",
                "Cash, exposure and risk are in the portfolio base currency, using dated FX quotes for foreign-currency symbols.",
            ],
        }
        qualities = {sources.get(name, {}).get("quality", "cached") for name in symbols}
        quality = "cached" if "cached" in qualities else ("delayed" if "delayed" in qualities else "live")
        return ok(data, source="paper_portfolio+marked_prices", quality=quality,
                  note="Derived sizing estimate; see per-symbol quote provenance and limitations.")
    except Exception as exc:  # Tools return structured errors instead of escaping to the agent.
        return err(f"get_trade_size failed: {exc}", code="tool_error")


def sizing_tool_specs(user_id: str) -> list[ToolSpec]:
    async def handler(args: dict[str, Any]) -> dict[str, Any]:
        return await get_trade_size(args, user_id)

    return [ToolSpec(
        name="get_trade_size",
        description="Estimate an incremental long BUY size in whole shares for a user-owned paper portfolio. "
        "Requires a user-specified hypothetical stop below the marked price. Caps size by incremental stop-risk "
        "budget, cash with a 0.2% cost buffer, and marked post-trade position concentration. Uses marked prices "
        "for every holding; never substitutes entry prices. Defaults: risk budget 1%, max position 20%; "
        "an enabled user risk policy can further reduce these limits. "
        "Advisory only: creates no proposal or order, does not place stops or reserve pending orders. "
        "Foreign quotes require dated FX conversion into portfolio base currency. Existing holdings' stop risk is excluded.",
        parameters={"type": "object", "properties": {
            "symbol": {"type": "string", "minLength": 1, "maxLength": 64},
            "stop_price": {"type": "number", "exclusiveMinimum": 0},
            "portfolio_id": {"type": "string", "minLength": 1},
            "risk_budget_pct": {"type": "number", "exclusiveMinimum": 0, "maximum": 5, "default": 1},
            "max_position_pct": {"type": "number", "exclusiveMinimum": 0, "maximum": 100, "default": 20},
        }, "required": ["symbol", "stop_price"]},
        handler=handler, read_only=True, write_class="none",
    )]
