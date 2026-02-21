from fastapi import APIRouter, Query
from backend.tca.schemas import TCAResponse
from backend.tca.service import generate_tca_report

router = APIRouter(prefix="/paper/tca", tags=["paper_tca"])

@router.get("", response_model=TCAResponse)
async def get_tca(window: str = Query("1d", description="Time window for TCA analysis")):
    return generate_tca_report(window)
