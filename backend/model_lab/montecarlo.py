from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import uuid4
from typing import Any

import numpy as np

from backend.model_lab.metrics import compute_run_metrics


@dataclass
class MonteCarloJob:
    id: str
    run_id: str
    status: str = "queued"
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    finished_at: str | None = None
    error: str | None = None
    result: dict[str, Any] | None = None


_jobs: dict[str, MonteCarloJob] = {}


def _returns_from_equity_points(points: list[dict[str, Any]]) -> np.ndarray:
    values = []
    for item in points:
        val = item.get("equity", item.get("value", None))
        try:
            values.append(float(val))
        except (TypeError, ValueError):
            continue
    arr = np.array(values, dtype=float)
    arr = arr[np.isfinite(arr)]
    if arr.size < 2:
        return np.array([], dtype=float)
    prev = arr[:-1]
    valid = prev != 0
    return (arr[1:][valid] / prev[valid]) - 1.0


def _returns_from_trades(trades: list[dict[str, Any]]) -> np.ndarray:
    out = []
    open_price: float | None = None
    for trade in trades:
        action = str(trade.get("action", "")).upper()
        price = float(trade.get("price", 0.0) or 0.0)
        if action == "BUY":
            open_price = price
        elif action == "SELL" and open_price and open_price > 0:
            out.append((price / open_price) - 1.0)
            open_price = None
    return np.array(out, dtype=float)


def _sample_returns(rng: np.random.Generator, returns: np.ndarray, length: int, method: str, block_size: int) -> np.ndarray:
    if method == "block_bootstrap" and returns.size > 1:
        block_size = max(1, min(block_size, int(returns.size)))
        chunks = []
        while sum(len(chunk) for chunk in chunks) < length:
            start = int(rng.integers(0, max(1, returns.size - block_size + 1)))
            chunks.append(returns[start : start + block_size])
        return np.concatenate(chunks)[:length]
    idx = rng.integers(0, returns.size, size=length)
    return returns[idx]


def run_monte_carlo(
    *,
    equity_curve: list[dict[str, Any]],
    trades: list[dict[str, Any]] | None = None,
    paths: int = 1000,
    method: str = "bootstrap",
    block_size: int = 20,
    seed: int | None = None,
) -> dict[str, Any]:
    equity_returns = _returns_from_equity_points(equity_curve)
    trade_returns = _returns_from_trades(trades or [])
    source = trade_returns if trade_returns.size >= 8 else equity_returns
    if source.size == 0:
        return {
            "paths": 0,
            "method": method,
            "confidence_cones": [],
            "terminal_wealth": {},
            "probability_of_profit": 0.0,
            "worst_case_drawdown": {},
            "source": "none",
        }

    first = float(equity_curve[0].get("equity", equity_curve[0].get("value", 100000.0)) or 100000.0) if equity_curve else 100000.0
    length = int(max(1, len(equity_returns) or source.size))
    paths = int(max(1, min(paths, 10000)))
    method = method if method in {"bootstrap", "block_bootstrap"} else "bootstrap"
    rng = np.random.default_rng(seed)

    path_values = np.zeros((paths, length + 1), dtype=float)
    terminal = np.zeros(paths, dtype=float)
    drawdowns = np.zeros(paths, dtype=float)
    for idx in range(paths):
        sampled = _sample_returns(rng, source, length, method, block_size)
        curve = first * np.cumprod(np.insert(1.0 + sampled, 0, 1.0))
        path_values[idx, :] = curve
        terminal[idx] = curve[-1]
        metrics = compute_run_metrics(
            [{"date": str(i), "equity": float(value)} for i, value in enumerate(curve)],
            trades=[],
        )
        drawdowns[idx] = float(metrics.get("max_drawdown", 0.0) or 0.0)

    percentiles = [5, 25, 50, 75, 95]
    cone = np.percentile(path_values, percentiles, axis=0)
    confidence_cones = []
    for step in range(path_values.shape[1]):
        confidence_cones.append(
            {
                "step": step,
                **{f"p{pct}": round(float(cone[pct_idx, step]), 6) for pct_idx, pct in enumerate(percentiles)},
            }
        )

    return {
        "paths": paths,
        "method": method,
        "block_size": block_size,
        "source": "trade_returns" if trade_returns.size >= 8 else "equity_returns",
        "confidence_cones": confidence_cones,
        "terminal_wealth": {
            f"p{pct}": round(float(np.percentile(terminal, pct)), 6) for pct in percentiles
        } | {
            "mean": round(float(np.mean(terminal)), 6),
            "min": round(float(np.min(terminal)), 6),
            "max": round(float(np.max(terminal)), 6),
        },
        "probability_of_profit": round(float(np.mean(terminal > first)), 8),
        "worst_case_drawdown": {
            f"p{pct}": round(float(np.percentile(drawdowns, pct)), 8) for pct in percentiles
        } | {
            "mean": round(float(np.mean(drawdowns)), 8),
            "max": round(float(np.max(drawdowns)), 8),
        },
    }


_MAX_JOBS = 200


def _evict_old_jobs() -> None:
    """Keep the in-memory job registry bounded: evict the oldest finished jobs first."""
    overflow = len(_jobs) - _MAX_JOBS
    if overflow <= 0:
        return
    # dicts preserve insertion order, so iteration order is oldest-first.
    finished = [jid for jid, job in _jobs.items() if job.status in {"succeeded", "failed"}]
    for jid in finished[:overflow]:
        _jobs.pop(jid, None)


def create_monte_carlo_job(run_id: str) -> MonteCarloJob:
    job = MonteCarloJob(id=f"mc_{uuid4().hex[:12]}", run_id=run_id)
    _jobs[job.id] = job
    _evict_old_jobs()
    return job


def get_monte_carlo_job(job_id: str) -> MonteCarloJob | None:
    return _jobs.get(job_id)


async def execute_monte_carlo_job(job_id: str, report: dict[str, Any], options: dict[str, Any]) -> None:
    job = _jobs.get(job_id)
    if job is None:
        return
    job.status = "running"
    try:
        series = report.get("series") or {}
        equity_curve = series.get("equity_curve") or series.get("portfolio_equity") or []
        trades = series.get("trades") or []
        job.result = await asyncio.to_thread(
            run_monte_carlo,
            equity_curve=equity_curve,
            trades=trades,
            paths=int(options.get("paths", 1000) or 1000),
            method=str(options.get("method", "bootstrap")),
            block_size=int(options.get("block_size", 20) or 20),
            seed=options.get("seed"),
        )
        job.status = "succeeded"
    except Exception as exc:
        job.status = "failed"
        job.error = str(exc)
    finally:
        job.finished_at = datetime.now(timezone.utc).isoformat()
        _evict_old_jobs()
