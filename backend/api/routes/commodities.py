from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.services.commodity_service import (
    CommodityFuturesChainResponse,
    CommodityQuotesResponse,
    CommoditySeasonalResponse,
    CommodityService,
    get_commodities_service,
)

router = APIRouter()


@router.get("/commodities/quotes", response_model=CommodityQuotesResponse)
async def get_commodity_quotes(
    service: CommodityService = Depends(get_commodities_service),
) -> CommodityQuotesResponse:
    return await service.get_quotes()


@router.get("/commodities/futures-chain/{symbol}", response_model=CommodityFuturesChainResponse)
async def get_commodity_futures_chain(
    symbol: str,
    service: CommodityService = Depends(get_commodities_service),
) -> CommodityFuturesChainResponse:
    try:
        return await service.get_futures_chain(symbol)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/commodities/seasonal/{symbol}", response_model=CommoditySeasonalResponse)
async def get_commodity_seasonal(
    symbol: str,
    service: CommodityService = Depends(get_commodities_service),
) -> CommoditySeasonalResponse:
    try:
        return await service.get_seasonal(symbol)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
