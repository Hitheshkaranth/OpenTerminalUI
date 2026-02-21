from fastapi import APIRouter
from backend.cockpit.schemas import CockpitSummary
from backend.cockpit.service import get_cockpit_summary as fetch_cockpit_summary

router = APIRouter(prefix="/cockpit", tags=["cockpit"])


@router.get("/summary", response_model=CockpitSummary)
async def get_cockpit_summary_route():
    """
    Get aggregated cockpit summary.
    """
    return await fetch_cockpit_summary()
