from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models import ModelRegistryORM, ModelRun, User
from backend.oms.service import log_audit

router = APIRouter()


class RunMetaRequest(BaseModel):
    run_id: str
    data_version_id: str | None = None
    code_hash: str | None = None
    execution_profile: dict[str, Any] = Field(default_factory=dict)


class PromoteRequest(BaseModel):
    registry_name: str
    run_id: str
    stage: str = Field(default="staging", pattern="^(staging|prod)$")
    metadata: dict[str, Any] = Field(default_factory=dict)


@router.post("/governance/runs/register")
def register_run_meta(
    payload: RunMetaRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = db.query(ModelRun).filter(ModelRun.id == payload.run_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Model run not found")
    row.data_version_id = payload.data_version_id
    row.code_hash = payload.code_hash
    row.execution_profile_json = payload.execution_profile
    db.commit()
    log_audit(
        db=db,
        event_type="governance_run_registered",
        entity_type="model_run",
        entity_id=row.id,
        payload={"data_version_id": payload.data_version_id, "code_hash": payload.code_hash},
        user_id=current_user.id,
    )
    return {"status": "updated", "run_id": row.id}


@router.get("/governance/runs/compare")
def compare_runs(
    run_ids: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    ids = [x.strip() for x in run_ids.split(",") if x.strip()]
    rows = db.query(ModelRun).filter(ModelRun.id.in_(ids)).all()
    return {
        "items": [
            {
                "id": row.id,
                "experiment_id": row.experiment_id,
                "status": row.status,
                "data_version_id": row.data_version_id,
                "code_hash": row.code_hash,
                "execution_profile": row.execution_profile_json if isinstance(row.execution_profile_json, dict) else {},
                "started_at": row.started_at,
                "finished_at": row.finished_at,
            }
            for row in rows
        ]
    }


@router.post("/governance/model-registry/promote")
def promote_model(
    payload: PromoteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    run = db.query(ModelRun).filter(ModelRun.id == payload.run_id).first()
    if run is None:
        raise HTTPException(status_code=404, detail="Model run not found")
    entry = ModelRegistryORM(
        name=payload.registry_name.strip(),
        run_id=payload.run_id,
        stage=payload.stage,
        promoted_at=datetime.utcnow(),
        metadata_json=payload.metadata,
        created_at=datetime.utcnow(),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    log_audit(
        db=db,
        event_type="governance_model_promoted",
        entity_type="model_registry",
        entity_id=entry.id,
        payload={"name": entry.name, "run_id": entry.run_id, "stage": entry.stage},
        user_id=current_user.id,
    )
    return {
        "id": entry.id,
        "name": entry.name,
        "run_id": entry.run_id,
        "stage": entry.stage,
        "promoted_at": entry.promoted_at.isoformat() if entry.promoted_at else None,
    }
