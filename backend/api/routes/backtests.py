from __future__ import annotations

import logging

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.auth.deps import get_current_user
from backend.core.backtest_analytics import compute_full_analytics
from backend.core.backtest_robustness import permutation_test, multi_window_robustness
from backend.core.data_store import list_store_items, write_equity_curve
from backend.core.factor_analysis import run_factor_decomposition
from backend.core.historical_data_service import get_historical_data_service
from backend.core.monte_carlo import run_monte_carlo_simulation
from backend.core.param_optimizer import optimize_strategy_parameters
from backend.core.portfolio_backtest import run_portfolio_backtest
from backend.core.strategy_runner import get_strategy_catalog
from backend.core.vectorized_backtest import vectorized_sweep
from backend.core.walk_forward import run_walk_forward_validation
from backend.services.backtest_jobs import BacktestJobRequest, get_backtest_job_service

router = APIRouter()
logger = logging.getLogger(__name__)


class BacktestSubmitPayload(BaseModel):
    symbol: str = Field(min_length=1)
    asset: str | None = None
    market: str = "NSE"
    start: str | None = None
    end: str | None = None
    limit: int = Field(500, ge=1, le=5000)
    strategy: str = "example:sma_crossover"
    context: dict[str, Any] | None = None
    config: dict[str, Any] | None = None


class ComparePayload(BaseModel):
    symbol: str = Field(min_length=1)
    market: str = "NSE"
    start: str | None = None
    end: str | None = None
    limit: int = Field(500, ge=1, le=5000)
    strategies: list[str] = Field(min_length=1, max_length=6)
    config: dict[str, Any] | None = None


class BacktestStatusResponse(BaseModel):
    run_id: str
    status: str


class BacktestResultResponse(BaseModel):
    run_id: str
    status: str
    result: dict[str, Any] | None = None
    logs: str | None = None
    error: str | None = None


class WalkForwardPayload(BaseModel):
    run_id: str | None = None
    folds: int = Field(4, ge=2, le=12)
    in_sample_ratio: float = Field(0.7, gt=0.1, lt=0.95)


class MonteCarloPayload(BaseModel):
    run_id: str | None = None
    simulations: int = Field(500, ge=10, le=5000)
    horizon_days: int = Field(252, ge=5, le=2520)
    seed: int = Field(42, ge=0)


class OptimizePayload(BaseModel):
    symbol: str = Field(min_length=1)
    market: str = "NSE"
    strategy: str = "example:sma_crossover"
    start: str | None = None
    end: str | None = None
    limit: int = Field(500, ge=30, le=5000)
    param_space: dict[str, list[Any]] = Field(default_factory=dict)
    max_trials: int = Field(64, ge=1, le=256)
    config: dict[str, Any] | None = None


class VectorizedSweepPayload(BaseModel):
    symbol: str = Field(min_length=1)
    market: str = "NSE"
    strategy: str = "sma_crossover"   # sma_crossover | ema_crossover | rsi_threshold
    start: str | None = None
    end: str | None = None
    limit: int = Field(750, ge=30, le=5000)
    param_grid: dict[str, list[Any]] = Field(default_factory=dict)
    sort_by: str = "sharpe"
    top_n: int = Field(100, ge=1, le=500)


class PortfolioSubmitPayload(BaseModel):
    assets: list[str] = Field(min_length=2, max_length=30)
    market: str = "NSE"
    start: str | None = None
    end: str | None = None
    limit: int = Field(500, ge=30, le=5000)
    strategy: str = "example:sma_crossover"
    context: dict[str, Any] | None = None
    config: dict[str, Any] | None = None


class FactorPayload(BaseModel):
    run_id: str | None = None
    factors: list[dict[str, Any]] | None = None


async def _resolve_finished_result(run_id: str | None, user_id: str | None) -> dict[str, Any]:
    if not run_id:
        raise HTTPException(status_code=400, detail="run_id is required")
    result = await get_backtest_job_service().get_result(run_id, user_id=user_id)
    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Backtest run not found")
    if result.get("status") != "done":
        raise HTTPException(status_code=400, detail=f"Backtest not complete (status: {result.get('status')})")
    payload = result.get("result")
    if not payload:
        raise HTTPException(status_code=400, detail="No result data available")
    return payload


@router.get("/backtests/strategies")
async def list_strategies() -> list[dict[str, Any]]:
    return get_strategy_catalog()


@router.post("/backtests")
async def submit_backtest(payload: BacktestSubmitPayload, current_user=Depends(get_current_user)) -> dict[str, str]:
    service = get_backtest_job_service()
    run_id = await service.submit(
        BacktestJobRequest(
            symbol=payload.symbol,
            asset=payload.asset,
            market=payload.market,
            start=payload.start,
            end=payload.end,
            limit=payload.limit,
            strategy=payload.strategy,
            context=payload.context,
            config=payload.config,
        ),
        user_id=str(current_user.id),
    )
    return {"run_id": run_id, "status": "queued"}


@router.post("/backtests/compare")
async def compare_strategies(payload: ComparePayload, current_user=Depends(get_current_user)) -> dict[str, Any]:
    service = get_backtest_job_service()
    catalog = get_strategy_catalog()
    catalog_by_key = {str(item.get("key", "")).strip().lower(): item for item in catalog}
    run_ids: dict[str, str] = {}

    for strategy in payload.strategies:
        raw_key = strategy.strip().lower()
        key = raw_key.split(":", 1)[1] if raw_key.startswith("example:") else raw_key
        meta = catalog_by_key.get(key)
        if meta is None:
            raise HTTPException(status_code=400, detail=f"Unknown strategy key: {strategy}")
        default_context = meta.get("default_context") if isinstance(meta.get("default_context"), dict) else {}
        run_id = await service.submit(
            BacktestJobRequest(
                symbol=payload.symbol,
                asset=payload.symbol,
                market=payload.market,
                start=payload.start,
                end=payload.end,
                limit=payload.limit,
                strategy=f"example:{key}",
                context=default_context,
                config=payload.config,
            ),
            user_id=str(current_user.id),
        )
        run_ids[key] = run_id
    return {"run_ids": run_ids, "status": "queued"}


@router.get("/backtests/{run_id}/status")
async def backtest_status(run_id: str, current_user=Depends(get_current_user)) -> dict[str, str]:
    status = await get_backtest_job_service().get_status(run_id, user_id=str(current_user.id))
    if status.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Backtest run not found")
    return status


@router.get("/backtests/{run_id}/result")
async def backtest_result(run_id: str, current_user=Depends(get_current_user)) -> dict[str, Any]:
    result = await get_backtest_job_service().get_result(run_id, user_id=str(current_user.id))
    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Backtest run not found")
    return result


@router.get("/backtests/{run_id}/analytics")
async def backtest_analytics(
    run_id: str,
    rolling_window: int = 60,
    histogram_bins: int = 50,
    current_user=Depends(get_current_user),
) -> dict[str, Any]:
    if rolling_window < 10 or rolling_window > 252:
        raise HTTPException(status_code=400, detail="rolling_window must be between 10 and 252")
    if histogram_bins < 10 or histogram_bins > 200:
        raise HTTPException(status_code=400, detail="histogram_bins must be between 10 and 200")

    payload = await _resolve_finished_result(run_id, str(current_user.id))

    analytics = compute_full_analytics(
        equity_curve=payload.get("equity_curve", []),
        trades=payload.get("trades", []),
        rolling_window=rolling_window,
        histogram_bins=histogram_bins,
    )
    return {"run_id": run_id, "analytics": analytics}


@router.get("/backtests/{run_id}/robustness")
async def backtest_robustness(
    run_id: str,
    n_permutations: int = 500,
    n_windows: int = 5,
    metric: str = "sharpe",
    current_user=Depends(get_current_user),
) -> dict[str, Any]:
    if n_permutations < 50 or n_permutations > 2000:
        raise HTTPException(status_code=400, detail="n_permutations must be between 50 and 2000")
    if n_windows < 2 or n_windows > 20:
        raise HTTPException(status_code=400, detail="n_windows must be between 2 and 20")
    if metric not in ("sharpe", "total_return"):
        raise HTTPException(status_code=400, detail="metric must be 'sharpe' or 'total_return'")

    payload = await _resolve_finished_result(run_id, str(current_user.id))
    equity_curve = payload.get("equity_curve", [])
    return {
        "run_id": run_id,
        "robustness": {
            "permutation_test": permutation_test(equity_curve, n_permutations=n_permutations, metric=metric),
            "multi_window": multi_window_robustness(equity_curve, n_windows=n_windows),
        },
    }


@router.post("/backtests/vectorized-sweep")
async def vectorized_backtest_sweep(payload: VectorizedSweepPayload) -> dict[str, Any]:
    strategy = payload.strategy.split(":", 1)[1] if payload.strategy.startswith("example:") else payload.strategy
    if strategy not in ("sma_crossover", "ema_crossover", "rsi_threshold"):
        raise HTTPException(status_code=400, detail="Unsupported strategy for vectorized sweep")
    if not payload.param_grid:
        raise HTTPException(status_code=400, detail="param_grid is required")

    def _work() -> dict[str, Any]:
        svc = get_historical_data_service()
        _, bars = svc.fetch_daily_ohlcv(
            raw_symbol=payload.symbol, market=payload.market,
            start=payload.start, end=payload.end, limit=payload.limit,
        )
        prices = [{"date": str(b.date), "close": float(b.close)} for b in bars]
        return vectorized_sweep(prices, strategy, payload.param_grid, sort_by=payload.sort_by, top_n=payload.top_n)

    try:
        sweep = await asyncio.to_thread(_work)
    except Exception as e:
        logger.exception("Vectorized sweep failed")
        raise HTTPException(status_code=500, detail="Vectorized sweep failed") from e
    return {"symbol": payload.symbol, "market": payload.market, "strategy": strategy, "sweep": sweep}


# Pro v1 compatibility endpoints (blueprint adapter layer)
@router.post("/v1/backtest/submit", response_model=BacktestStatusResponse)
async def v1_submit_backtest(payload: BacktestSubmitPayload, current_user=Depends(get_current_user)) -> BacktestStatusResponse:
    response = await submit_backtest(payload, current_user)
    return BacktestStatusResponse(**response)


@router.get("/v1/backtest/status/{run_id}", response_model=BacktestStatusResponse)
async def v1_backtest_status(run_id: str, current_user=Depends(get_current_user)) -> BacktestStatusResponse:
    response = await backtest_status(run_id, current_user)
    return BacktestStatusResponse(**response)


@router.get("/v1/backtest/result/{run_id}", response_model=BacktestResultResponse)
async def v1_backtest_result(run_id: str, current_user=Depends(get_current_user)) -> BacktestResultResponse:
    response = await backtest_result(run_id, current_user)
    return BacktestResultResponse(**response)


@router.get("/v1/backtest/presets")
async def v1_backtest_presets() -> dict[str, Any]:
    return {"items": get_strategy_catalog()}


@router.post("/v1/backtest/validate/walkforward")
async def v1_validate_walkforward(payload: WalkForwardPayload, current_user=Depends(get_current_user)) -> dict[str, Any]:
    result = await _resolve_finished_result(payload.run_id, str(current_user.id))
    return {
        "run_id": payload.run_id,
        "validation": run_walk_forward_validation(
            equity_curve=result.get("equity_curve", []),
            folds=payload.folds,
            in_sample_ratio=payload.in_sample_ratio,
        ),
    }


@router.post("/v1/backtest/simulate/montecarlo")
async def v1_simulate_montecarlo(payload: MonteCarloPayload, current_user=Depends(get_current_user)) -> dict[str, Any]:
    result = await _resolve_finished_result(payload.run_id, str(current_user.id))
    equity = result.get("equity_curve", [])
    daily_returns = result.get("daily_returns") or []
    initial_equity = float(result.get("initial_cash", 0.0) or 0.0)
    if initial_equity <= 0 and equity:
        first_equity = float(equity[0].get("equity", 0.0) or 0.0)
        if first_equity > 0:
            initial_equity = first_equity
    if not daily_returns:
        if len(equity) > 1:
            points = [float(item.get("equity", 0.0) or 0.0) for item in equity]
            daily_returns = [
                ((points[idx] / points[idx - 1]) - 1.0)
                for idx in range(1, len(points))
                if points[idx - 1] not in (0, None)
            ]
    if initial_equity <= 0:
        initial_equity = 100000.0
    return {
        "run_id": payload.run_id,
        "simulation": run_monte_carlo_simulation(
            daily_returns=daily_returns,
            initial_equity=initial_equity,
            simulations=payload.simulations,
            horizon_days=payload.horizon_days,
            seed=payload.seed,
        ),
    }


@router.post("/v1/backtest/optimize")
async def v1_optimize(payload: OptimizePayload) -> dict[str, Any]:
    strategy_key = payload.strategy.split(":", 1)[1] if payload.strategy.startswith("example:") else payload.strategy
    optimization = optimize_strategy_parameters(
        symbol=payload.symbol,
        market=payload.market,
        strategy_key=strategy_key,
        start=payload.start,
        end=payload.end,
        limit=payload.limit,
        param_space=payload.param_space,
        config=payload.config,
        max_trials=payload.max_trials,
    )
    return {
        "symbol": payload.symbol,
        "market": payload.market,
        "strategy": strategy_key,
        "optimization": optimization,
    }


@router.post("/v1/backtest/portfolio/submit")
async def v1_portfolio_submit(payload: PortfolioSubmitPayload) -> dict[str, Any]:
    strategy = payload.strategy if payload.strategy.startswith("example:") else f"example:{payload.strategy}"
    result = run_portfolio_backtest(
        assets=payload.assets,
        market=payload.market,
        start=payload.start,
        end=payload.end,
        limit=payload.limit,
        strategy=strategy,
        context=payload.context,
        config=payload.config,
    )
    return {"status": "done", "result": result}


@router.post("/v1/backtest/factor/decompose")
async def v1_factor_decompose(payload: FactorPayload, current_user=Depends(get_current_user)) -> dict[str, Any]:
    result = await _resolve_finished_result(payload.run_id, str(current_user.id))
    daily_returns = result.get("daily_returns") or []
    if not daily_returns:
        equity = result.get("equity_curve", [])
        points = [float(item.get("equity", 0.0) or 0.0) for item in equity]
        daily_returns = [((points[idx] / points[idx - 1]) - 1.0) for idx in range(1, len(points)) if points[idx - 1] not in (0, None)]
    return {
        "run_id": payload.run_id,
        "factor_analysis": run_factor_decomposition(daily_returns=daily_returns, factors=payload.factors),
    }


@router.post("/v1/backtest/data/store/{run_id}")
async def v1_data_store_run(run_id: str, current_user=Depends(get_current_user)) -> dict[str, Any]:
    result = await _resolve_finished_result(run_id, str(current_user.id))
    stored = write_equity_curve(run_id=run_id, equity_curve=result.get("equity_curve", []))
    return {"status": "ok", "stored": stored}


@router.get("/v1/backtest/data/catalog")
async def v1_data_catalog() -> dict[str, Any]:
    return {"items": list_store_items()}
