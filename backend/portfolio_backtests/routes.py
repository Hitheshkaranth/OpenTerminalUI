import json
import uuid
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, Request
from sqlalchemy.orm import Session
from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.portfolio_backtests.schemas import JobRequest, JobCreateResponse, JobStatusResponse, JobResultResponse
from backend.portfolio_backtests.models import PortfolioBacktestJob
from backend.portfolio_backtests.engine import run_portfolio_backtest

router = APIRouter(prefix="/portfolio-backtests", tags=["portfolio_backtests"])


def _owner_id(current_user: Any) -> str | None:
    user_id = getattr(current_user, "id", None)
    return str(user_id) if user_id is not None else None


def _job_owner(job: PortfolioBacktestJob) -> str | None:
    # No owner column exists yet; the owner rides inside request_json.
    raw = job.request_json
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
        owner = data.get("owner_id") if isinstance(data, dict) else None
    except (TypeError, ValueError):
        return None
    return str(owner) if owner is not None else None


def _owned_job_or_404(db: Session, job_id: str, current_user: Any) -> PortfolioBacktestJob:
    job = db.query(PortfolioBacktestJob).filter(PortfolioBacktestJob.id == job_id).first()
    if not job or _job_owner(job) != _owner_id(current_user):
        raise HTTPException(status_code=404, detail="Job not found")
    return job


async def _run_job_with_own_session(job_id: str, job_request: JobRequest, session_provider: Callable) -> None:
    """Background task: open a fresh session (the request's is already closed)."""
    gen = session_provider()
    db = next(gen)
    try:
        await run_portfolio_backtest(job_id, job_request, db)
    finally:
        gen.close()


@router.post("/jobs", response_model=JobCreateResponse)
async def create_job(
    request: JobRequest,
    background_tasks: BackgroundTasks,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    job_id = f"job_{uuid.uuid4().hex[:8]}"

    # Create DB entry
    db_job = PortfolioBacktestJob(
        id=job_id,
        status="queued",
        request_json=json.dumps({**request.model_dump(mode="json"), "owner_id": _owner_id(current_user)}),
    )
    db.add(db_job)
    db.commit()

    # Resolve the session factory the same way FastAPI does (honours overrides).
    session_provider = http_request.app.dependency_overrides.get(get_db, get_db)
    background_tasks.add_task(_run_job_with_own_session, job_id, request, session_provider)
    return JobCreateResponse(job_id=job_id, status="queued")


@router.get("/jobs/{job_id}/status", response_model=JobStatusResponse)
async def get_job_status(job_id: str, db: Session = Depends(get_db), current_user: Any = Depends(get_current_user)):
    job = _owned_job_or_404(db, job_id, current_user)

    progress = 1.0 if job.status in ("completed", "failed") else 0.5
    return JobStatusResponse(job_id=job.id, status=job.status, progress=progress)


@router.get("/jobs/{job_id}/result", response_model=JobResultResponse)
async def get_job_result(job_id: str, db: Session = Depends(get_db), current_user: Any = Depends(get_current_user)):
    job = _owned_job_or_404(db, job_id, current_user)

    if job.status != "completed":
        raise HTTPException(status_code=400, detail="Job not completed")

    if not job.result_json:
        raise HTTPException(status_code=500, detail="Result missing")

    return JobResultResponse(**job.result_json)
