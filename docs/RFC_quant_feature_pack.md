# RFC: OpenTerminalUI Quant Feature Pack

## 1. Overview and Objectives
The Quant Feature Pack introduces robust algorithmic trading and portfolio management capabilities to OpenTerminalUI. This encompasses a comprehensive suite spanning a unified cockpit, portfolio-level backtesting, institutional-grade risk analytics, reproducible experiment tracking, centralized instrument mastering, paper trading with trade cost analysis (TCA), and automated data quality checks.

## 2. Module Map
The feature pack is logically divided into 7 core modules, each designed with single-responsibility principles while interacting seamlessly.

*   **Cockpit (`backend/cockpit`)**: Aggregates higher-level summaries across portfolios, signals, risk factors, events, and news for a holistic view.
*   **Portfolio Backtests (`backend/portfolio_backtests`)**: Orchestrates job-based execution of cross-asset, multi-instrument portfolio strategies, supporting baseline policies (e.g., equal-weight) and constraints.
*   **Risk Engine (`backend/risk_engine`)**: Computes analytics like EWMA volatility, rolling covariance, beta, rolling correlation matrices, and PCA-based factor exposures.
*   **Experiments (`backend/experiments`)**: Provides a registry to manage algorithmic tracking with versioning (data/code hashing), compare runs, and promote strategies directly to paper trading.
*   **Instruments (`backend/instruments`)**: Houses an instrument master for canonical symbol mapping and unified search, capable of integrating adapter streams (Kite, Yahoo, Crypto).
*   **Data Quality (`backend/data_quality`)**: Detects and reports anomalies in OHLCV datasets (e.g., missing bars, duplicates, outliers, stale series) and hooks corporate actions.
*   **TCA (`backend/tca` and `backend/paper_engine`)**: Enhances execution simulation with realistic order fills, partials, latency, and granular trade cost analysis.

## 3. Endpoint Contracts

### 3.1. Cockpit
*   **`GET /api/cockpit/summary`**
    *   **Response (200 OK)**:
        `{ "portfolio_snapshot": {...}, "signal_summary": {...}, "risk_summary": {...}, "events": [...], "news": [...] }`

### 3.2. Portfolio Backtests
*   **`POST /api/portfolio-backtests/jobs`**
    *   **Request**: `{ "strategy_id": "string", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "universe": [...], "params": {...} }`
    *   **Response (200 OK)**: `{ "job_id": "string", "status": "queued" }`
*   **`GET /api/portfolio-backtests/jobs/{job_id}`**
    *   **Response (200 OK)**: `{ "job_id": "string", "status": "running|completed|failed", "progress": 0.5 }`
*   **`GET /api/portfolio-backtests/jobs/{job_id}/result`**
    *   **Response (200 OK)**: `{ "equity_curve": [...], "drawdown": [...], "turnover_series": [...], "metrics": {...} }`

### 3.3. Risk Engine
*   **`GET /api/risk/summary`**
    *   **Response (200 OK)**: `{ "ewma_vol": 0.15, "beta": 1.05, "marginal_contribution": {...} }`
*   **`GET /api/risk/exposures`**
    *   **Response (200 OK)**: `{ "pca_factors": [...], "loadings": {...} }`
*   **`GET /api/risk/correlation`**
    *   **Response (200 OK)**: `{ "matrix": [[1.0, 0.5], [0.5, 1.0]], "assets": [...] }`

### 3.4. Experiments Registry
*   **`POST /api/experiments`**
    *   **Request**: `{ "name": "string", "config": {...} }`
    *   **Response (200 OK)**: `{ "id": "integer", "name": "string" }`
*   **`GET /api/experiments`**
    *   **Response (200 OK)**: `[ { "id": 1, "name": "...", "data_hash": "...", "code_hash": "..." } ]`
*   **`GET /api/experiments/{id}`**
    *   **Response (200 OK)**: Experiment Details payload.
*   **`POST /api/experiments/compare`**
    *   **Request**: `{ "experiment_ids": [1, 2] }`
    *   **Response (200 OK)**: `{ "metrics_table": {...}, "deltas": {...} }`
*   **`POST /api/experiments/{id}/promote-to-paper`**
    *   **Response (200 OK)**: `{ "receipt_id": "string", "status": "promoted" }`

### 3.5. Instruments
*   **`GET /api/instruments/search?q={query}`**
    *   **Response (200 OK)**: `[ { "canonical_id": "...", "display_symbol": "...", "type": "...", "exchange": "..." } ]`

### 3.6. Data Quality
*   **`POST /api/data-quality/run`**
    *   **Request**: `{ "dataset_id": "string" }`
    *   **Response (200 OK)**: `{ "scan_id": "string", "status": "running" }`
*   **`GET /api/data-quality/dashboard`**
    *   **Response (200 OK)**: `{ "scans": [...], "anomalies": [...] }`

### 3.7. TCA (Trade Cost Analysis)
*   **`GET /api/paper/tca?window={window}`**
    *   **Response (200 OK)**: `{ "per_trade_stats": [...], "aggregates": {"total_slippage": 12.5, "total_fees": 5.0} }`

## 4. DB Schema and Migration Approach
*   **Database**: SQLite/PostgreSQL (leveraging existing SQLAlchemy ORM).
*   **New Tables**:
    *   `experiments` (id, name, created_at, config_json, data_hash, code_hash, metrics_json)
    *   `experiment_artifacts` (id, experiment_id, artifact_type, storage_path)
    *   `portfolio_backtest_jobs` (id, status, created_at, started_at, finished_at, request_json, result_json, error)
    *   `instrument_master` (canonical_id, display_symbol, type, exchange, currency, ticker_size, lot_size, vendor_mappings_json)
*   **Migrations**:
    *   Use existing Alembic setup in `backend/alembic`.
    *   New revisions will be created for each swarm containing DB changes (Swarm 2, Swarm 4, Swarm 5).

## 5. Feature Flags & Defaults
*   `QUANT_PACK_ENABLED`: Defaults to `true` but allows disabling the routes if needed.
*   `COCKPIT_CACHE_TTL`: Defaults to `60` seconds.

## 6. Frontend Route Plan
*   `/cockpit`: Interactive dashboard aggregating the Cockpit Summary payload.
*   `/portfolio-lab`: Interface for triggering portfolio backtests and reviewing job results.
*   `/risk`: Exposes Risk Engine components (exposures, heatmaps for correlations).
*   `/experiments`: Registry view to browse, compare runs side-by-side, and click-to-promote.

## 7. Error Codes (Common)
*   `400 Bad Request`: Invalid parameters or schemas.
*   `404 Not Found`: Job, Experiment, or Instrument not round.
*   `501 Not Implemented`: Used initially for all stubs in Swarm 0 until corresponding Swarms implement them.
*   `503 Service Unavailable`: Dependent sub-data for Cockpit aggregator unavailable.
