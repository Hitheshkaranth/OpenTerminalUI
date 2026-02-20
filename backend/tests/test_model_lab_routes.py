from __future__ import annotations

import asyncio

from backend.model_lab import routes
from backend.model_lab.schemas import CompareRequest, ExperimentCreate, ExperimentRunRequest, ParamSweepRequest, WalkForwardRequest


class _FakeService:
    async def create_experiment(self, payload: ExperimentCreate) -> dict:
        return {
            "id": "exp_1",
            "name": payload.name,
            "description": payload.description,
            "tags": payload.tags,
            "model_key": payload.model_key,
            "benchmark_symbol": payload.benchmark_symbol,
            "start_date": payload.start_date,
            "end_date": payload.end_date,
            "created_at": "2026-02-19T00:00:00",
        }

    async def list_experiments(self, tag, model_key, start_date, end_date):  # noqa: ANN001
        return [{"id": "exp_1", "name": "Alpha", "description": "", "tags": ["r1"], "model_key": "example:sma_crossover", "benchmark_symbol": "NIFTY50", "start_date": "2025-01-01", "end_date": "2025-12-31", "created_at": "2026-02-19T00:00:00"}]

    async def get_experiment(self, experiment_id: str) -> dict:
        return {"id": experiment_id, "name": "Alpha", "runs": []}

    async def enqueue_run(self, experiment_id: str, force_refresh: bool = False) -> dict:
        del force_refresh
        return {"run_id": f"run_{experiment_id}", "status": "queued"}

    async def get_run(self, run_id: str) -> dict:
        return {"run_id": run_id, "status": "running"}

    async def get_report(self, run_id: str, force_refresh: bool = False) -> dict:
        del force_refresh
        return {"run_id": run_id, "status": "succeeded", "metrics": {"sharpe": 1.2}, "series": {"equity_curve": []}}

    async def compare(self, run_ids: list[str]) -> dict:
        return {"runs": [{"run_id": run_id} for run_id in run_ids], "summary": []}

    async def walk_forward(self, experiment_id: str, train_window_days: int, test_window_days: int) -> dict:
        return {
            "experiment_id": experiment_id,
            "train_window_days": train_window_days,
            "test_window_days": test_window_days,
            "validation": {"folds": []},
        }

    async def param_sweep(self, experiment_id: str, grid: dict, max_combinations: int) -> dict:
        return {
            "experiment_id": experiment_id,
            "grid_keys": list(grid.keys()),
            "total_combinations": max_combinations,
            "results": [],
            "best": None,
        }


def test_create_list_run_report_compare(monkeypatch) -> None:
    monkeypatch.setattr(routes, "get_model_lab_service", lambda: _FakeService())

    created = asyncio.run(
        routes.create_experiment(
            ExperimentCreate(
                name="Alpha",
                description="Desc",
                tags=["daily"],
                model_key="example:sma_crossover",
                start_date="2025-01-01",
                end_date="2025-12-31",
            )
        )
    )
    assert created.id == "exp_1"

    listing = asyncio.run(routes.list_experiments())
    assert len(listing["items"]) == 1

    enqueued = asyncio.run(routes.run_experiment("exp_1", ExperimentRunRequest()))
    assert enqueued["status"] == "queued"

    status = asyncio.run(routes.run_status("run_exp_1"))
    assert status["status"] == "running"

    report = asyncio.run(routes.run_report("run_exp_1"))
    assert report["metrics"]["sharpe"] == 1.2

    compare = asyncio.run(routes.compare_runs(CompareRequest(run_ids=["r1", "r2"])))
    assert len(compare["runs"]) == 2


def test_walk_forward_and_param_sweep(monkeypatch) -> None:
    monkeypatch.setattr(routes, "get_model_lab_service", lambda: _FakeService())

    wf = asyncio.run(routes.run_walk_forward("exp_1", WalkForwardRequest(train_window_days=252, test_window_days=63)))
    assert wf["train_window_days"] == 252

    sweep = asyncio.run(
        routes.run_param_sweep(
            "exp_1",
            ParamSweepRequest(grid={"short_window": [10, 20], "long_window": [50, 100]}, max_combinations=4),
        )
    )
    assert sweep["total_combinations"] == 4
