from __future__ import annotations

import asyncio
import json
from dataclasses import asdict, dataclass
from datetime import datetime
from uuid import uuid4

import pandas as pd

from backend.api.deps import get_db
from backend.core.backtesting_models import BacktestConfig
from backend.core.historical_data_service import get_historical_data_service
from backend.core.single_asset_backtest import BacktestEngine
from backend.core.strategy_runner import StrategyRunner
from backend.db.models import BacktestRun


@dataclass(frozen=True)
class BacktestJobRequest:
    symbol: str
    market: str = "NSE"
    start: str | None = None
    end: str | None = None
    limit: int = 500
    strategy: str = "example:sma_crossover"
    context: dict | None = None
    config: dict | None = None


class BacktestJobService:
    def __init__(self) -> None:
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._worker_task: asyncio.Task[None] | None = None
        self._runner = StrategyRunner(timeout_seconds=2.0)

    async def ensure_worker(self) -> None:
        if self._worker_task and not self._worker_task.done():
            return
        self._worker_task = asyncio.create_task(self._worker(), name="backtest-jobs-worker")

    async def submit(self, req: BacktestJobRequest) -> str:
        run_id = f"bt_{uuid4().hex[:12]}"
        db = next(get_db())
        try:
            row = BacktestRun(
                run_id=run_id,
                status="queued",
                request_json=json.dumps(asdict(req)),
            )
            db.add(row)
            db.commit()
            await self._queue.put(run_id)
        finally:
            db.close()
        await self.ensure_worker()
        return run_id

    async def _worker(self) -> None:
        while True:
            run_id = await self._queue.get()
            try:
                await self._execute(run_id)
            finally:
                self._queue.task_done()

    async def _execute(self, run_id: str) -> None:
        db = next(get_db())
        try:
            row = db.query(BacktestRun).filter(BacktestRun.run_id == run_id).first()
            if row is None:
                return
            row.status = "running"
            row.updated_at = datetime.utcnow().isoformat()
            db.commit()

            req = BacktestJobRequest(**json.loads(row.request_json))
            service = get_historical_data_service()
            symbol, bars = service.fetch_daily_ohlcv(
                raw_symbol=req.symbol,
                market=req.market,
                start=req.start,
                end=req.end,
                limit=req.limit,
            )
            frame = pd.DataFrame(
                [
                    {
                        "date": b.date,
                        "open": b.open,
                        "high": b.high,
                        "low": b.low,
                        "close": b.close,
                        "volume": b.volume,
                    }
                    for b in bars
                ]
            )
            if frame.empty:
                raise ValueError("No OHLCV bars available for request")
            strategy_out = self._runner.run(req.strategy, frame, context=req.context or {})
            cfg = BacktestConfig(**(req.config or {}))
            result = BacktestEngine(cfg).run(symbol=symbol.canonical, frame=frame, signals=strategy_out.signals)
            row.result_json = result.model_dump_json()
            row.logs = strategy_out.stdout + (f"\nSTDERR:\n{strategy_out.stderr}" if strategy_out.stderr else "")
            row.status = "done"
            row.error = ""
            row.updated_at = datetime.utcnow().isoformat()
            db.commit()
        except Exception as exc:
            row = db.query(BacktestRun).filter(BacktestRun.run_id == run_id).first()
            if row is not None:
                row.status = "failed"
                row.error = str(exc)
                row.updated_at = datetime.utcnow().isoformat()
                db.commit()
        finally:
            db.close()

    async def get_status(self, run_id: str) -> dict[str, str]:
        db = next(get_db())
        try:
            row = db.query(BacktestRun).filter(BacktestRun.run_id == run_id).first()
            if row is None:
                return {"run_id": run_id, "status": "not_found"}
            return {"run_id": run_id, "status": row.status}
        finally:
            db.close()

    async def get_result(self, run_id: str) -> dict:
        db = next(get_db())
        try:
            row = db.query(BacktestRun).filter(BacktestRun.run_id == run_id).first()
            if row is None:
                return {"run_id": run_id, "status": "not_found"}
            payload = json.loads(row.result_json) if row.result_json else None
            return {
                "run_id": run_id,
                "status": row.status,
                "result": payload,
                "logs": row.logs,
                "error": row.error,
            }
        finally:
            db.close()


_backtest_job_service = BacktestJobService()


def get_backtest_job_service() -> BacktestJobService:
    return _backtest_job_service
