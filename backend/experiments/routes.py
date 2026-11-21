from typing import List
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models.ownership import owner_scope
from backend.models.user import User
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
async def create_experiment(
    request: ExperimentCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    exp = service.create_experiment(db, request, owner_id=current_user.id)
    return exp


@router.get("", response_model=List[ExperimentResponse])
async def list_experiments(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    exps = service.get_experiments(db, owner_id=owner_scope(current_user))
    return exps


@router.get("/{experiment_id}", response_model=ExperimentResponse)
async def get_experiment(
    experiment_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    exp = service.get_experiment_by_id(db, experiment_id, owner_id=owner_scope(current_user))
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return exp


@router.post("/compare", response_model=ExperimentCompareResponse)
async def compare_experiments(
    request: ExperimentCompareRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    res = service.compare_experiments(db, request.experiment_ids, owner_id=owner_scope(current_user))
    return ExperimentCompareResponse(metrics_table=res["metrics_table"], deltas=res["deltas"])


@router.post("/{experiment_id}/promote-to-paper", response_model=PromoteResponse)
async def promote_to_paper(
    experiment_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    try:
        receipt = service.promote_experiment_to_paper(db, experiment_id, owner_id=owner_scope(current_user))
        return PromoteResponse(receipt_id=receipt, status="promoted")
    except ValueError:
        raise HTTPException(status_code=404, detail="Experiment not found")
    except NotImplementedError:
        raise HTTPException(
            status_code=501,
            detail=(
                "Paper promotion is unavailable for the legacy experiment registry: "
                "no execution engine is connected and no paper strategy was created."
            ),
        )
