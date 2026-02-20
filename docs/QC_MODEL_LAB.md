# QC Checklist: Model Lab

## Functional
- [ ] `/model-lab` route loads experiment list and create form.
- [ ] Experiment can be created with model, universe, params, cost, benchmark.
- [ ] Experiment detail shows run history and can enqueue run.
- [ ] Run report renders metric tiles and required visualizations.
- [ ] Compare view supports 2-6 runs and Pareto highlight.
- [ ] Walk-forward endpoint returns validation payload.
- [ ] Param sweep endpoint enforces bounded combinations.

## API Contract Stability
- [ ] Report payload includes stable `metrics` and `series` keys.
- [ ] Existing `/api/backtests/*` and `/backtesting` UX remains functional.

## Performance
- [ ] Cached report retrieval is faster than fresh materialization.
- [ ] Sweep rejects oversized grids above cap.

## Data / Migration
- [ ] Alembic migration `0002_model_lab` applies cleanly.
- [ ] SQLite default works without Postgres-only features.

## Security / Hygiene
- [ ] No secrets added.
- [ ] JSON payload parsing failures handled gracefully.

## Test Gates
- [ ] `make gate`
- [ ] `npm run test --prefix frontend`
- [ ] `npm run test:e2e --prefix frontend`
