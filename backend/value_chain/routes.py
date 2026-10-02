from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.value_chain import service

router = APIRouter(prefix="/api/value-chain", tags=["value-chain"])


class ExtractRequest(BaseModel):
    use_llm: bool = True


@router.get("/{symbol}")
async def get_value_chain(symbol: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Return the stored value chain for a symbol, or build one on the fly.

    The on-the-fly build (no stored snapshot) is LLM-free: it surfaces
    competitors from the peers dataset and curated raw materials.
    """
    return await service.fetch_value_chain(db, symbol, use_llm=False)


@router.post("/{symbol}/extract")
async def extract_value_chain(
    symbol: str,
    payload: ExtractRequest | None = None,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    use_llm = payload.use_llm if payload is not None else True
    if not (symbol or "").strip():
        raise HTTPException(status_code=400, detail="symbol is required")
    return await service.extract_value_chain(db, symbol, use_llm=use_llm)