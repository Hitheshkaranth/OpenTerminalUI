# Public Commit Preparation Design
**Date:** 2026-02-21
**Scope:** Test gate, README + About screen updates, clean public commit

## Context

A large batch of new features has accumulated since the last public commit (`33f0d6f`):

- Technical Screener + Breakout Scanners + Scanner Alerts (last commit)
- Institutional Data Layer (data versions, corp actions, prices EOD, fundamentals PIT)
- Risk Engine (portfolio/backtest risk, stress scenarios)
- Execution Simulator (commission/slippage/spread/market impact cost modeling)
- OMS / Compliance (orders, fills, restricted list, audit log)
- Model Governance (run registration, comparison, model promotion)
- Ops Dashboard (data feed health, kill switches)
- 4 new frontend pages: RiskDashboard, OmsCompliance, OpsDashboard, ModelGovernance
- DB migration: `0004_institutional_risk_ops.py`
- 5 new backend test files + 1 new E2E spec

## Approach

**Approach A — Test-first, docs-last**

Run the full quality gate first to surface any failures. Fix failures. Then update docs. Commit. Verify post-commit.

## Phase 1 — Pre-commit test gate

Run in order:
1. `python -m compileall backend` — syntax check all modules
2. `pytest backend/tests -q --cov=backend --cov-fail-under=45` — full backend test suite
3. `npm run build --prefix frontend` — TypeScript + production build
4. `npm run test --prefix frontend` — vitest unit tests
5. `npx playwright install --with-deps chromium && npm run test:e2e --prefix frontend` — E2E suite

Fix any failures before proceeding to Phase 2.

## Phase 2 — README.md updates

### New section: Risk, OMS & Governance Pack
Add under Project Overview with these subsystems:
- Risk Engine: portfolio/backtest risk metrics, stress scenario analysis
- Execution Simulator: cost modeling (commission, slippage, spread, market impact)
- OMS / Compliance: order management, fills, restricted list enforcement, audit log
- Model Governance: run registration, run comparison, model promotion workflow
- Ops Dashboard: data feed health monitoring, kill switch controls
- Technical Screener: pattern-based screener, breakout scanner, scanner alerts

### Features section
Append new institutional-grade capabilities to existing Features list.

### Roadmap
Mark newly completed items as `[x]`.

## Phase 3 — About.tsx updates

- Add new `TerminalPanel` titled **"Risk, OMS & Governance"** with 6 bullet points covering the new subsystems
- Update **"Recent Product Updates"** panel to include the new features from this batch

## Phase 4 — Commit + post-commit verification

- Stage all modified + new files (excluding `.env`, `*.db`, `dist/`, `node_modules/`)
- Create public commit with descriptive message
- Re-run: `python -m compileall backend` + `pytest -q` + `npm run build` to confirm clean state

## Success criteria

- All backend tests pass (≥45% coverage)
- Frontend build succeeds with no TypeScript errors
- E2E suite passes
- README and About screen reflect all new features
- No secrets or build artifacts in commit
- Post-commit verification is clean
