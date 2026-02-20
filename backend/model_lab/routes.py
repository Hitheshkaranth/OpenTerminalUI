from __future__ import annotations

from fastapi import APIRouter, Query

from backend.model_lab.schemas import (
    CompareRequest,
    ExperimentCreate,
    ExperimentRunRequest,
    ExperimentSummary,
    ParamSweepRequest,
    RunMetrics,
    RunTimeseries,
    WalkForwardRequest,
)
from backend.model_lab.service import get_model_lab_service

router = APIRouter()


@router.post("/model-lab/experiments", response_model=ExperimentSummary)
async def create_experiment(payload: ExperimentCreate) -> ExperimentSummary:
    created = await get_model_lab_service().create_experiment(payload)
    return ExperimentSummary(**created)


@router.get("/model-lab/experiments")
async def list_experiments(
    tag: str | None = Query(default=None),
    model: str | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
) -> dict:
    items = await get_model_lab_service().list_experiments(
        tag=tag,
        model_key=model,
        start_date=start_date,
        end_date=end_date,
    )
    return {"items": items}


@router.get("/model-lab/experiments/{experiment_id}")
async def get_experiment(experiment_id: str) -> dict:
    return await get_model_lab_service().get_experiment(experiment_id)


@router.post("/model-lab/experiments/{experiment_id}/run")
async def run_experiment(experiment_id: str, payload: ExperimentRunRequest) -> dict:
    return await get_model_lab_service().enqueue_run(experiment_id=experiment_id, force_refresh=payload.force_refresh)


@router.get("/model-lab/runs/{run_id}")
async def run_status(run_id: str) -> dict:
    return await get_model_lab_service().get_run(run_id)


@router.get("/model-lab/runs/{run_id}/report")
async def run_report(run_id: str, force_refresh: bool = Query(default=False)) -> dict:
    report = await get_model_lab_service().get_report(run_id=run_id, force_refresh=force_refresh)
    if "metrics" in report:
        RunMetrics(run_id=run_id, metrics=report.get("metrics") or {})
    if "series" in report:
        RunTimeseries(run_id=run_id, series=report.get("series") or {})
    return report


@router.post("/model-lab/compare")
async def compare_runs(payload: CompareRequest) -> dict:
    return await get_model_lab_service().compare(payload.run_ids)


@router.post("/model-lab/experiments/{experiment_id}/walk-forward")
async def run_walk_forward(experiment_id: str, payload: WalkForwardRequest) -> dict:
    return await get_model_lab_service().walk_forward(
        experiment_id=experiment_id,
        train_window_days=payload.train_window_days,
        test_window_days=payload.test_window_days,
    )


@router.post("/model-lab/experiments/{experiment_id}/param-sweep")
async def run_param_sweep(experiment_id: str, payload: ParamSweepRequest) -> dict:
    return await get_model_lab_service().param_sweep(
        experiment_id=experiment_id,
        grid=payload.grid,
        max_combinations=payload.max_combinations,
    )
