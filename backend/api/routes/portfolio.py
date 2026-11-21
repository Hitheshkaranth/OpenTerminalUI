from __future__ import annotations

import asyncio
import logging
import re
from datetime import date, datetime, timezone

from pydantic import BaseModel, Field
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.api.deps import fetch_stock_snapshot_coalesced, get_db
from backend.auth.deps import get_current_user
from backend.db.models import Holding, WatchlistItem
from backend.models.user import User
from backend.services.portfolio_analytics import portfolio_analytics_service
from backend.shared.market_classifier import market_classifier

router = APIRouter()
logger = logging.getLogger(__name__)


def _user_holdings(db: Session, user: User) -> list[Holding]:
    return db.query(Holding).filter(Holding.user_id == user.id).all()


_COUNTRY_CURRENCY = {"US": "USD", "IN": "INR", "GB": "GBP", "JP": "JPY", "HK": "HKD", "AU": "AUD", "CA": "CAD"}


def _holding_currency(snapshot: dict, classification: dict) -> str | None:
    """Currency a holding is priced in: provider/classifier currency, else exchange, else country."""
    from backend.paper_trading.currency import EXCHANGES

    for value in (snapshot.get("currency"), classification.get("currency")):
        if isinstance(value, str) and len(value.strip()) == 3:
            return value.strip().upper()
    exchange = str(classification.get("exchange") or snapshot.get("exchange") or "").strip().upper()
    if exchange in EXCHANGES:
        return EXCHANGES[exchange]
    country = str(classification.get("country_code") or snapshot.get("country_code") or "").strip().upper()
    return _COUNTRY_CURRENCY.get(country)


class HoldingCreate(BaseModel):
    ticker: str
    quantity: float = Field(gt=0)
    avg_buy_price: float = Field(gt=0)
    buy_date: str


class WatchlistCreate(BaseModel):
    watchlist_name: str
    ticker: str


class TaxLotCreate(BaseModel):
    ticker: str
    quantity: float = Field(gt=0)
    buy_price: float = Field(gt=0)
    buy_date: str


class TaxLotRealizeRequest(BaseModel):
    ticker: str
    quantity: float = Field(gt=0)
    sell_price: float = Field(gt=0)
    sell_date: str
    method: str = Field(default="FIFO", pattern="^(FIFO|LIFO|SPECIFIC|fifo|lifo|specific)$")
    specific_lot_ids: list[int] | None = None


class PortfolioImportRow(BaseModel):
    ticker: str
    quantity: float
    avg_buy_price: float
    buy_date: str | None = None
    exchange: str | None = None


class PortfolioImportRequest(BaseModel):
    source: Literal["csv", "kite", "manual"] = "csv"
    mode: Literal["append", "replace"] = "append"
    rows: list[PortfolioImportRow]


@router.get("/portfolio")
async def get_portfolio(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    holdings = _user_holdings(db, current_user)
    sem = asyncio.Semaphore(32)
    # Bound per-holding live-quote enrichment so a single slow/blocked upstream
    # (e.g. NSE returning 403 for cloud IPs) cannot stall the whole endpoint past
    # the client's 30s timeout. On timeout the holding still renders with its cost
    # basis; only the live price is omitted.
    snapshot_timeout_s = 8.0

    async def _snapshot_for(ticker: str) -> dict[str, object]:
        async with sem:
            try:
                snap_task = asyncio.create_task(fetch_stock_snapshot_coalesced(ticker))
                class_task = asyncio.create_task(market_classifier.classify(ticker))
                snap, classification = await asyncio.wait_for(
                    asyncio.gather(snap_task, class_task, return_exceptions=True),
                    timeout=snapshot_timeout_s,
                )
                payload = snap if isinstance(snap, dict) else {}
                if not isinstance(classification, Exception):
                    payload["_classification"] = classification.model_dump()
                return payload
            except Exception:
                return {}

    snapshot_tasks = {h.id: asyncio.create_task(_snapshot_for(h.ticker)) for h in holdings}
    rows: list[dict[str, object]] = []
    total_cost = 0.0
    total_value = 0.0
    # Holdings are priced in their own market's currency. Track totals per currency so a
    # mixed USD/INR book is never summed into one meaningless number.
    by_currency: dict[str, dict[str, float]] = {}
    for h in holdings:
        cost = float(h.quantity) * float(h.avg_buy_price)
        total_cost += cost
        snapshot = await snapshot_tasks[h.id]
        classification = snapshot.get("_classification") if isinstance(snapshot.get("_classification"), dict) else {}
        raw_price = snapshot.get("current_price")
        price = float(raw_price) if isinstance(raw_price, (int, float)) else None
        sector = str(snapshot.get("sector") or "").strip() or None
        current_value = float(h.quantity) * float(price) if isinstance(price, (int, float)) else None
        if current_value is not None:
            total_value += current_value
        currency = _holding_currency(snapshot, classification)
        if currency:
            bucket = by_currency.setdefault(currency, {"total_cost": 0.0, "total_value": 0.0})
            bucket["total_cost"] += cost
            if current_value is not None:
                bucket["total_value"] += current_value
        rows.append(
            {
                "id": h.id,
                "ticker": h.ticker,
                "quantity": h.quantity,
                "avg_buy_price": h.avg_buy_price,
                "buy_date": h.buy_date,
                "sector": sector,
                "current_price": price,
                "current_value": current_value,
                "pnl": (current_value - (float(h.quantity) * float(h.avg_buy_price))) if current_value is not None else None,
                "exchange": classification.get("exchange") or snapshot.get("exchange"),
                "country_code": classification.get("country_code") or snapshot.get("country_code"),
                "flag_emoji": classification.get("flag_emoji") or snapshot.get("flag_emoji"),
                "has_futures": bool(classification.get("has_futures")),
                "has_options": bool(classification.get("has_options")),
                "currency": currency,
            }
        )

    totals_by_currency = {
        ccy: {
            "total_cost": t["total_cost"],
            "total_value": t["total_value"] if t["total_value"] > 0 else None,
            "overall_pnl": (t["total_value"] - t["total_cost"]) if t["total_value"] > 0 else None,
        }
        for ccy, t in sorted(by_currency.items())
    }
    if len(totals_by_currency) > 1:
        # Mixed currencies: no single total exists without FX conversion, so don't fake one.
        return {
            "items": rows,
            "summary": {
                "total_cost": None,
                "total_value": None,
                "overall_pnl": None,
                "currency": None,
                "mixed_currency": True,
                "totals_by_currency": totals_by_currency,
            },
        }

    overall_pnl = total_value - total_cost if total_value > 0 else None
    return {
        "items": rows,
        "summary": {
            "total_cost": total_cost,
            "total_value": total_value if total_value > 0 else None,
            "overall_pnl": overall_pnl,
            "currency": next(iter(totals_by_currency), None),
            "mixed_currency": False,
            "totals_by_currency": totals_by_currency,
        },
    }


@router.get("/portfolio/analytics/sector-allocation")
async def get_sector_allocation(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    holdings = _user_holdings(db, current_user)
    return await portfolio_analytics_service.sector_allocation(holdings)


@router.get("/portfolio/analytics/risk-metrics")
async def get_risk_metrics(
    risk_free_rate: float = Query(default=0.06, ge=0, le=0.25),
    benchmark: str = Query(default="NIFTY50"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    holdings = _user_holdings(db, current_user)
    return await portfolio_analytics_service.risk_metrics(holdings, risk_free_rate=risk_free_rate, benchmark=benchmark)


@router.get("/portfolio/analytics/correlation")
async def get_correlation_matrix(
    window: int = Query(default=60, ge=10, le=252),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    holdings = _user_holdings(db, current_user)
    return await portfolio_analytics_service.correlation_matrix(holdings, window=window)


@router.get("/portfolio/analytics/dividends")
async def get_dividend_tracker(
    days: int = Query(default=180, ge=1, le=730),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    holdings = _user_holdings(db, current_user)
    return await portfolio_analytics_service.dividend_tracker(holdings, days=days)


@router.get("/portfolio/analytics/benchmark-overlay")
async def get_benchmark_overlay(
    benchmark: str = Query(default="NIFTY50"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    holdings = _user_holdings(db, current_user)
    return await portfolio_analytics_service.benchmark_overlay(holdings, benchmark=benchmark)


@router.get("/portfolio/{portfolio_id}/attribution")
async def get_portfolio_attribution(
    portfolio_id: str,
    period: str = Query(default="1M"),
    benchmark: str = Query(default="NIFTY50"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    try:
        return await portfolio_analytics_service.portfolio_attribution(
            db=db,
            portfolio_id=portfolio_id,
            period=period,
            benchmark=benchmark,
            user_id=current_user.id,
        )
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail="Portfolio not found")
        logger.warning("portfolio attribution rejected: %s", message)
        raise HTTPException(status_code=400, detail="Invalid attribution request")


@router.post("/portfolio/holdings")
def add_holding(
    payload: HoldingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    row = Holding(
        user_id=current_user.id,
        ticker=payload.ticker.strip().upper(),
        quantity=float(payload.quantity),
        avg_buy_price=float(payload.avg_buy_price),
        buy_date=payload.buy_date,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"status": "created", "holding": {"id": row.id, "ticker": row.ticker}}


_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@router.post("/portfolio/import")
def import_holdings(
    payload: PortfolioImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    if len(payload.rows) > 2000:
        raise HTTPException(status_code=413, detail="Too many rows: maximum 2000")

    today = datetime.now(timezone.utc).date().isoformat()
    errors: list[dict[str, object]] = []
    valid_rows: list[Holding] = []
    skipped = 0

    for idx, row in enumerate(payload.rows):
        ticker = row.ticker.strip().upper()
        if not ticker:
            errors.append({"row": idx, "ticker": None, "reason": "empty ticker"})
            skipped += 1
            continue

        qty = row.quantity
        if not isinstance(qty, (int, float)) or qty <= 0:
            errors.append({"row": idx, "ticker": ticker, "reason": "quantity must be > 0"})
            skipped += 1
            continue

        avg = row.avg_buy_price
        if not isinstance(avg, (int, float)) or avg <= 0:
            errors.append({"row": idx, "ticker": ticker, "reason": "avg_buy_price must be > 0"})
            skipped += 1
            continue

        buy_date = row.buy_date
        if buy_date is not None:
            if not _DATE_RE.match(buy_date):
                errors.append({"row": idx, "ticker": ticker, "reason": "buy_date must be YYYY-MM-DD"})
                skipped += 1
                continue
            # Validate it's a real date
            try:
                date.fromisoformat(buy_date)
            except (ValueError, TypeError):
                errors.append({"row": idx, "ticker": ticker, "reason": "buy_date must be YYYY-MM-DD"})
                skipped += 1
                continue
        else:
            buy_date = today

        valid_rows.append(
            Holding(user_id=current_user.id, ticker=ticker, quantity=float(qty), avg_buy_price=float(avg), buy_date=buy_date)
        )

    if payload.mode == "replace":
        # Only the caller's own holdings are replaced.
        db.query(Holding).filter(Holding.user_id == current_user.id).delete(synchronize_session=False)

    for h in valid_rows:
        db.add(h)

    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("portfolio import failed")
        raise HTTPException(status_code=500, detail="Import failed")

    return {
        "imported": len(valid_rows),
        "skipped": skipped,
        "mode": payload.mode,
        "errors": errors,
    }


@router.delete("/portfolio/holdings/{holding_id}")
def delete_holding(
    holding_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    row = db.query(Holding).filter(Holding.id == holding_id, Holding.user_id == current_user.id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Holding not found")
    db.delete(row)
    db.commit()
    return {"status": "deleted", "id": holding_id}


@router.get("/portfolio/tax-lots")
async def get_tax_lots(
    ticker: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    return await portfolio_analytics_service.tax_lot_summary(db, ticker=ticker, user_id=current_user.id)


@router.post("/portfolio/tax-lots")
def create_tax_lot(
    payload: TaxLotCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    row = portfolio_analytics_service.add_tax_lot(
        db=db,
        user_id=current_user.id,
        ticker=payload.ticker,
        quantity=payload.quantity,
        buy_price=payload.buy_price,
        buy_date=payload.buy_date,
    )
    return {"status": "created", "lot": {"id": row.id, "ticker": row.ticker}}


@router.post("/portfolio/tax-lots/realize")
def realize_tax_lot(
    payload: TaxLotRealizeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    try:
        return portfolio_analytics_service.realize_tax_lots(
            db=db,
            user_id=current_user.id,
            ticker=payload.ticker,
            sell_quantity=payload.quantity,
            sell_price=payload.sell_price,
            sell_date=payload.sell_date,
            method=payload.method,
            specific_lot_ids=payload.specific_lot_ids,
        )
    except ValueError as exc:
        logger.info("tax lot realization rejected: %s", exc)
        detail = "Insufficient lot quantity for requested sale" if "insufficient" in str(exc).lower() else "Invalid realization request"
        raise HTTPException(status_code=400, detail=detail)


@router.get("/watchlist")  # singular alias: the multi-watchlist router owns /api/watchlists
@router.get("/watchlists")
async def get_watchlists(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, list[dict[str, object]]]:
    items = db.query(WatchlistItem).filter(WatchlistItem.user_id == current_user.id).all()
    sem = asyncio.Semaphore(16)

    async def _classify(ticker: str) -> dict[str, object]:
        async with sem:
            try:
                return (await market_classifier.classify(ticker)).model_dump()
            except Exception:
                return {}

    tasks = {x.id: asyncio.create_task(_classify(x.ticker)) for x in items}
    classifications = {item_id: await task for item_id, task in tasks.items()}
    return {
        "items": [
            {
                "id": x.id,
                "watchlist_name": x.watchlist_name,
                "ticker": x.ticker,
                "country_code": classifications.get(x.id, {}).get("country_code"),
                "flag_emoji": classifications.get(x.id, {}).get("flag_emoji"),
                "exchange": classifications.get(x.id, {}).get("exchange"),
                "has_futures": bool(classifications.get(x.id, {}).get("has_futures")),
                "has_options": bool(classifications.get(x.id, {}).get("has_options")),
            }
            for x in items
        ]
    }


@router.post("/watchlists/items")
def add_watchlist_item(
    payload: WatchlistCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    row = WatchlistItem(
        user_id=current_user.id,
        watchlist_name=payload.watchlist_name.strip(),
        ticker=payload.ticker.strip().upper(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"status": "created", "item": {"id": row.id, "watchlist_name": row.watchlist_name, "ticker": row.ticker}}


@router.delete("/watchlists/items/{item_id}")
def delete_watchlist_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    row = db.query(WatchlistItem).filter(WatchlistItem.id == item_id, WatchlistItem.user_id == current_user.id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Watchlist item not found")
    db.delete(row)
    db.commit()
    return {"status": "deleted", "id": item_id}
