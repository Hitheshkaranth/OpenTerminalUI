from __future__ import annotations

from fastapi import APIRouter

from backend.fno.routes import futures, greeks, oi_analysis, option_chain

fno_router = APIRouter()
fno_router.include_router(futures.router, prefix="/api", tags=["futures"])
fno_router.include_router(option_chain.router, prefix="/api", tags=["fno"])
fno_router.include_router(greeks.router, prefix="/api", tags=["fno"])
fno_router.include_router(oi_analysis.router, prefix="/api", tags=["fno"])

__all__ = ["fno_router"]
