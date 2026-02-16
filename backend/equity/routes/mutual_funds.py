from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.db.models import PortfolioMutualFundHolding
from backend.equity.services.mutual_funds import MutualFundPerformance, mutual_fund_service

router = APIRouter(prefix="/api/mutual-funds", tags=["mutual-funds"])


class PortfolioMutualFund(BaseModel):
    id: str
    scheme_code: int
    scheme_name: str
    fund_house: str
    category: str
    units: float
    avg_nav: float
    current_nav: float
    invested_amount: float
    current_value: float
    pnl: float
    pnl_pct: float
    xirr: Optional[float] = None
    sip_transactions: list[dict[str, Any]] = Field(default_factory=list)
    added_at: str


class PortfolioMutualFundCreate(BaseModel):
    scheme_code: int
    scheme_name: str
    fund_house: Optional[str] = None
    category: Optional[str] = None
    units: float = Field(gt=0)
    avg_nav: float = Field(gt=0)
    xirr: Optional[float] = None
    sip_transactions: list[dict[str, Any]] = Field(default_factory=list)


@router.get("/search")
async def search_funds(q: str = Query(default=""), category: Optional[str] = None) -> dict[str, list[dict[str, Any]]]:
    funds = await mutual_fund_service.search_funds(q, category)
    sample = funds[:8]
    perfs = await mutual_fund_service.compare_funds([x.scheme_code for x in sample], period="1y") if sample else []
    perf_map = {x.scheme_code: x for x in perfs if isinstance(x, MutualFundPerformance)}
    return {
        "items": [
            {
                **fund.model_dump(),
                "returns_1y": perf_map.get(fund.scheme_code).returns_1y if perf_map.get(fund.scheme_code) else None,
            }
            for fund in funds
        ]
    }


@router.get("/compare")
async def compare_funds(codes: str, period: str = "1y") -> dict[str, Any]:
    scheme_codes: list[int] = []
    for raw in (codes or "").split(","):
        value = raw.strip()
        if value.isdigit():
            scheme_codes.append(int(value))
    if not scheme_codes:
        raise HTTPException(status_code=400, detail="Provide at least one valid scheme code in 'codes'")

    perf = await mutual_fund_service.compare_funds(scheme_codes, period=period)
    normalized = await mutual_fund_service.get_normalized_history(scheme_codes, period=period)
    return {
        "period": period,
        "funds": [x.model_dump() for x in perf],
        "normalized": normalized,
    }


@router.get("/top/{category}")
async def get_top_funds(category: str, sort_by: str = "returns_1y", limit: int = 20) -> dict[str, list[dict[str, Any]]]:
    rows = await mutual_fund_service.get_top_funds_by_category(category, sort_by=sort_by, limit=limit)
    return {"items": [x.model_dump() for x in rows]}


@router.get("/{scheme_code}/performance")
async def get_fund_performance(scheme_code: int) -> dict[str, Any]:
    try:
        out = await mutual_fund_service.get_fund_performance(scheme_code)
        return out.model_dump()
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{scheme_code}/nav-history")
async def get_fund_nav_history(scheme_code: int) -> dict[str, Any]:
    try:
        out = await mutual_fund_service.get_fund_nav_history(scheme_code)
        return out.model_dump()
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _to_portfolio_payload(row: PortfolioMutualFundHolding, current_nav: float) -> PortfolioMutualFund:
    invested = float(row.units) * float(row.avg_nav)
    current_value = float(row.units) * float(current_nav)
    pnl = current_value - invested
    pnl_pct = (pnl / invested) * 100.0 if invested > 0 else 0.0
    sip: list[dict[str, Any]] = []
    try:
        parsed = json.loads(row.sip_transactions or "[]")
        if isinstance(parsed, list):
            sip = [x for x in parsed if isinstance(x, dict)]
    except Exception:
        sip = []
    return PortfolioMutualFund(
        id=row.id,
        scheme_code=row.scheme_code,
        scheme_name=row.scheme_name,
        fund_house=row.fund_house or "",
        category=row.category or "",
        units=float(row.units),
        avg_nav=float(row.avg_nav),
        current_nav=float(current_nav),
        invested_amount=invested,
        current_value=current_value,
        pnl=pnl,
        pnl_pct=pnl_pct,
        xirr=row.xirr,
        sip_transactions=sip,
        added_at=row.added_at,
    )


@router.post("/portfolio/add")
async def add_fund_to_portfolio(fund: PortfolioMutualFundCreate, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = PortfolioMutualFundHolding(
        id=str(uuid4()),
        scheme_code=int(fund.scheme_code),
        scheme_name=fund.scheme_name.strip(),
        fund_house=(fund.fund_house or "").strip(),
        category=(fund.category or "").strip(),
        units=float(fund.units),
        avg_nav=float(fund.avg_nav),
        xirr=fund.xirr,
        sip_transactions=json.dumps(fund.sip_transactions or []),
        added_at=datetime.utcnow().isoformat(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    perf = await mutual_fund_service.get_fund_performance(row.scheme_code)
    return {"status": "created", "holding": _to_portfolio_payload(row, perf.current_nav).model_dump()}


@router.get("/portfolio")
async def get_portfolio_funds(db: Session = Depends(get_db)) -> dict[str, Any]:
    rows = db.query(PortfolioMutualFundHolding).all()
    out: list[PortfolioMutualFund] = []
    for row in rows:
        try:
            perf = await mutual_fund_service.get_fund_performance(row.scheme_code)
            current_nav = perf.current_nav
        except Exception:
            current_nav = float(row.avg_nav)
        out.append(_to_portfolio_payload(row, current_nav))

    total_invested = sum(x.invested_amount for x in out)
    total_value = sum(x.current_value for x in out)
    total_pnl = total_value - total_invested
    total_pnl_pct = (total_pnl / total_invested) * 100.0 if total_invested > 0 else 0.0
    return {
        "items": [x.model_dump() for x in out],
        "summary": {
            "total_invested": total_invested,
            "total_current_value": total_value,
            "total_pnl": total_pnl,
            "total_pnl_pct": total_pnl_pct,
        },
    }


@router.delete("/portfolio/{holding_id}")
async def remove_fund_from_portfolio(holding_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.query(PortfolioMutualFundHolding).filter(PortfolioMutualFundHolding.id == holding_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Holding not found")
    db.delete(row)
    db.commit()
    return {"status": "deleted", "id": holding_id}


@router.get("/{scheme_code}")
async def get_fund_details(scheme_code: int) -> dict[str, Any]:
    try:
        details = await mutual_fund_service.get_fund_meta(scheme_code)
        hist = await mutual_fund_service.get_fund_nav_history(scheme_code)
        perf = await mutual_fund_service.get_fund_performance(scheme_code)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {
        "fund": details.model_dump() if details else None,
        "nav_history": hist.model_dump(),
        "performance": perf.model_dump(),
    }
