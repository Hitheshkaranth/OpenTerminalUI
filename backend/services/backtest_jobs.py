from __future__ import annotations

import asyncio
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
import math
import random
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
    asset: str | None = None
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
            raw_symbol = (req.asset or req.symbol)
            symbol, bars, market_used = self._fetch_with_market_fallback(
                service=service,
                raw_symbol=raw_symbol,
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
                frame = self._build_synthetic_frame(
                    start=req.start,
                    end=req.end,
                    seed_key=f"{req.market}:{req.symbol}:{req.asset or ''}",
                )
            if frame.empty:
                raise ValueError("No OHLCV bars available for request")
            strategy_out = self._runner.run(req.strategy, frame, context=req.context or {})
            cfg = BacktestConfig(**(req.config or {}))
            traded_asset = (req.asset or req.symbol or symbol.canonical).strip().upper()
            result = BacktestEngine(cfg).run(
                symbol=symbol.canonical,
                asset=traded_asset,
                frame=frame,
                signals=strategy_out.signals,
            )
            row.result_json = result.model_dump_json()
            market_note = ""
            if market_used != req.market:
                market_note = f"Market fallback used: requested={req.market} resolved={market_used}\n"
            if not bars:
                market_note += "Synthetic OHLC fallback used due unavailable live bars.\n"
            row.logs = market_note + strategy_out.stdout + (f"\nSTDERR:\n{strategy_out.stderr}" if strategy_out.stderr else "")
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

    def _fetch_with_market_fallback(
        self,
        service,
        raw_symbol: str,
        market: str,
        start: str | None,
        end: str | None,
        limit: int,
    ):
        symbol, bars = service.fetch_daily_ohlcv(
            raw_symbol=raw_symbol,
            market=market,
            start=start,
            end=end,
            limit=limit,
        )
        if bars:
            return symbol, bars, market

        normalized_market = str(market).strip().upper()
        fallback_markets: list[str]
        if normalized_market in {"NYSE", "NASDAQ", "AMEX"}:
            fallback_markets = ["NSE", "BSE"]
        elif normalized_market in {"NSE", "BSE"}:
            fallback_markets = ["NASDAQ", "NYSE", "AMEX"]
        else:
            fallback_markets = ["NSE", "BSE", "NASDAQ", "NYSE", "AMEX"]

        for alt_market in fallback_markets:
            if alt_market == normalized_market:
                continue
            alt_symbol, alt_bars = service.fetch_daily_ohlcv(
                raw_symbol=raw_symbol,
                market=alt_market,
                start=start,
                end=end,
                limit=limit,
            )
            if alt_bars:
                return alt_symbol, alt_bars, alt_market
        return symbol, bars, market

    def _build_synthetic_frame(self, start: str | None, end: str | None, seed_key: str) -> pd.DataFrame:
        start_date = (start or "2024-01-01").strip()
        end_date = (end or datetime.utcnow().strftime("%Y-%m-%d")).strip()
        try:
            start_dt = datetime.fromisoformat(start_date).date()
            end_dt = datetime.fromisoformat(end_date).date()
        except ValueError:
            return pd.DataFrame()
        if end_dt < start_dt:
            return pd.DataFrame()

        seed = abs(hash(seed_key)) % (2**32)
        rng = random.Random(seed)
        px = 100.0 + rng.uniform(-20.0, 20.0)
        rows: list[dict[str, float | int | str]] = []
        d = start_dt
        while d <= end_dt:
            if d.weekday() < 5:
                drift = 0.2 * math.sin(len(rows) / 15.0) + rng.uniform(-1.1, 1.1)
                open_px = max(1.0, px)
                close_px = max(1.0, open_px + drift)
                high_px = max(open_px, close_px) + abs(rng.uniform(0.1, 1.4))
                low_px = max(0.5, min(open_px, close_px) - abs(rng.uniform(0.1, 1.4)))
                rows.append(
                    {
                        "date": d.isoformat(),
                        "open": float(open_px),
                        "high": float(high_px),
                        "low": float(low_px),
                        "close": float(close_px),
                        "volume": int(max(1000, 1_000_000 + rng.uniform(-300_000, 300_000))),
                    }
                )
                px = close_px
            d += timedelta(days=1)
        return pd.DataFrame(rows)

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
