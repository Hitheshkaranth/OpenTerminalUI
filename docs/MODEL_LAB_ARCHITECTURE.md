# Model Lab Architecture Spec

## Scope
Model Lab adds research-grade experiment management on top of existing backtest execution. It does not alter live trading execution and does not make market-beating claims.

## Backend Modules
- `backend/model_lab/schemas.py`: typed DTOs (`ExperimentCreate`, `ExperimentSummary`, `RunMetrics`, `RunTimeseries`) and request contracts.
- `backend/model_lab/metrics.py`: deterministic metric and timeseries computation.
- `backend/model_lab/service.py`: orchestration layer for experiment lifecycle, run materialization, robustness routines, and cache integration.
- `backend/model_lab/routes.py`: `/api/model-lab/*` endpoints.

## Data Model
- `model_experiments`: experiment metadata, model key, params, universe, benchmark, dates, cost model.
- `model_runs`: queued/running/succeeded/failed run state with FK to experiment.
- `model_run_metrics`: persisted report metric blob by run.
- `model_run_timeseries`: persisted report series blob by run.

## API Surface
All endpoints remain under `/api`:
- `POST /api/model-lab/experiments`
- `GET /api/model-lab/experiments`
- `GET /api/model-lab/experiments/{id}`
- `POST /api/model-lab/experiments/{id}/run`
- `GET /api/model-lab/runs/{run_id}`
- `GET /api/model-lab/runs/{run_id}/report`
- `POST /api/model-lab/compare`
- `POST /api/model-lab/experiments/{id}/walk-forward`
- `POST /api/model-lab/experiments/{id}/param-sweep`

## Execution and Caching
- Backtest execution reuses `backend/services/backtest_jobs.py`.
- Model run status is synchronized from underlying backtest job status.
- Report payloads are cached via `backend/shared/cache.py` using `model-lab:report:{run_id}` keys.

## Migration Strategy
- Alembic revision `0002_model_lab` adds Model Lab tables.
- SQLite is default runtime path.
- Same migration is compatible with Postgres profile due SQLAlchemy JSON/text columns and FK constraints.

## Metrics Set
MVP metrics:
- `total_return`, `cagr`, `vol_annual`, `sharpe`, `sortino`, `max_drawdown`, `calmar`
- `win_rate`, `avg_win`, `avg_loss`, `profit_factor`, `turnover`
- `alpha`, `beta` (if benchmark returns provided)

Extended report series:
- equity and benchmark curves
- drawdown and underwater series
- rolling sharpe 30/90
- monthly returns heatmap grid input
- returns histogram

## Frontend Route Map
- `/model-lab`
- `/model-lab/experiments/:id`
- `/model-lab/runs/:runId`
- `/model-lab/compare?runs=a,b,c`

## Acceptance/Test Plan
- Backend unit tests validate deterministic metrics and route behavior.
- Frontend tests cover Model Lab page smoke paths.
- E2E validates create experiment -> run -> report -> compare flow using deterministic API mocks.
- Existing backtesting route remains unchanged (`/backtesting`).
