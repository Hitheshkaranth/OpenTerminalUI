from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.filings_rag import knowledge
from backend.filings_rag.models import FilingKnowledgeORM

# OWNER: agent C

router = APIRouter()


class KnowledgeBuildRequest(BaseModel):
    use_llm: bool = True


@router.get("/{symbol}/knowledge")
def get_knowledge(symbol: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    symbol_u = symbol.strip().upper()
    row = (
        db.query(FilingKnowledgeORM)
        .filter(FilingKnowledgeORM.symbol == symbol_u)
        .order_by(FilingKnowledgeORM.created_at.desc())
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail=f"No knowledge built for symbol {symbol_u}")
    return row.payload


@router.post("/{symbol}/knowledge/build")
async def build_knowledge_route(
    symbol: str,
    payload: KnowledgeBuildRequest,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return await knowledge.build_knowledge(db, symbol, use_llm=payload.use_llm)