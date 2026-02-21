from fastapi import APIRouter
from backend.data_quality.schemas import (
    DataQualityRunRequest,
    DataQualityRunResponse,
    DataQualityDashboardResponse
)
from backend.data_quality.service import run_quality_scan, get_dashboard_summary

router = APIRouter(prefix="/data-quality", tags=["data_quality"])


@router.post("/run", response_model=DataQualityRunResponse)
async def run_data_quality_scan(request: DataQualityRunRequest):
    return run_quality_scan(request.dataset_id)


@router.get("/dashboard", response_model=DataQualityDashboardResponse)
async def get_data_quality_dashboard():
    return get_dashboard_summary()
