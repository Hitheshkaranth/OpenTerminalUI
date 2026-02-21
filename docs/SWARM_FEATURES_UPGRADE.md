# Swarm Features Upgrade (Institutional Data, Risk, Execution, OMS, Governance, Ops)

## Added backend schema
- Institutional data:
  - `data_versions`
  - `corp_actions`
  - `prices_eod`
  - `fundamentals_pit`
  - `universe_membership`
- OMS/compliance:
  - `orders`
  - `fills`
  - `restricted_list`
  - `audit_log`
- Governance/ops:
  - `model_registry`
  - `ops_kill_switches`
- Extended existing run metadata:
  - `backtest_runs.data_version_id`
  - `backtest_runs.execution_profile_json`
  - `model_runs.data_version_id`
  - `model_runs.code_hash`
  - `model_runs.execution_profile_json`

Migration:
- `backend/alembic/versions/0004_institutional_risk_ops.py`

## New services/modules
- `backend/services/data_version_service.py`
- `backend/services/corp_actions_service.py`
- `backend/services/price_series_service.py`
- `backend/services/pit_fundamentals_service.py`
- `backend/risk_engine/engine.py`
- `backend/execution_sim/simulator.py`
- `backend/oms/service.py`

## New API endpoints
- Data layer:
  - `GET /api/data/version/active`
  - `POST /api/data/version`
  - `GET /api/prices/{symbol}`
  - `GET /api/fundamentals/{symbol}`
  - `GET /api/universe/{id}`
- Risk:
  - `POST /api/risk/portfolio`
  - `POST /api/risk/backtest/{id}`
  - `GET /api/risk/scenarios`
- OMS/compliance:
  - `POST /api/oms/order`
  - `GET /api/oms/orders`
  - `POST /api/oms/restricted`
  - `GET /api/audit`
- Governance:
  - `POST /api/governance/runs/register`
  - `GET /api/governance/runs/compare`
  - `POST /api/governance/model-registry/promote`
- Ops:
  - `GET /api/ops/feed-health`
  - `GET /api/ops/kill-switch`
  - `POST /api/ops/kill-switch`

## Backtest integration updates
- `/api/backtest/run` accepts:
  - `data_version_id`
  - `adjusted`
  - `execution_profile`
- Backtest response summary now includes metadata and execution-cost breakdown.

## Frontend updates
- New pages:
  - `frontend/src/pages/RiskDashboard.tsx`
  - `frontend/src/pages/OmsCompliance.tsx`
  - `frontend/src/pages/OpsDashboard.tsx`
  - `frontend/src/pages/ModelGovernance.tsx`
- Backtesting control deck now includes:
  - data version id
  - adjusted/unadjusted toggle
  - execution profile fields (commission/slippage/spread/impact)
- Routes and sidebar wired for Risk/OMS/Ops and Model Governance.
- API client/types extended for all new endpoints.

## Tests added
- `backend/tests/test_data_layer_routes.py`
- `backend/tests/test_risk_engine.py`
- `backend/tests/test_execution_sim.py`
- `backend/tests/test_oms_and_ops_routes.py`
- `backend/tests/test_governance_routes.py`
- `frontend/tests/e2e/risk-oms-ops.spec.ts`
