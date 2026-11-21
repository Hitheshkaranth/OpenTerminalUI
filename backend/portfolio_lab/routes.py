from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models import PortfolioDefinition, PortfolioRun, StrategyBlend
from backend.models.ownership import can_access, owner_scope
from backend.models.user import User

from backend.portfolio_lab.schemas import (
    PortfolioDefinitionCreate,
    PortfolioDefinitionSummary,
    PortfolioReport,
    PortfolioRunRequest,
    PortfolioRunStatus,
    StrategyBlendCreate,
)
from backend.portfolio_lab.service import get_portfolio_lab_service

router = APIRouter()


def _ensure_portfolio_access(db: Session, user: User, portfolio_id: str) -> None:
    row = db.query(PortfolioDefinition.owner_id).filter(PortfolioDefinition.id == portfolio_id).first()
    db.close()  # release the connection before long-running awaits
    if row is None or not can_access(user, row[0]):
        raise HTTPException(status_code=404, detail="Portfolio not found")


def _ensure_blend_access(db: Session, user: User, blend_id: str) -> None:
    row = db.query(StrategyBlend.owner_id).filter(StrategyBlend.id == blend_id).first()
    db.close()
    if row is None or not can_access(user, row[0]):
        raise HTTPException(status_code=404, detail="Blend not found")


def _ensure_run_access(db: Session, user: User, run_id: str) -> None:
    row = (
        db.query(PortfolioDefinition.owner_id)
        .join(PortfolioRun, PortfolioRun.portfolio_id == PortfolioDefinition.id)
        .filter(PortfolioRun.id == run_id)
        .first()
    )
    db.close()
    if row is None or not can_access(user, row[0]):
        raise HTTPException(status_code=404, detail="Run not found")


@router.post("/portfolio-lab/portfolios", response_model=PortfolioDefinitionSummary)
async def create_portfolio(
    payload: PortfolioDefinitionCreate, current_user: User = Depends(get_current_user)
) -> PortfolioDefinitionSummary:
    row = await get_portfolio_lab_service().create_portfolio(payload, owner_id=current_user.id)
    return PortfolioDefinitionSummary(**row)


@router.get("/portfolio-lab/portfolios")
async def list_portfolios(
    tag: str | None = Query(default=None),
    weighting_method: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
) -> dict:
    items = await get_portfolio_lab_service().list_portfolios(
        tag=tag, weighting_method=weighting_method, owner_id=owner_scope(current_user)
    )
    return {"items": items}


@router.get("/portfolio-lab/portfolios/{portfolio_id}")
async def get_portfolio(
    portfolio_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> dict:
    _ensure_portfolio_access(db, current_user, portfolio_id)
    return await get_portfolio_lab_service().get_portfolio(portfolio_id)


@router.post("/portfolio-lab/blends")
async def create_blend(payload: StrategyBlendCreate, current_user: User = Depends(get_current_user)) -> dict:
    return await get_portfolio_lab_service().create_blend(payload, owner_id=current_user.id)


@router.get("/portfolio-lab/blends")
async def list_blends(current_user: User = Depends(get_current_user)) -> dict:
    return {"items": await get_portfolio_lab_service().list_blends(owner_id=owner_scope(current_user))}


@router.post("/portfolio-lab/portfolios/{portfolio_id}/run", response_model=PortfolioRunStatus)
async def run_portfolio(
    portfolio_id: str,
    payload: PortfolioRunRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PortfolioRunStatus:
    _ensure_portfolio_access(db, current_user, portfolio_id)
    if payload.blend_id:
        _ensure_blend_access(db, current_user, payload.blend_id)
    run = await get_portfolio_lab_service().run_portfolio(
        portfolio_id=portfolio_id,
        blend_id=payload.blend_id,
        force_refresh=payload.force_refresh,
    )
    return PortfolioRunStatus(**run)


@router.get("/portfolio-lab/runs/{run_id}", response_model=PortfolioRunStatus)
async def run_status(
    run_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> PortfolioRunStatus:
    _ensure_run_access(db, current_user, run_id)
    return PortfolioRunStatus(**(await get_portfolio_lab_service().get_run(run_id)))


@router.get("/portfolio-lab/runs/{run_id}/report", response_model=PortfolioReport)
async def run_report(
    run_id: str,
    force_refresh: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PortfolioReport:
    _ensure_run_access(db, current_user, run_id)
    return PortfolioReport(**(await get_portfolio_lab_service().get_report(run_id, force_refresh=force_refresh)))


@router.get("/portfolio-lab/leaderboard")
async def portfolio_lab_leaderboard(
    sort_by: str = Query(default="sharpe"),
    descending: bool = Query(default=True),
    limit: int = Query(default=50, ge=1, le=250),
    current_user: User = Depends(get_current_user),
) -> dict:
    return await get_portfolio_lab_service().leaderboard(
        sort_by=sort_by, descending=descending, limit=limit, owner_id=owner_scope(current_user)
    )
