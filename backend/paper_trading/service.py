from __future__ import annotations

import asyncio
import logging
import math
import time
from contextvars import ContextVar
from datetime import datetime, timezone
from statistics import mean, pstdev
from typing import Any

from sqlalchemy import update
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

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

logger = logging.getLogger(__name__)

risk_checked_fill: ContextVar[tuple[str, float] | None] = ContextVar("paper_risk_checked_fill", default=None)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# Internal, never-committed status held while one session owns a fill.
FILLING_STATUS = "filling"
_INDEX_TTL_SECONDS = 30.0
_MAX_COALESCED_SYMBOLS = 5000
_DROP_LOG_INTERVAL_SECONDS = 60.0


class OrderClaimConflict(Exception):
    """Another session already claimed (filled/cancelled) this pending order."""


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
        # Latest tick per symbol (coalesced) instead of a FIFO that drops on overflow.
        self._latest_ticks: dict[str, dict[str, Any]] = {}
        self._tick_event: asyncio.Event | None = None
        self._ticks_coalesced = 0
        self._ticks_dropped = 0
        self._last_drop_log = 0.0
        self._worker_task: asyncio.Task | None = None
        self._hub: MarketDataHub | None = None
        # {symbol: {pending order ids}}; refreshed on CRUD and every 30s.
        self._order_index: dict[str, set[str]] = {}
        self._index_loaded_at: float | None = None
        self._index_tracked_during_reload: list[tuple[str, str]] = []

    def start(self, hub: MarketDataHub | None = None) -> None:
        if self._started:
            return
        self._tick_event = asyncio.Event()
        self._latest_ticks = {}
        self._started = True
        self._hub = hub or get_marketdata_hub()
        self._hub.register_tick_listener(self._on_tick)
        self._worker_task = asyncio.create_task(self._worker(), name="paper-engine-worker")

    async def shutdown(self) -> None:
        self._started = False
        task = self._worker_task
        self._worker_task = None
        self._latest_ticks = {}
        if self._tick_event is not None:
            self._tick_event.set()
        if task is not None:
            task.cancel()

    # ── pending-order index (SCALE-5) ────────────────────────────────────
    def track_order(self, order: VirtualOrder) -> None:
        """Register a pending order so the next tick for its symbol evaluates it."""
        if order is None or str(order.status) != VirtualOrderStatus.PENDING.value:
            return
        symbol = str(order.symbol or "").strip().upper()
        if not symbol or not order.id:
            return
        self._order_index.setdefault(symbol, set()).add(str(order.id))
        self._index_tracked_during_reload.append((symbol, str(order.id)))

    def invalidate_order_index(self) -> None:
        self._index_loaded_at = None

    def _load_order_index(self) -> dict[str, set[str]]:
        db = SessionLocal()
        try:
            rows = (
                db.query(VirtualOrder.id, VirtualOrder.symbol)
                .filter(VirtualOrder.status == VirtualOrderStatus.PENDING.value)
                .all()
            )
        finally:
            db.close()
        index: dict[str, set[str]] = {}
        for order_id, symbol in rows:
            index.setdefault(str(symbol or "").strip().upper(), set()).add(str(order_id))
        return index

    async def _symbol_has_candidates(self, symbol: str) -> bool:
        loaded = self._index_loaded_at
        if loaded is None or time.monotonic() - loaded > _INDEX_TTL_SECONDS:
            self._index_tracked_during_reload = []
            index = await asyncio.to_thread(self._load_order_index)
            for tracked_symbol, order_id in self._index_tracked_during_reload:
                index.setdefault(tracked_symbol, set()).add(order_id)
            self._index_tracked_during_reload = []
            self._order_index = index
            self._index_loaded_at = time.monotonic()
        return bool(self._order_index.get(symbol))

    # ── tick intake (REL-8) ─────────────────────────────────────────────
    def _on_tick(self, tick: dict[str, Any]) -> None:
        symbol = str(tick.get("symbol") or "").strip().upper()
        ltp = _f(tick.get("ltp"), default=float("nan"))
        if symbol and ltp == ltp:
            self._mark_prices[symbol] = ltp
        if not self._started or self._tick_event is None or not symbol:
            return
        if symbol in self._latest_ticks:
            self._ticks_coalesced += 1
        elif len(self._latest_ticks) >= _MAX_COALESCED_SYMBOLS:
            self._ticks_dropped += 1
            self._log_drops()
            return
        self._latest_ticks[symbol] = tick
        self._tick_event.set()

    def _log_drops(self) -> None:
        now = time.monotonic()
        if now - self._last_drop_log < _DROP_LOG_INTERVAL_SECONDS:
            return
        self._last_drop_log = now
        logger.warning(
            "Paper engine tick backlog: %d ticks dropped, %d coalesced (symbol cap %d)",
            self._ticks_dropped, self._ticks_coalesced, _MAX_COALESCED_SYMBOLS,
        )

    async def _worker(self) -> None:
        while self._started:
            event = self._tick_event
            if event is None:
                break
            try:
                await event.wait()
            except (asyncio.CancelledError, RuntimeError):
                break
            event.clear()
            batch, self._latest_ticks = self._latest_ticks, {}
            for symbol, tick in batch.items():
                try:
                    await self._evaluate_pending_orders(tick)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logger.exception("Paper engine failed to evaluate pending orders for %s", symbol)

    def _needs_async_fill(self, db: Session, order: VirtualOrder, portfolio: VirtualPortfolio | None) -> bool:
        from backend.agent.trade_preflight import get_risk_policy
        from backend.paper_trading.currency import quote_currency
        if (order.signal_metadata or {}).get("preflight"):
            return True
        if portfolio and get_risk_policy(db, portfolio.user_id)["enabled"]:
            return True
        return bool(portfolio and quote_currency(order.symbol, {}, portfolio.base_currency) != portfolio.base_currency)

    def _evaluate_simple_orders_sync(self, symbol: str, ltp: float) -> tuple[list[str], set[str]]:
        """Fill plain orders in a worker thread; return (ids needing async fills, still-pending ids)."""
        deferred: list[str] = []
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
                order_id = order.id
                try:
                    if not self._fillable(order, ltp):
                        continue
                    portfolio = db.get(VirtualPortfolio, order.portfolio_id)
                    if self._needs_async_fill(db, order, portfolio):
                        deferred.append(order_id)
                        continue
                    with db.begin_nested():
                        self._fill_order(db, order, ltp)
                    db.commit()
                except OrderClaimConflict:
                    db.rollback()
                except Exception:
                    db.rollback()
                    logger.exception("Paper fill failed for order %s (%s)", order_id, symbol)
            remaining = {
                str(order_id)
                for (order_id,) in db.query(VirtualOrder.id).filter(
                    VirtualOrder.symbol == symbol,
                    VirtualOrder.status == VirtualOrderStatus.PENDING.value,
                )
            }
            return deferred, remaining
        finally:
            db.close()

    async def _evaluate_pending_orders(self, tick: dict[str, Any]) -> None:
        symbol = str(tick.get("symbol") or "").strip().upper()
        ltp = _f(tick.get("ltp"), default=float("nan"))
        if not symbol or ltp != ltp:
            return
        if not await self._symbol_has_candidates(symbol):
            return
        deferred, remaining = await asyncio.to_thread(self._evaluate_simple_orders_sync, symbol, ltp)
        if deferred:
            await self._evaluate_async_orders(deferred, symbol, ltp)
            db = SessionLocal()
            try:
                remaining = {
                    str(order_id)
                    for (order_id,) in db.query(VirtualOrder.id).filter(
                        VirtualOrder.symbol == symbol,
                        VirtualOrder.status == VirtualOrderStatus.PENDING.value,
                    )
                }
            finally:
                db.close()
        if remaining:
            self._order_index[symbol] = remaining
        else:
            self._order_index.pop(symbol, None)

    async def _evaluate_async_orders(self, order_ids: list[str], symbol: str, ltp: float) -> None:
        """Guarded and foreign-currency fills need fresh quotes; each order commits on its own."""
        from backend.agent.trade_preflight import execute_guarded_pending, get_risk_policy
        db = SessionLocal()
        try:
            for order_id in order_ids:
                try:
                    order = db.get(VirtualOrder, order_id, populate_existing=True)
                    if order is None or order.status != VirtualOrderStatus.PENDING.value:
                        continue
                    portfolio = db.get(VirtualPortfolio, order.portfolio_id)
                    guarded = portfolio and get_risk_policy(db, portfolio.user_id)["enabled"]
                    if guarded or (order.signal_metadata or {}).get("preflight"):
                        await execute_guarded_pending(db, order, self)
                    else:
                        await self._fill_currency_order(db, order)
                    db.commit()
                except OrderClaimConflict:
                    db.rollback()
                except Exception:
                    db.rollback()
                    logger.exception("Paper fill failed for order %s (%s)", order_id, symbol)
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

    @staticmethod
    def _claim_order(db: Session, order: VirtualOrder) -> None:
        """Atomically move pending -> filling so exactly one session can fill an order (REL-1)."""
        if order in db.new:
            db.flush([order])
        claimed = db.execute(
            update(VirtualOrder)
            .where(VirtualOrder.id == order.id, VirtualOrder.status == VirtualOrderStatus.PENDING.value)
            .values(status=FILLING_STATUS)
            .execution_options(synchronize_session=False)
        ).rowcount
        if claimed != 1:
            db.refresh(order)
            raise OrderClaimConflict(order.id)
        # Every exit below assigns a final status, which the ORM then writes.
        set_committed_value(order, "status", FILLING_STATUS)

    @staticmethod
    def _adjust_cash(db: Session, portfolio: VirtualPortfolio, delta: float, *, require: float | None = None) -> bool:
        """Apply a cash change in SQL; with `require`, only when that much cash is available."""
        if portfolio in db.dirty:
            db.flush([portfolio])
        stmt = update(VirtualPortfolio).where(VirtualPortfolio.id == portfolio.id)
        if require is not None:
            stmt = stmt.where(VirtualPortfolio.current_cash >= require)
        changed = db.execute(
            stmt.values(current_cash=VirtualPortfolio.current_cash + delta)
            .execution_options(synchronize_session=False)
        ).rowcount
        db.expire(portfolio, ["current_cash"])
        return changed == 1

    def _fill_order(self, db: Session, order: VirtualOrder, market_price: float) -> None:
        if order.status != "pending":
            return
        self._claim_order(db, order)
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
                # Not fillable at this price: release the claim.
                order.status = VirtualOrderStatus.PENDING.value
                return
        order_value = qty * fill_price
        commission = max(0.0, _f(order.commission))
        if commission <= 0:
            commission = order_value * 0.0005
            order.commission = commission

        if side == "buy":
            required = order_value + commission
            # Guarded debit: concurrent fills can never overdraw the book.
            if not self._adjust_cash(db, portfolio, -required, require=required):
                order.status = VirtualOrderStatus.REJECTED.value
                return
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
            self._adjust_cash(db, portfolio, max(0.0, order_value - commission))

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
        try:
            await self._maybe_fill_market_order_now(db, order)
        except OrderClaimConflict:
            # The tick worker (or another request) already settled this order.
            db.rollback()
            db.refresh(order)
        self.track_order(order)

    async def _maybe_fill_market_order_now(self, db: Session, order: VirtualOrder) -> None:
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
        base = _f(portfolio.initial_capital, 1.0)
        curve = self._daily_equity_curve(trades, base, equity)
        peak = base
        max_drawdown = 0.0
        for point in curve:
            running = point["equity"]
            if running > peak:
                peak = running
            dd = (running - peak) / peak if peak else 0.0
            max_drawdown = min(max_drawdown, dd)
        # Daily (business-day) returns of the resampled equity curve, annualised with sqrt(252).
        returns = []
        previous = base
        for point in curve:
            returns.append((point["equity"] / previous - 1.0) if previous else 0.0)
            previous = point["equity"]
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
            "curve_basis": "business-day closes of realized equity; final point marked to market",
            "sharpe_basis": "daily returns, annualised sqrt(252)",
            "sharpe_ratio": sharpe,
            "max_drawdown": max_drawdown,
            "win_rate": win_rate,
            "avg_win_loss_ratio": (avg_win / avg_loss) if avg_loss > 0 else 0.0,
            "profit_factor": profit_factor,
            "trade_count": len(trades),
        }

    @staticmethod
    def _daily_equity_curve(trades: list[VirtualTrade], base: float, marked_equity: float) -> list[dict[str, Any]]:
        """Resample per-trade realized equity to one point per business day (REL-24)."""
        if not trades:
            return []
        from datetime import date, timedelta
        closes: dict[date, float] = {}
        running = base
        for t in trades:
            running += _f(t.pnl_realized)
            closes[t.timestamp.date()] = running
        start = min(closes)
        end = max(max(closes), _utcnow().date())
        if (end - start).days > 3660:
            start = end - timedelta(days=3660)
        curve: list[dict[str, Any]] = []
        value = base
        for known_day in sorted(closes):
            if known_day < start:
                value = closes[known_day]
        day = start
        while day <= end:
            if day in closes:
                value = closes[day]
            if day.weekday() < 5 or day == end:
                curve.append({"t": day.isoformat(), "equity": value})
            day += timedelta(days=1)
        if curve:
            # Today's close includes unrealized P&L at current marks.
            curve[-1]["equity"] = marked_equity
        return curve

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
