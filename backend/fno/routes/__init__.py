from __future__ import annotations

from fastapi import APIRouter

from backend.fno.routes import futures

fno_router = APIRouter()
fno_router.include_router(futures.router, prefix="/api", tags=["futures"])

__all__ = ["fno_router"]
