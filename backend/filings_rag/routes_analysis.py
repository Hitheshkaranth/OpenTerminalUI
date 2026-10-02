from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.filings_rag import analyze as analyze_module
from backend.filings_rag import taxonomy
from backend.filings_rag.models import FilingAnalysisORM

router = APIRouter()


class AnalyzeRequest(BaseModel):
    use_llm: bool = True
    drivers: list[str] | None = None


class AskRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=500)
    k: int = Field(default=6, ge=1, le=20)


class TaxonomyResponse(BaseModel):
    growth: list[dict[str, Any]]
    headwind: list[dict[str, Any]]


def _public_driver(driver: dict) -> dict:
    return {
        "id": driver["id"],
        "label": driver["label"],
        "kind": driver["kind"],
        "description": driver["description"],
    }


@router.post("/{symbol}/analyze")
async def post_analyze(
    symbol: str,
    body: AnalyzeRequest,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if not symbol.strip():
        raise HTTPException(status_code=400, detail="symbol must not be empty")
    return await analyze_module.analyze(
        db,
        symbol,
        use_llm=body.use_llm,
        drivers=body.drivers,
    )


@router.get("/{symbol}/analysis")
async def get_analysis(
    symbol: str,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    stmt = (
        select(FilingAnalysisORM)
        .where(FilingAnalysisORM.symbol == symbol)
        .order_by(FilingAnalysisORM.created_at.desc())
        .limit(1)
    )
    row = db.execute(stmt).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail=f"No analysis found for symbol '{symbol}'.")
    payload = dict(row.payload)
    payload["id"] = row.id
    return payload


@router.post("/{symbol}/ask")
async def post_ask(
    symbol: str,
    body: AskRequest,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if not symbol.strip():
        raise HTTPException(status_code=400, detail="symbol must not be empty")
    return await analyze_module.ask(db, symbol, body.question, k=body.k)


@router.get("/taxonomy")
async def get_taxonomy() -> dict[str, Any]:
    return {
        "growth": [_public_driver(d) for d in taxonomy.drivers_for("growth")],
        "headwind": [_public_driver(d) for d in taxonomy.drivers_for("headwind")],
    }