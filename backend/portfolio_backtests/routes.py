import uuid
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from sqlalchemy.orm import Session
from backend.api.deps import get_db
from backend.portfolio_backtests.schemas import JobRequest, JobCreateResponse, JobStatusResponse, JobResultResponse
from backend.portfolio_backtests.models import PortfolioBacktestJob
from backend.portfolio_backtests.engine import run_portfolio_backtest

router = APIRouter(prefix="/portfolio-backtests", tags=["portfolio_backtests"])


@router.post("/jobs", response_model=JobCreateResponse)
async def create_job(request: JobRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    job_id = f"job_{uuid.uuid4().hex[:8]}"

    # Create DB entry
    db_job = PortfolioBacktestJob(
        id=job_id,
        status="queued",
        request_json=request.model_dump_json()
    )
    db.add(db_job)
    db.commit()

    background_tasks.add_task(run_portfolio_backtest, job_id, request, db)
    return JobCreateResponse(job_id=job_id, status="queued")


@router.get("/jobs/{job_id}/status", response_model=JobStatusResponse)
async def get_job_status(job_id: str, db: Session = Depends(get_db)):
    job = db.query(PortfolioBacktestJob).filter(PortfolioBacktestJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    progress = 1.0 if job.status in ("completed", "failed") else 0.5
    return JobStatusResponse(job_id=job.id, status=job.status, progress=progress)


@router.get("/jobs/{job_id}/result", response_model=JobResultResponse)
async def get_job_result(job_id: str, db: Session = Depends(get_db)):
    job = db.query(PortfolioBacktestJob).filter(PortfolioBacktestJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status != "completed":
        raise HTTPException(status_code=400, detail="Job not completed")

    if not job.result_json:
        raise HTTPException(status_code=500, detail="Result missing")

    return JobResultResponse(**job.result_json)
