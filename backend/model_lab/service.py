from __future__ import annotations

import asyncio
import itertools
import json
from datetime import datetime
from uuid import uuid4

from fastapi import HTTPException

from backend.api.deps import get_db
from backend.core.walk_forward import run_walk_forward_validation
from backend.model_lab.metrics import compute_run_metrics, compute_run_timeseries
from backend.model_lab.schemas import ExperimentCreate
from backend.models import ModelExperiment, ModelRun, ModelRunMetrics, ModelRunTimeseries
from backend.services.backtest_jobs import BacktestJobRequest, get_backtest_job_service
from backend.shared.cache import cache


class ModelLabService:
    def __init__(self) -> None:
        self._max_sweep_combinations = 96

    @staticmethod
    def _map_status(raw: str) -> str:
        mapping = {
            "queued": "queued",
            "running": "running",
            "done": "succeeded",
            "failed": "failed",
        }
        return mapping.get(raw, "queued")

    @staticmethod
    def _summary(row: ModelExperiment) -> dict:
        return {
            "id": row.id,
            "name": row.name,
            "description": row.description,
            "tags": list(row.tags or []),
            "model_key": row.model_key,
            "benchmark_symbol": row.benchmark_symbol,
            "start_date": row.start_date,
            "end_date": row.end_date,
            "created_at": row.created_at,
        }

    @staticmethod
    def _report_cache_key(run_id: str) -> str:
        return f"model-lab:report:{run_id}"

    async def create_experiment(self, payload: ExperimentCreate) -> dict:
        db = next(get_db())
        try:
            row = ModelExperiment(
                id=str(uuid4()),
                name=payload.name,
                description=payload.description,
                tags=payload.tags,
                model_key=payload.model_key,
                params_json=payload.params_json,
                universe_json=payload.universe_json,
                benchmark_symbol=payload.benchmark_symbol,
                start_date=payload.start_date,
                end_date=payload.end_date,
                cost_model_json=payload.cost_model_json,
                created_at=datetime.utcnow().isoformat(),
            )
            db.add(row)
            db.commit()
            return self._summary(row)
        finally:
            db.close()

    async def list_experiments(self, tag: str | None, model_key: str | None, start_date: str | None, end_date: str | None) -> list[dict]:
        db = next(get_db())
        try:
            query = db.query(ModelExperiment)
            if model_key:
                query = query.filter(ModelExperiment.model_key == model_key)
            if start_date:
                query = query.filter(ModelExperiment.start_date >= start_date)
            if end_date:
                query = query.filter(ModelExperiment.end_date <= end_date)
            rows = query.order_by(ModelExperiment.created_at.desc()).all()
            out = []
            for row in rows:
                tags = [str(item) for item in (row.tags or [])]
                if tag and tag not in tags:
                    continue
                out.append(self._summary(row))
            return out
        finally:
            db.close()

    async def get_experiment(self, experiment_id: str) -> dict:
        db = next(get_db())
        try:
            row = db.query(ModelExperiment).filter(ModelExperiment.id == experiment_id).first()
            if row is None:
                raise HTTPException(status_code=404, detail="Experiment not found")
            runs = (
                db.query(ModelRun)
                .filter(ModelRun.experiment_id == experiment_id)
                .order_by(ModelRun.started_at.desc())
                .all()
            )
            return {
                **self._summary(row),
                "params_json": row.params_json or {},
                "universe_json": row.universe_json or {},
                "cost_model_json": row.cost_model_json or {},
                "runs": [
                    {
                        "id": run.id,
                        "status": run.status,
                        "started_at": run.started_at,
                        "finished_at": run.finished_at,
                        "error": run.error,
                    }
                    for run in runs
                ],
            }
        finally:
            db.close()

    async def _sync_run_status(self, db, row: ModelRun) -> None:  # noqa: ANN001
        status = await get_backtest_job_service().get_status(row.backtest_run_id)
        mapped = self._map_status(str(status.get("status", "queued")))
        if row.status != mapped:
            row.status = mapped
            if mapped in {"succeeded", "failed"}:
                row.finished_at = datetime.utcnow().isoformat()
            db.commit()

    async def enqueue_run(self, experiment_id: str, force_refresh: bool = False) -> dict:
        db = next(get_db())
        try:
            experiment = db.query(ModelExperiment).filter(ModelExperiment.id == experiment_id).first()
            if experiment is None:
                raise HTTPException(status_code=404, detail="Experiment not found")

            universe = experiment.universe_json or {}
            tickers = universe.get("tickers") if isinstance(universe, dict) else None
            symbol = ""
            if isinstance(tickers, list) and tickers:
                symbol = str(tickers[0]).strip().upper()
            if not symbol:
                symbol = "RELIANCE"

            model_key = str(experiment.model_key).strip()
            strategy = model_key if ":" in model_key else f"example:{model_key}"

            cost = experiment.cost_model_json or {}
            config = {
                "initial_cash": float(cost.get("initial_cash", 100000.0) or 100000.0),
                "fee_bps": float(cost.get("commission_bps", 0.0) or 0.0),
                "slippage_bps": float(cost.get("slippage_bps", 0.0) or 0.0),
                "position_fraction": float(cost.get("position_fraction", 1.0) or 1.0),
            }

            backtest_run_id = await get_backtest_job_service().submit(
                BacktestJobRequest(
                    symbol=symbol,
                    asset=symbol,
                    market="NSE",
                    start=experiment.start_date,
                    end=experiment.end_date,
                    strategy=strategy,
                    context=experiment.params_json or {},
                    config=config,
                )
            )

            row = ModelRun(
                id=str(uuid4()),
                experiment_id=experiment_id,
                backtest_run_id=backtest_run_id,
                status="queued",
                started_at=datetime.utcnow().isoformat(),
                finished_at=None,
                error=None,
            )
            db.add(row)
            db.commit()

            if force_refresh:
                await cache.set(self._report_cache_key(row.id), None, ttl=1)

            return {"run_id": row.id, "status": row.status}
        finally:
            db.close()

    async def get_run(self, run_id: str) -> dict:
        db = next(get_db())
        try:
            row = db.query(ModelRun).filter(ModelRun.id == run_id).first()
            if row is None:
                raise HTTPException(status_code=404, detail="Run not found")
            await self._sync_run_status(db, row)
            return {
                "run_id": row.id,
                "experiment_id": row.experiment_id,
                "status": row.status,
                "started_at": row.started_at,
                "finished_at": row.finished_at,
                "error": row.error,
            }
        finally:
            db.close()

    async def _materialize_report(self, db, row: ModelRun, force_refresh: bool) -> dict:  # noqa: ANN001
        metrics_row = db.query(ModelRunMetrics).filter(ModelRunMetrics.run_id == row.id).first()
        series_row = db.query(ModelRunTimeseries).filter(ModelRunTimeseries.run_id == row.id).first()

        if metrics_row and series_row and not force_refresh:
            return {
                "metrics": metrics_row.metrics_json or {},
                "series": series_row.series_json or {},
            }

        backtest = await get_backtest_job_service().get_result(row.backtest_run_id)
        if str(backtest.get("status")) != "done":
            raise HTTPException(status_code=400, detail="Run result is not ready")

        payload = backtest.get("result") or {}
        equity_curve = payload.get("equity_curve") or []
        trades = payload.get("trades") or []

        metrics = compute_run_metrics(
            equity_curve=equity_curve,
            trades=trades,
            benchmark_returns=payload.get("benchmark_returns") or None,
        )
        series = compute_run_timeseries(
            equity_curve=equity_curve,
            benchmark_curve=payload.get("benchmark_curve") or [],
        )
        series["trades"] = trades

        metrics_json = {
            **metrics,
            "bars": int(payload.get("bars", len(equity_curve) or 0)),
            "initial_cash": float(payload.get("initial_cash", 0.0) or 0.0),
            "final_equity": float(payload.get("final_equity", 0.0) or 0.0),
            "pnl_amount": float(payload.get("pnl_amount", 0.0) or 0.0),
        }

        if metrics_row is None:
            metrics_row = ModelRunMetrics(run_id=row.id, metrics_json=metrics_json)
            db.add(metrics_row)
        else:
            metrics_row.metrics_json = metrics_json

        if series_row is None:
            series_row = ModelRunTimeseries(run_id=row.id, series_json=series)
            db.add(series_row)
        else:
            series_row.series_json = series

        db.commit()
        return {"metrics": metrics_json, "series": series}

    async def get_report(self, run_id: str, force_refresh: bool = False) -> dict:
        cache_key = self._report_cache_key(run_id)
        if not force_refresh:
            cached = await cache.get(cache_key)
            if isinstance(cached, dict):
                return cached

        db = next(get_db())
        try:
            row = db.query(ModelRun).filter(ModelRun.id == run_id).first()
            if row is None:
                raise HTTPException(status_code=404, detail="Run not found")

            await self._sync_run_status(db, row)
            if row.status == "failed":
                return {
                    "run_id": row.id,
                    "status": row.status,
                    "error": row.error,
                    "metrics": {},
                    "series": {},
                }
            if row.status != "succeeded":
                return {"run_id": row.id, "status": row.status, "metrics": {}, "series": {}}

            materialized = await self._materialize_report(db, row, force_refresh)
            payload = {
                "run_id": row.id,
                "experiment_id": row.experiment_id,
                "status": row.status,
                "metrics": materialized["metrics"],
                "series": materialized["series"],
            }
            await cache.set(cache_key, payload, ttl=300)
            return payload
        finally:
            db.close()

    async def compare(self, run_ids: list[str]) -> dict:
        reports = []
        for run_id in run_ids[:6]:
            report = await self.get_report(run_id)
            reports.append(report)

        comparison_rows = []
        for report in reports:
            metrics = report.get("metrics") or {}
            comparison_rows.append(
                {
                    "run_id": report.get("run_id"),
                    "status": report.get("status"),
                    "total_return": metrics.get("total_return", 0.0),
                    "sharpe": metrics.get("sharpe", 0.0),
                    "sortino": metrics.get("sortino", 0.0),
                    "max_drawdown": metrics.get("max_drawdown", 0.0),
                    "calmar": metrics.get("calmar", 0.0),
                    "vol_annual": metrics.get("vol_annual", 0.0),
                    "turnover": metrics.get("turnover", 0.0),
                }
            )

        pareto = []
        for idx, candidate in enumerate(comparison_rows):
            dominated = False
            for jdx, other in enumerate(comparison_rows):
                if idx == jdx:
                    continue
                if (
                    float(other["total_return"]) >= float(candidate["total_return"])
                    and float(other["max_drawdown"]) <= float(candidate["max_drawdown"])
                    and (
                        float(other["total_return"]) > float(candidate["total_return"])
                        or float(other["max_drawdown"]) < float(candidate["max_drawdown"])
                    )
                ):
                    dominated = True
                    break
            pareto.append(not dominated)

        return {
            "runs": reports,
            "summary": [
                {
                    **comparison_rows[idx],
                    "pareto": pareto[idx],
                }
                for idx in range(len(comparison_rows))
            ],
        }

    async def _wait_for_backtest(self, backtest_run_id: str, timeout_seconds: float = 120.0) -> dict:
        deadline = asyncio.get_event_loop().time() + timeout_seconds
        while asyncio.get_event_loop().time() < deadline:
            result = await get_backtest_job_service().get_result(backtest_run_id)
            status = str(result.get("status", ""))
            if status in {"done", "failed", "not_found"}:
                return result
            await asyncio.sleep(0.5)
        raise HTTPException(status_code=504, detail="Backtest run timed out")

    async def walk_forward(self, experiment_id: str, train_window_days: int, test_window_days: int) -> dict:
        queued = await self.enqueue_run(experiment_id=experiment_id)
        run = await self.get_run(queued["run_id"])

        db = next(get_db())
        try:
            row = db.query(ModelRun).filter(ModelRun.id == run["run_id"]).first()
            if row is None:
                raise HTTPException(status_code=404, detail="Run not found")
            result = await self._wait_for_backtest(row.backtest_run_id)
            if str(result.get("status")) != "done":
                raise HTTPException(status_code=400, detail="Backtest failed during walk-forward")
            payload = result.get("result") or {}
            ratio = float(train_window_days) / float(train_window_days + test_window_days)
            validation = run_walk_forward_validation(
                equity_curve=payload.get("equity_curve", []),
                folds=max(2, min(12, int((train_window_days + test_window_days) / max(test_window_days, 1)))),
                in_sample_ratio=max(0.1, min(0.95, ratio)),
            )
            return {
                "experiment_id": experiment_id,
                "run_id": run["run_id"],
                "train_window_days": train_window_days,
                "test_window_days": test_window_days,
                "validation": validation,
            }
        finally:
            db.close()

    async def param_sweep(self, experiment_id: str, grid: dict[str, list], max_combinations: int) -> dict:
        if not grid:
            raise HTTPException(status_code=400, detail="Param grid is required")

        effective_cap = min(max_combinations, self._max_sweep_combinations)
        keys = [key for key, values in grid.items() if isinstance(values, list) and values]
        if not keys:
            raise HTTPException(status_code=400, detail="Param grid is empty")

        values = [grid[key] for key in keys]
        combinations = list(itertools.product(*values))
        if len(combinations) > effective_cap:
            raise HTTPException(
                status_code=400,
                detail=f"Sweep exceeds limit ({len(combinations)} > {effective_cap})",
            )

        db = next(get_db())
        try:
            experiment = db.query(ModelExperiment).filter(ModelExperiment.id == experiment_id).first()
            if experiment is None:
                raise HTTPException(status_code=404, detail="Experiment not found")

            universe = experiment.universe_json or {}
            tickers = universe.get("tickers") if isinstance(universe, dict) else None
            symbol = str(tickers[0]).strip().upper() if isinstance(tickers, list) and tickers else "RELIANCE"
            strategy = experiment.model_key if ":" in experiment.model_key else f"example:{experiment.model_key}"

            rows = []
            for combo in combinations:
                context = dict(experiment.params_json or {})
                for idx, key in enumerate(keys):
                    context[key] = combo[idx]

                backtest_run_id = await get_backtest_job_service().submit(
                    BacktestJobRequest(
                        symbol=symbol,
                        asset=symbol,
                        market="NSE",
                        start=experiment.start_date,
                        end=experiment.end_date,
                        strategy=strategy,
                        context=context,
                        config={
                            "initial_cash": 100000.0,
                            "fee_bps": 0.0,
                            "slippage_bps": 0.0,
                            "position_fraction": 1.0,
                        },
                    )
                )
                result = await self._wait_for_backtest(backtest_run_id)
                status = str(result.get("status"))
                if status != "done":
                    rows.append({"params": context, "status": status})
                    continue
                payload = result.get("result") or {}
                metrics = compute_run_metrics(payload.get("equity_curve") or [], payload.get("trades") or [])
                rows.append(
                    {
                        "params": context,
                        "status": "succeeded",
                        "total_return": metrics.get("total_return", 0.0),
                        "sharpe": metrics.get("sharpe", 0.0),
                        "max_drawdown": metrics.get("max_drawdown", 0.0),
                        "calmar": metrics.get("calmar", 0.0),
                    }
                )

            best = sorted(
                [row for row in rows if row.get("status") == "succeeded"],
                key=lambda item: (float(item.get("sharpe", 0.0)), float(item.get("total_return", 0.0))),
                reverse=True,
            )

            return {
                "experiment_id": experiment_id,
                "grid_keys": keys,
                "total_combinations": len(combinations),
                "results": rows,
                "best": best[0] if best else None,
            }
        finally:
            db.close()


model_lab_service = ModelLabService()


def get_model_lab_service() -> ModelLabService:
    return model_lab_service
