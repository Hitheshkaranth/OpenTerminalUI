from __future__ import annotations

from datetime import datetime
from typing import Any
from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import fetch_stock_snapshot_coalesced, get_db
from backend.auth.deps import get_current_user
from backend.models import (
    PortfolioHoldingORM,
    PortfolioORM,
    PortfolioTransactionORM,
    User,
)
from backend.services.portfolio_analytics import portfolio_analytics_service

router = APIRouter()


class PortfolioCreateRequest(BaseModel):
    name: str
    description: str = ""
    benchmark_symbol: str | None = None
    currency: str = "USD"
    starting_cash: float = Field(default=0.0, ge=0)


class PortfolioUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    benchmark_symbol: str | None = None
    currency: str | None = None


class PortfolioHoldingCreateRequest(BaseModel):
    symbol: str
    shares: float = Field(gt=0)
    cost_basis_per_share: float = Field(gt=0)
    purchase_date: str = ""
    notes: str = ""
    lot_id: str = ""


class PortfolioTransactionCreateRequest(BaseModel):
    symbol: str
    type: str = Field(pattern="^(buy|sell|dividend)$")
    shares: float = Field(default=0.0, ge=0)
    price: float = Field(default=0.0, ge=0)
    date: str
    fees: float = Field(default=0.0, ge=0)
    lot_id: str = ""
    notes: str = ""


def _portfolio_for_user(db: Session, portfolio_id: str, user_id: str) -> PortfolioORM:
    row = db.query(PortfolioORM).filter(PortfolioORM.id == portfolio_id, PortfolioORM.user_id == user_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return row


async def _quote_map(symbols: list[str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for sym in symbols:
        out[sym] = await fetch_stock_snapshot_coalesced(sym)
    return out


@router.post("/portfolios")
def create_portfolio(
    payload: PortfolioCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = PortfolioORM(
        user_id=current_user.id,
        name=payload.name.strip() or "Portfolio",
        description=payload.description.strip(),
        benchmark_symbol=(payload.benchmark_symbol or "").strip().upper() or None,
        currency=(payload.currency or "USD").strip().upper(),
        starting_cash=float(payload.starting_cash),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name}


@router.get("/portfolios")
async def list_portfolios(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    rows = (
        db.query(PortfolioORM)
        .filter(PortfolioORM.user_id == current_user.id)
        .order_by(PortfolioORM.created_at.desc())
        .all()
    )
    out = []
    for row in rows:
        holdings = db.query(PortfolioHoldingORM).filter(PortfolioHoldingORM.portfolio_id == row.id).all()
        symbols = sorted({h.symbol for h in holdings if h.symbol})
        quotes = await _quote_map(symbols) if symbols else {}
        total_value = 0.0
        for h in holdings:
            px = float((quotes.get(h.symbol, {}) or {}).get("current_price") or 0.0)
            total_value += float(h.shares) * px
        out.append(
            {
                "id": row.id,
                "name": row.name,
                "description": row.description,
                "benchmark_symbol": row.benchmark_symbol,
                "currency": row.currency,
                "created_at": row.created_at.isoformat(),
                "total_value": total_value,
            }
        )
    return {"items": out}


@router.get("/portfolios/{portfolio_id}")
def get_portfolio(
    portfolio_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = _portfolio_for_user(db, portfolio_id, current_user.id)
    return {
        "id": row.id,
        "name": row.name,
        "description": row.description,
        "benchmark_symbol": row.benchmark_symbol,
        "currency": row.currency,
        "starting_cash": row.starting_cash,
        "created_at": row.created_at.isoformat(),
    }


@router.patch("/portfolios/{portfolio_id}")
def update_portfolio(
    portfolio_id: str,
    payload: PortfolioUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = _portfolio_for_user(db, portfolio_id, current_user.id)
    if payload.name is not None:
        row.name = payload.name.strip() or row.name
    if payload.description is not None:
        row.description = payload.description
    if payload.benchmark_symbol is not None:
        row.benchmark_symbol = payload.benchmark_symbol.strip().upper() or None
    if payload.currency is not None:
        row.currency = payload.currency.strip().upper() or row.currency
    db.commit()
    return {"status": "updated", "id": row.id}


@router.delete("/portfolios/{portfolio_id}")
def delete_portfolio(
    portfolio_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = _portfolio_for_user(db, portfolio_id, current_user.id)
    db.delete(row)
    db.commit()
    return {"status": "deleted", "id": portfolio_id}


@router.post("/portfolios/{portfolio_id}/holdings")
def add_portfolio_holding(
    portfolio_id: str,
    payload: PortfolioHoldingCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _portfolio_for_user(db, portfolio_id, current_user.id)
    symbol = payload.symbol.strip().upper()
    lot_id = payload.lot_id.strip() or datetime.utcnow().strftime("%Y%m%d%H%M%S")
    row = PortfolioHoldingORM(
        portfolio_id=portfolio_id,
        symbol=symbol,
        shares=float(payload.shares),
        cost_basis_per_share=float(payload.cost_basis_per_share),
        purchase_date=payload.purchase_date,
        notes=payload.notes,
        lot_id=lot_id,
    )
    db.add(row)
    db.add(
        PortfolioTransactionORM(
            portfolio_id=portfolio_id,
            symbol=symbol,
            type="buy",
            shares=float(payload.shares),
            price=float(payload.cost_basis_per_share),
            date=payload.purchase_date or datetime.utcnow().date().isoformat(),
            fees=0.0,
            lot_id=lot_id,
            notes=payload.notes,
        )
    )
    db.commit()
    db.refresh(row)
    return {"id": row.id, "symbol": row.symbol}


@router.get("/portfolios/{portfolio_id}/holdings")
async def list_portfolio_holdings(
    portfolio_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _portfolio_for_user(db, portfolio_id, current_user.id)
    rows = (
        db.query(PortfolioHoldingORM)
        .filter(PortfolioHoldingORM.portfolio_id == portfolio_id)
        .order_by(PortfolioHoldingORM.created_at.desc())
        .all()
    )
    symbols = sorted({r.symbol for r in rows if r.symbol})
    quotes = await _quote_map(symbols) if symbols else {}
    return {
        "items": [
            {
                "id": r.id,
                "symbol": r.symbol,
                "shares": r.shares,
                "cost_basis_per_share": r.cost_basis_per_share,
                "purchase_date": r.purchase_date,
                "notes": r.notes,
                "lot_id": r.lot_id,
                "current_price": float((quotes.get(r.symbol, {}) or {}).get("current_price") or 0.0),
            }
            for r in rows
        ]
    }


@router.post("/portfolios/{portfolio_id}/transactions")
def add_portfolio_transaction(
    portfolio_id: str,
    payload: PortfolioTransactionCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _portfolio_for_user(db, portfolio_id, current_user.id)
    symbol = payload.symbol.strip().upper()
    tx = PortfolioTransactionORM(
        portfolio_id=portfolio_id,
        symbol=symbol,
        type=payload.type,
        shares=float(payload.shares),
        price=float(payload.price),
        date=payload.date,
        fees=float(payload.fees),
        lot_id=payload.lot_id.strip(),
        notes=payload.notes,
    )
    db.add(tx)

    if payload.type in {"buy", "sell"} and payload.shares > 0:
        lot_id = payload.lot_id.strip() or ("manual" if payload.type == "sell" else datetime.utcnow().strftime("%Y%m%d%H%M%S"))
        row = (
            db.query(PortfolioHoldingORM)
            .filter(
                PortfolioHoldingORM.portfolio_id == portfolio_id,
                PortfolioHoldingORM.symbol == symbol,
                PortfolioHoldingORM.lot_id == lot_id,
            )
            .first()
        )
        if row is None and payload.type == "buy":
            row = PortfolioHoldingORM(
                portfolio_id=portfolio_id,
                symbol=symbol,
                shares=float(payload.shares),
                cost_basis_per_share=float(payload.price),
                purchase_date=payload.date,
                notes=payload.notes,
                lot_id=lot_id,
            )
            db.add(row)
        elif row is not None:
            if payload.type == "buy":
                old_shares = float(row.shares)
                add_shares = float(payload.shares)
                new_shares = old_shares + add_shares
                row.cost_basis_per_share = (
                    (old_shares * float(row.cost_basis_per_share) + add_shares * float(payload.price)) / max(new_shares, 1e-9)
                )
                row.shares = new_shares
            else:
                row.shares = max(0.0, float(row.shares) - float(payload.shares))
        if row is not None and row.shares <= 0:
            db.delete(row)

    db.commit()
    db.refresh(tx)
    return {"id": tx.id, "status": "created"}


@router.get("/portfolios/{portfolio_id}/transactions")
def list_portfolio_transactions(
    portfolio_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _portfolio_for_user(db, portfolio_id, current_user.id)
    rows = (
        db.query(PortfolioTransactionORM)
        .filter(PortfolioTransactionORM.portfolio_id == portfolio_id)
        .order_by(PortfolioTransactionORM.created_at.desc())
        .all()
    )
    return {
        "items": [
            {
                "id": r.id,
                "symbol": r.symbol,
                "type": r.type,
                "shares": r.shares,
                "price": r.price,
                "date": r.date,
                "fees": r.fees,
                "lot_id": r.lot_id,
                "notes": r.notes,
            }
            for r in rows
        ]
    }


@router.get("/portfolios/{portfolio_id}/analytics")
async def get_portfolio_analytics(
    portfolio_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    portfolio = _portfolio_for_user(db, portfolio_id, current_user.id)
    holdings = db.query(PortfolioHoldingORM).filter(PortfolioHoldingORM.portfolio_id == portfolio_id).all()
    transactions = db.query(PortfolioTransactionORM).filter(PortfolioTransactionORM.portfolio_id == portfolio_id).all()

    symbols = sorted({h.symbol for h in holdings if h.symbol})
    quotes = await _quote_map(symbols) if symbols else {}

    total_cost = 0.0
    total_value = 0.0
    sectors: dict[str, float] = {}
    markets: dict[str, float] = {}
    top_rows: list[dict[str, Any]] = []
    holding_views: list[SimpleNamespace] = []
    for h in holdings:
        snap = quotes.get(h.symbol, {}) or {}
        px = float(snap.get("current_price") or 0.0)
        mv = float(h.shares) * px
        cost = float(h.shares) * float(h.cost_basis_per_share)
        pnl = mv - cost
        total_value += mv
        total_cost += cost
        sector = str(snap.get("sector") or "Unknown")
        sectors[sector] = sectors.get(sector, 0.0) + mv
        ex = str(snap.get("exchange") or "Unknown")
        mk = "NSE" if ex in {"NSE", "BSE"} else "US"
        markets[mk] = markets.get(mk, 0.0) + mv
        chg = float(snap.get("change_pct") or 0.0)
        top_rows.append({"symbol": h.symbol, "pnl_pct": (pnl / cost * 100.0) if cost > 0 else 0.0, "day_change_pct": chg})
        holding_views.append(
            SimpleNamespace(
                ticker=h.symbol,
                quantity=float(h.shares),
                avg_buy_price=float(h.cost_basis_per_share),
            )
        )

    unrealized = total_value - total_cost
    realized = 0.0
    for tx in transactions:
        if tx.type == "sell":
            realized += float(tx.shares) * float(tx.price) - float(tx.fees or 0.0)
        if tx.type == "dividend":
            realized += float(tx.price) - float(tx.fees or 0.0)

    top_gainers = sorted(top_rows, key=lambda x: x["pnl_pct"], reverse=True)[:5]
    top_losers = sorted(top_rows, key=lambda x: x["pnl_pct"])[:5]
    day_change = 0.0
    for h in holdings:
        snap = quotes.get(h.symbol, {}) or {}
        px = float(snap.get("current_price") or 0.0)
        mv = float(h.shares) * px
        chg_pct = float(snap.get("change_pct") or 0.0)
        day_change += mv * (chg_pct / 100.0)
    day_change_pct = (day_change / total_value) * 100.0 if total_value > 0 else 0.0

    inception_candidates: list[datetime] = [portfolio.created_at]
    for h in holdings:
        try:
            if h.purchase_date:
                inception_candidates.append(datetime.fromisoformat(str(h.purchase_date)))
        except Exception:
            pass
    for tx in transactions:
        try:
            inception_candidates.append(datetime.fromisoformat(str(tx.date)))
        except Exception:
            pass
    inception = min(inception_candidates) if inception_candidates else datetime.utcnow()
    years = max((datetime.utcnow() - inception).days / 365.25, 1 / 365.25)
    initial_capital = float(portfolio.starting_cash or 0.0)
    final_equity = float(total_value + realized)
    if initial_capital > 0 and final_equity > 0:
        annualized_return = ((final_equity / initial_capital) ** (1 / years) - 1.0) * 100.0
    else:
        annualized_return = 0.0

    sharpe_ratio = 0.0
    max_drawdown = 0.0
    if holding_views:
        try:
            risk = await portfolio_analytics_service.risk_metrics(holding_views, risk_free_rate=0.06, benchmark=portfolio.benchmark_symbol or "NIFTY50")
            sharpe_ratio = float(risk.get("sharpe_ratio") or 0.0)
            max_drawdown = float(risk.get("max_drawdown") or 0.0)
        except Exception:
            sharpe_ratio = 0.0
            max_drawdown = 0.0

    return {
        "portfolio_id": portfolio_id,
        "total_value": total_value,
        "total_cost": total_cost,
        "unrealized_pnl": unrealized,
        "unrealized_pnl_pct": (unrealized / total_cost * 100.0) if total_cost > 0 else 0.0,
        "realized_pnl": realized,
        "day_change": day_change,
        "day_change_pct": day_change_pct,
        "allocation_by_sector": [{"name": k, "value": v} for k, v in sorted(sectors.items(), key=lambda x: x[1], reverse=True)],
        "allocation_by_market": [{"name": k, "value": v} for k, v in sorted(markets.items(), key=lambda x: x[1], reverse=True)],
        "top_gainers": top_gainers,
        "top_losers": top_losers,
        "dividend_income_ytd": sum(float(t.price) for t in transactions if t.type == "dividend"),
        "annualized_return": annualized_return,
        "sharpe_ratio": sharpe_ratio,
        "max_drawdown": max_drawdown,
    }
