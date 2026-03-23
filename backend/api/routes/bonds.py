from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from backend.services.bond_service import BondService, get_bond_service

router = APIRouter(prefix="/api/bonds", tags=["bonds"])

@router.get("/screener", response_model=List[Dict[str, Any]])
async def get_bond_screener(
    rating: Optional[str] = Query(None),
    issuer_type: Optional[str] = Query(None),
    service: BondService = Depends(get_bond_service)
):
    """Bond screener with filtering options."""
    return await service.get_bond_screener(rating=rating, issuer_type=issuer_type)

@router.get("/credit-spreads", response_model=Dict[str, Any])
async def get_credit_spreads(
    service: BondService = Depends(get_bond_service)
):
    """Timeline of IG vs HY spreads."""
    return await service.get_credit_spreads()

@router.get("/ratings-migration", response_model=List[Dict[str, Any]])
async def get_ratings_migration(
    service: BondService = Depends(get_bond_service)
):
    """Recent rating upgrades and downgrades."""
    return await service.get_ratings_migration()
