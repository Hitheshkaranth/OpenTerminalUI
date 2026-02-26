from typing import List
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from backend.api.deps import get_db
from backend.experiments.schemas import (
    ExperimentCreate,
    ExperimentResponse,
    ExperimentCompareRequest,
    ExperimentCompareResponse,
    PromoteResponse
)
from backend.experiments import service

router = APIRouter(prefix="/experiments", tags=["experiments"])


@router.post("", response_model=ExperimentResponse)
async def create_experiment(request: ExperimentCreate, db: Session = Depends(get_db)):
    exp = service.create_experiment(db, request)
    return exp


@router.get("", response_model=List[ExperimentResponse])
async def list_experiments(db: Session = Depends(get_db)):
    exps = service.get_experiments(db)
    return exps


@router.get("/{experiment_id}", response_model=ExperimentResponse)
async def get_experiment(experiment_id: int, db: Session = Depends(get_db)):
    exp = service.get_experiment_by_id(db, experiment_id)
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return exp


@router.post("/compare", response_model=ExperimentCompareResponse)
async def compare_experiments(request: ExperimentCompareRequest, db: Session = Depends(get_db)):
    res = service.compare_experiments(db, request.experiment_ids)
    return ExperimentCompareResponse(metrics_table=res["metrics_table"], deltas=res["deltas"])


@router.post("/{experiment_id}/promote-to-paper", response_model=PromoteResponse)
async def promote_to_paper(experiment_id: int, db: Session = Depends(get_db)):
    try:
        receipt = service.promote_experiment_to_paper(db, experiment_id)
        return PromoteResponse(receipt_id=receipt, status="promoted")
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
