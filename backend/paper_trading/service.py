from __future__ import annotations

import asyncio
import math
from contextvars import ContextVar
from datetime import datetime, timezone
from statistics import mean, pstdev
from typing import Any

from sqlalchemy.orm import Session

from backend.api.deps import get_unified_fetcher
from backend.shared.db import SessionLocal
from backend.models import (
    VirtualOrder,
    VirtualOrderStatus,
    VirtualOrderType,
    VirtualPortfolio,
    VirtualPosition,
    VirtualTrade,
)
from backend.services.marketdata_hub import MarketDataHub, get_marketdata_hub

risk_checked_fill: ContextVar[tuple[str, float] | None] = ContextVar("paper_risk_checked_fill", default=None)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _f(value: Any, default: float = 0.0) -> float:
    try:
        if isinstance(value, bool):
            return default
        out = float(value)
        return out if math.isfinite(out) else default
    except (TypeError, ValueError, OverflowError):
        return default


class PaperTradingEngine:
    def __init__(self) -> None:
        self._started = False
        self._mark_prices: dict[str, float] = {}
        self._base_marks: dict[tuple[str, str], float] = {}
        self._quote_currencies: dict[tuple[str, str], str] = {}
        self._fx_marks: dict[tuple[str, str], dict] = {}
        self._queue: asyncio.Queue[dict[str, Any]] | None = None
        self._worker_task: asyncio.Task | None = None
        self._hub: MarketDataHub | None = None

    def start(self, hub: MarketDataHub | None = None) -> None:
        if self._started:
            return
        self._queue = asyncio.Queue(maxsize=5000)
        self._started = True
        self._hub = hub or get_marketdata_hub()
        self._hub.register_tick_listener(self._on_tick)
        self._worker_task = asyncio.create_task(self._worker(), name="paper-engine-worker")

    async def shutdown(self) -> None:
        self._started = False
        task = self._worker_task
        self._worker_task = None
        self._queue = None
        if task is not None:
            task.cancel()

    def _on_tick(self, tick: dict[str, Any]) -> None:
        symbol = str(tick.get("symbol") or "").strip().upper()
        ltp = _f(tick.get("ltp"), default=float("nan"))
        if symbol and ltp == ltp:
            self._mark_prices[symbol] = ltp
        if not self._started or self._queue is None:
            return
        try:
            self._queue.put_nowait(tick)
        except asyncio.QueueFull:
            return

    async def _worker(self) -> None:
        while self._started:
            try:
                tick = await self._queue.get()
            except (asyncio.CancelledError, RuntimeError):
                break
            try:
                await self._evaluate_pending_orders(tick)
            except Exception:
                continue

    async def _evaluate_pending_orders(self, tick: dict[str, Any]) -> None:
        symbol = str(tick.get("symbol") or "").strip().upper()
        ltp = _f(tick.get("ltp"), default=float("nan"))
        if not symbol or ltp != ltp:
            return
        db = SessionLocal()
        try:
            rows = (
                db.query(VirtualOrder)
                .filter(
                    VirtualOrder.symbol == symbol,
                    VirtualOrder.status == VirtualOrderStatus.PENDING.value,
                )
                .all()
            )
            for order in rows:
                if self._fillable(order, ltp):
                    from backend.agent.trade_preflight import execute_guarded_pending, get_risk_policy
                    portfolio = db.get(VirtualPortfolio, order.portfolio_id)
                    guarded = portfolio and get_risk_policy(db, portfolio.user_id)["enabled"]
                    if guarded or (order.signal_metadata or {}).get("preflight"):
                        await execute_guarded_pending(db, order, self)
                    else:
                        from backend.paper_trading.currency import quote_currency
                        if portfolio and quote_currency(order.symbol, {}, portfolio.base_currency) != portfolio.base_currency:
                            await self._fill_currency_order(db, order)
                        else:
                            self._fill_order(db, order, ltp)
            db.commit()
        finally:
            db.close()

    @staticmethod
    def _fillable(order: VirtualOrder, ltp: float) -> bool:
        side = str(order.side).lower()
        otype = str(order.order_type).lower()
        if otype == VirtualOrderType.MARKET.value:
            return True
        if otype == VirtualOrderType.LIMIT.value:
            if order.limit_price is None:
                return False
            slip = max(0.0, _f(order.slippage_bps)) / 10000
            if side == "buy":
                return ltp * (1 + slip) <= _f(order.limit_price)
            return ltp * (1 - slip) >= _f(order.limit_price)
        if otype == VirtualOrderType.SL.value:
            if order.sl_price is None:
                return False
            if side == "buy":
                return ltp >= _f(order.sl_price)
            return ltp <= _f(order.sl_price)
        return False

    def _fill_order(self, db: Session, order: VirtualOrder, market_price: float) -> None:
        if order.status != "pending":
            return
        if isinstance(market_price, bool) or not math.isfinite(market_price) or market_price <= 0:
            order.status = "rejected"
            return
        portfolio = db.query(VirtualPortfolio).filter(VirtualPortfolio.id == order.portfolio_id).first()
        if portfolio is None:
            order.status = VirtualOrderStatus.REJECTED.value
            return
        from backend.agent.trade_preflight import get_risk_policy
        from backend.paper_trading.currency import quote_currency
        needs_fx = quote_currency(order.symbol, {}, portfolio.base_currency) != portfolio.base_currency
        if (get_risk_policy(db, portfolio.user_id)["enabled"] or needs_fx) and risk_checked_fill.get() != (order.id, market_price):
            order.status = "rejected"
            order.signal_metadata = {**(order.signal_metadata or {}), "risk_rejection": "Fill requires current risk checks"}
            return
        side = str(order.side).lower()
        if side not in {"buy", "sell"} or not math.isfinite(order.quantity) or isinstance(order.quantity, bool):
            order.status = "rejected"
            return
        qty = max(0.0, _f(order.quantity))
        if qty <= 0:
            order.status = VirtualOrderStatus.REJECTED.value
            return
        slip = max(0.0, _f(order.slippage_bps))
        fill_price = market_price * (1 + (slip / 10000.0) if side == "buy" else 1 - (slip / 10000.0))
        if order.order_type == "limit":
            conversion = ((order.signal_metadata or {}).get("fill_preflight") or {}).get("fx", {}).get(order.symbol, {})
            limit = _f(order.limit_price) * _f(conversion.get("rate"), 1.0)
            if limit <= 0 or (side == "buy" and fill_price > limit) or (side == "sell" and fill_price < limit):
                return
        order_value = qty * fill_price
        commission = max(0.0, _f(order.commission))
        if commission <= 0:
            commission = order_value * 0.0005
            order.commission = commission

        if side == "buy":
            required = order_value + commission
            if portfolio.current_cash < required:
                order.status = VirtualOrderStatus.REJECTED.value
                return
            portfolio.current_cash -= required
        else:
            # Long-only sell checks for now.
            pos = (
                db.query(VirtualPosition)
                .filter(VirtualPosition.portfolio_id == order.portfolio_id, VirtualPosition.symbol == order.symbol)
                .first()
            )
            if pos is None or pos.quantity < qty:
                order.status = VirtualOrderStatus.REJECTED.value
                return
            portfolio.current_cash += max(0.0, order_value - commission)

        order.fill_price = fill_price
        order.fill_time = _utcnow()
        order.status = VirtualOrderStatus.FILLED.value

        realized = self._realized_pnl(db, order, fill_price)
        if realized is not None:
            realized -= commission
        self._update_position(db, order, fill_price)
        db.add(
            VirtualTrade(
                order_id=order.id,
                portfolio_id=order.portfolio_id,
                symbol=order.symbol,
                side=side,
                quantity=qty,
                price=fill_price,
                timestamp=order.fill_time,
                pnl_realized=realized,
            )
        )

    @staticmethod
    def _update_position(db: Session, order: VirtualOrder, fill_price: float) -> None:
        side = str(order.side).lower()
        qty = _f(order.quantity)
        pos = (
            db.query(VirtualPosition)
            .filter(VirtualPosition.portfolio_id == order.portfolio_id, VirtualPosition.symbol == order.symbol)
            .first()
        )
        if pos is None:
            pos = VirtualPosition(
                portfolio_id=order.portfolio_id,
                symbol=order.symbol,
                quantity=0.0,
                avg_entry_price=0.0,
                side="long",
            )
            db.add(pos)
            db.flush()
        if side == "buy":
            total_cost = (pos.avg_entry_price * pos.quantity) + (fill_price * qty)
            pos.quantity += qty
            pos.avg_entry_price = total_cost / pos.quantity if pos.quantity > 0 else 0.0
        else:
            pos.quantity = max(0.0, pos.quantity - qty)
            if pos.quantity == 0:
                pos.avg_entry_price = 0.0

    @staticmethod
    def _realized_pnl(db: Session, order: VirtualOrder, fill_price: float) -> float | None:
        side = str(order.side).lower()
        if side != "sell":
            return None
        pos = (
            db.query(VirtualPosition)
            .filter(VirtualPosition.portfolio_id == order.portfolio_id, VirtualPosition.symbol == order.symbol)
            .first()
        )
        if pos is None:
            return None
        return (fill_price - _f(pos.avg_entry_price)) * _f(order.quantity)

    async def maybe_fill_market_order_now(self, db: Session, order: VirtualOrder) -> None:
        if str(order.order_type).lower() != VirtualOrderType.MARKET.value:
            return
        from backend.agent.trade_preflight import execute_guarded_pending, get_risk_policy
        portfolio = db.get(VirtualPortfolio, order.portfolio_id)
        if (portfolio and get_risk_policy(db, portfolio.user_id)["enabled"]) or (order.signal_metadata or {}).get("preflight"):
            await execute_guarded_pending(db, order, self)
            return
        from backend.paper_trading.currency import quote_currency
        if portfolio and quote_currency(order.symbol, {}, portfolio.base_currency) != portfolio.base_currency:
            await self._fill_currency_order(db, order)
            return
        ltp = self._mark_prices.get(order.symbol)
        if ltp is None:
            fetcher = await get_unified_fetcher()
            raw_symbol = order.symbol.split(":")[-1]
            quote = await fetcher.fetch_quote(raw_symbol)
            ltp = _f(quote.get("last_price") or quote.get("c") or quote.get("regularMarketPrice") or quote.get("price"))
        if ltp and ltp > 0:
            self._fill_order(db, order, ltp)

    async def _fill_currency_order(self, db: Session, order: VirtualOrder) -> None:
        """Convert foreign quotes even when discretionary risk limits are off."""
        from decimal import Decimal
        from sqlalchemy import update
        from backend.agent.tools.action_tools import _mark_prices
        from backend.agent.trade_preflight import checked_fill
        from backend.paper_trading.currency import convert_marked_prices, validate_quote_source
        try:
            with db.begin_nested():
                db.execute(update(VirtualPortfolio).where(VirtualPortfolio.id == order.portfolio_id)
                    .values(current_cash=VirtualPortfolio.current_cash))
                db.refresh(order)
                if order.status != "pending":
                    return
                portfolio = db.get(VirtualPortfolio, order.portfolio_id, populate_existing=True)
                if portfolio is None or not portfolio.is_active:
                    raise ValueError("Active paper portfolio required")
                marks, sources = await _mark_prices([order.symbol])
                validate_quote_source(sources.get(order.symbol, {}), 3600, symbol=order.symbol)
                quote = marks.get(order.symbol)
                if not quote or not math.isfinite(quote) or quote <= 0:
                    raise ValueError("Usable foreign quote required")
                if not self._fillable(order, quote):
                    return
                converted, fx = await convert_marked_prices({order.symbol: Decimal(str(quote))}, sources,
                                        portfolio.base_currency, 3600, _mark_prices)
                from backend.paper_trading.currency import require_verified_foreign_basis
                require_verified_foreign_basis(db, portfolio.id, [order.symbol])
                current = {"base_prices": {s: float(p) for s, p in converted.items()}, "fx": fx,
                           "prices": marks, "quote_provenance": sources, "base_currency": portfolio.base_currency}
                checked_fill(db, order, self, current)
                db.flush()
                if order.status != "filled":
                    raise ValueError("Foreign paper order could not be funded")
        except (ValueError, TypeError, OverflowError) as exc:
            order.status = "rejected"
            order.signal_metadata = {**(order.signal_metadata or {}), "risk_rejection": str(exc)}

    def portfolio_performance(self, db: Session, portfolio_id: str) -> dict[str, Any]:
        trades = (
            db.query(VirtualTrade)
            .filter(VirtualTrade.portfolio_id == portfolio_id)
            .order_by(VirtualTrade.timestamp.asc())
            .all()
        )
        portfolio = db.query(VirtualPortfolio).filter(VirtualPortfolio.id == portfolio_id).first()
        if portfolio is None:
            return {}
        positions = db.query(VirtualPosition).filter(VirtualPosition.portfolio_id == portfolio_id).all()
        equity = portfolio.current_cash
        for pos in positions:
            mark = self.mark_in_base(portfolio, pos)
            equity += _f(pos.quantity) * _f(mark)
        pnl = equity - _f(portfolio.initial_capital)
        cumulative_return = (pnl / _f(portfolio.initial_capital, 1.0)) if portfolio.initial_capital else 0.0

        realized = [_f(t.pnl_realized) for t in trades if t.pnl_realized is not None]
        wins = [x for x in realized if x > 0]
        losses = [x for x in realized if x < 0]
        win_rate = (len(wins) / len(realized)) if realized else 0.0
        avg_win = mean(wins) if wins else 0.0
        avg_loss = abs(mean(losses)) if losses else 0.0
        profit_factor = (sum(wins) / abs(sum(losses))) if losses else (float("inf") if wins else 0.0)
        returns = []
        base = _f(portfolio.initial_capital, 1.0)
        running = base
        curve = []
        peak = base
        max_drawdown = 0.0
        for t in trades:
            running += _f(t.pnl_realized)
            curve.append({"t": t.timestamp.isoformat(), "equity": running})
            if running > peak:
                peak = running
            dd = (running - peak) / peak if peak else 0.0
            max_drawdown = min(max_drawdown, dd)
            returns.append(_f(t.pnl_realized) / base if base else 0.0)
        sharpe = 0.0
        if len(returns) > 1 and pstdev(returns) > 0:
            sharpe = (mean(returns) / pstdev(returns)) * (252**0.5)
        return {
            "portfolio_id": portfolio_id,
            "base_currency": portfolio.base_currency,
            "equity": equity,
            "pnl": pnl,
            "cumulative_return": cumulative_return,
            "daily_pnl_curve": curve,
            "sharpe_ratio": sharpe,
            "max_drawdown": max_drawdown,
            "win_rate": win_rate,
            "avg_win_loss_ratio": (avg_win / avg_loss) if avg_loss > 0 else 0.0,
            "profit_factor": profit_factor,
            "trade_count": len(trades),
        }

    def mark_in_base(self, portfolio: VirtualPortfolio, position: VirtualPosition) -> float:
        from backend.paper_trading.currency import quote_currency, validate_quote_source
        key = (portfolio.id, position.symbol)
        currency = self._quote_currencies.get(key) or quote_currency(position.symbol, {}, portfolio.base_currency)
        if currency == portfolio.base_currency:
            return self._mark_prices.get(position.symbol, self._base_marks.get(key, position.avg_entry_price))
        conversion = self._fx_marks.get(key)
        if conversion and position.symbol in self._mark_prices:
            try:
                validate_quote_source(conversion.get("provenance") or {}, 3600, symbol=conversion.get("pair", "FX"))
                return self._mark_prices[position.symbol] * conversion["rate"]
            except ValueError:
                pass
        if key in self._base_marks:
            return self._base_marks[key]
        # A quote in another currency is never added directly to base cash.
        # Until a fresh FX-backed valuation is available, expose cost basis.
        return position.avg_entry_price


_paper_engine = PaperTradingEngine()


def get_paper_engine() -> PaperTradingEngine:
    return _paper_engine
