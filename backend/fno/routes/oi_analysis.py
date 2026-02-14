from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from backend.fno.services.oi_analyzer import get_oi_analyzer
from backend.fno.services.option_chain_fetcher import get_option_chain_fetcher

router = APIRouter()


@router.get("/fno/oi/{symbol}")
async def get_oi_analysis(
    symbol: str,
    expiry: str | None = Query(default=None),
    range: int = Query(default=20, ge=5, le=100),
) -> dict[str, Any]:
    fetcher = get_option_chain_fetcher()
    analyzer = get_oi_analyzer()
    chain = await fetcher.get_option_chain(symbol, expiry=expiry, strike_range=range)
    buildup = analyzer.analyze_oi_buildup(chain)
    max_pain = analyzer.find_max_pain(chain)
    sr = analyzer.find_support_resistance(chain)
    pcr = analyzer.get_pcr(chain)
    return {
        "symbol": chain.get("symbol"),
        "expiry_date": chain.get("expiry_date"),
        "spot_price": chain.get("spot_price"),
        "max_pain": max_pain,
        "support_resistance": sr,
        "pcr": pcr,
        "buildup": buildup.get("strikes", []),
    }


@router.get("/fno/oi/{symbol}/pcr")
async def get_oi_pcr(
    symbol: str,
    expiry: str | None = Query(default=None),
    range: int = Query(default=20, ge=5, le=100),
) -> dict[str, Any]:
    fetcher = get_option_chain_fetcher()
    analyzer = get_oi_analyzer()
    chain = await fetcher.get_option_chain(symbol, expiry=expiry, strike_range=range)
    return {
        "symbol": chain.get("symbol"),
        "expiry_date": chain.get("expiry_date"),
        **analyzer.get_pcr(chain),
    }
