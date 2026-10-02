from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.business_metrics import service

router = APIRouter(prefix="/api/business", tags=["business-metrics"])


class ExtractRequest(BaseModel):
    use_llm: bool = True


@router.get("/{symbol}/metrics")
def get_metrics(symbol: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    return service.get_metrics(db, symbol)


@router.post("/{symbol}/metrics/extract")
async def extract_metrics(symbol: str, payload: ExtractRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    return await service.extract(db, symbol, use_llm=payload.use_llm)