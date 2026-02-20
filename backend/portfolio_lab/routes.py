from __future__ import annotations

from fastapi import APIRouter, Query

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


@router.post("/portfolio-lab/portfolios", response_model=PortfolioDefinitionSummary)
async def create_portfolio(payload: PortfolioDefinitionCreate) -> PortfolioDefinitionSummary:
    row = await get_portfolio_lab_service().create_portfolio(payload)
    return PortfolioDefinitionSummary(**row)


@router.get("/portfolio-lab/portfolios")
async def list_portfolios(
    tag: str | None = Query(default=None),
    weighting_method: str | None = Query(default=None),
) -> dict:
    items = await get_portfolio_lab_service().list_portfolios(tag=tag, weighting_method=weighting_method)
    return {"items": items}


@router.get("/portfolio-lab/portfolios/{portfolio_id}")
async def get_portfolio(portfolio_id: str) -> dict:
    return await get_portfolio_lab_service().get_portfolio(portfolio_id)


@router.post("/portfolio-lab/blends")
async def create_blend(payload: StrategyBlendCreate) -> dict:
    return await get_portfolio_lab_service().create_blend(payload)


@router.get("/portfolio-lab/blends")
async def list_blends() -> dict:
    return {"items": await get_portfolio_lab_service().list_blends()}


@router.post("/portfolio-lab/portfolios/{portfolio_id}/run", response_model=PortfolioRunStatus)
async def run_portfolio(portfolio_id: str, payload: PortfolioRunRequest) -> PortfolioRunStatus:
    run = await get_portfolio_lab_service().run_portfolio(
        portfolio_id=portfolio_id,
        blend_id=payload.blend_id,
        force_refresh=payload.force_refresh,
    )
    return PortfolioRunStatus(**run)


@router.get("/portfolio-lab/runs/{run_id}", response_model=PortfolioRunStatus)
async def run_status(run_id: str) -> PortfolioRunStatus:
    return PortfolioRunStatus(**(await get_portfolio_lab_service().get_run(run_id)))


@router.get("/portfolio-lab/runs/{run_id}/report", response_model=PortfolioReport)
async def run_report(run_id: str, force_refresh: bool = Query(default=False)) -> PortfolioReport:
    return PortfolioReport(**(await get_portfolio_lab_service().get_report(run_id, force_refresh=force_refresh)))
