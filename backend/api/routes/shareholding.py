from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from backend.equity.services.shareholding import ShareholdingService

router = APIRouter(prefix="/shareholding", tags=["shareholding"])
logger = logging.getLogger(__name__)
service = ShareholdingService()


def _model_to_dict(model):
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


@router.get("/{symbol}")
async def get_shareholding_pattern(symbol: str):
    symbol_clean = symbol.strip().upper()
    if not symbol_clean:
        raise HTTPException(status_code=400, detail="Symbol is required")
    try:
        payload = await service.get_shareholding(symbol_clean)
        return _model_to_dict(payload)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Shareholding fetch failed for %s", symbol_clean)
        raise HTTPException(status_code=502, detail="Shareholding fetch failed") from exc


@router.get("/{symbol}/trend")
async def get_shareholding_trend(symbol: str, quarters: int = Query(default=8, ge=1, le=24)):
    symbol_clean = symbol.strip().upper()
    if not symbol_clean:
        raise HTTPException(status_code=400, detail="Symbol is required")
    try:
        trend = await service.get_historical_shareholding(symbol_clean, quarters=quarters)
        return trend
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Shareholding trend fetch failed for %s", symbol_clean)
        raise HTTPException(status_code=502, detail="Shareholding trend fetch failed") from exc
