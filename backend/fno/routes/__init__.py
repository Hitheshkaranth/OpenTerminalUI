from __future__ import annotations

from fastapi import APIRouter

from backend.fno.routes import expiry, futures, greeks, heatmap, iv, oi_analysis, option_chain, pcr, strategy

fno_router = APIRouter()
fno_router.include_router(futures.router, prefix="/api", tags=["futures"])
fno_router.include_router(option_chain.router, prefix="/api", tags=["fno"])
fno_router.include_router(greeks.router, prefix="/api", tags=["fno"])
fno_router.include_router(oi_analysis.router, prefix="/api", tags=["fno"])
fno_router.include_router(strategy.router, prefix="/api", tags=["fno"])
fno_router.include_router(pcr.router, prefix="/api", tags=["fno"])
fno_router.include_router(iv.router, prefix="/api", tags=["fno"])
fno_router.include_router(heatmap.router, prefix="/api", tags=["fno"])
fno_router.include_router(expiry.router, prefix="/api", tags=["fno"])

__all__ = ["fno_router"]
