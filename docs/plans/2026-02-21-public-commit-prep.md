# Public Commit Preparation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Run the full quality gate, update README.md and About.tsx with all new features (Risk Engine, Execution Sim, OMS/Compliance, Model Governance, Ops Dashboard, Technical Screener), then produce a clean public commit verified post-commit.

**Architecture:** Test-first (Approach A) — gate must be green before touching docs. README gets a new top-level section plus Features/Roadmap updates. About.tsx gets a new TerminalPanel and updated Recent Updates list. Single commit covers all staged changes.

**Tech Stack:** Python 3.11 + pytest, FastAPI, TypeScript + React 18, Vite, Vitest, Playwright

---

### Task 1: Backend compile check

**Files:**
- Run against: `backend/` (all modules)

**Step 1: Run compileall**

```bash
cd /c/Users/hithe/Documents/SIDE_QUESTS/OpenTerminalUI
python -m compileall backend -q
```

Expected: no output (clean). If errors appear, fix the reported file before continuing.

**Step 2: Confirm exit code**

```bash
echo "Exit: $?"
```

Expected: `Exit: 0`

---

### Task 2: Backend test suite

**Files:**
- Test dir: `backend/tests/`
- Key new test files:
  - `backend/tests/test_data_layer_routes.py`
  - `backend/tests/test_risk_engine.py`
  - `backend/tests/test_execution_sim.py`
  - `backend/tests/test_oms_and_ops_routes.py`
  - `backend/tests/test_governance_routes.py`

**Step 1: Run full pytest suite with coverage**

```bash
cd /c/Users/hithe/Documents/SIDE_QUESTS/OpenTerminalUI
PYTHONPATH=. pytest backend/tests -q --cov=backend --cov-fail-under=45 --cov-report=term-missing 2>&1 | tail -30
```

Expected: `X passed` at the end, coverage ≥ 45%.

**Step 2: Triage failures (if any)**

For each FAILED line:
- Read the test file to understand what it expects
- Read the implementation file it is testing
- Fix the minimal code issue (do NOT rewrite working tests)
- Re-run `pytest backend/tests/<specific_test_file>.py -q` to confirm fix
- Only then move on to the next failure

**Step 3: Confirm suite is green**

```bash
PYTHONPATH=. pytest backend/tests -q --cov=backend --cov-fail-under=45 2>&1 | tail -5
```

Expected: `X passed, 0 failed`

---

### Task 3: Frontend production build

**Files:**
- `frontend/src/` (all TypeScript/TSX)
- Config: `frontend/tsconfig.json`, `frontend/vite.config.ts`

**Step 1: Run TypeScript + Vite build**

```bash
npm run build --prefix frontend 2>&1 | tail -20
```

Expected: `✓ built in Xs` with no TypeScript errors.

**Step 2: Triage TypeScript errors (if any)**

Each error shows `file.tsx:line:col - error TSxxxx: message`. Open the file, fix the type issue, re-run build. Do NOT use `any` casts to silence errors — fix the actual type.

**Step 3: Confirm build is clean**

```bash
npm run build --prefix frontend 2>&1 | grep -E "error|built"
```

Expected: only the `built in Xs` line, no `error` lines.

---

### Task 4: Frontend unit tests

**Files:**
- `frontend/src/` (vitest)

**Step 1: Run vitest**

```bash
npm run test --prefix frontend 2>&1 | tail -15
```

Expected: `X tests passed` with no failures.

**Step 2: Fix any failures**

Read the failing test, understand intent, fix the implementation. Do not delete tests.

---

### Task 5: E2E test suite

**Files:**
- `frontend/tests/e2e/risk-oms-ops.spec.ts` (new)
- `frontend/tests/e2e/screener-scanner.spec.ts` (modified)
- All other specs in `frontend/tests/e2e/`
- Config: `frontend/playwright.config.ts`

**Step 1: Install Playwright browser (if not already installed)**

```bash
npx playwright install --with-deps chromium 2>&1 | tail -5
```

**Step 2: Run E2E suite**

```bash
npm run test:e2e --prefix frontend 2>&1 | tail -30
```

Expected: all specs pass. Note: E2E tests require the backend to be running OR the playwright config uses a mock/stub server — check `frontend/playwright.config.ts` for `webServer` config.

**Step 3: If backend is needed, start it first**

In a separate terminal (or background):
```bash
PYTHONPATH=. uvicorn backend.main:app --host 127.0.0.1 --port 8010 &
sleep 5
npm run test:e2e --prefix frontend
```

**Step 4: Triage E2E failures**

Read the failing spec. If it tests a route that now exists, check that the route is wired in `frontend/src/App.tsx`. If a selector changed, update the spec to match the current UI.

---

### Task 6: Update README.md — new Risk/OMS/Governance section

**Files:**
- Modify: `README.md`

Find the `### Platform & APIs` section heading. Insert the new section **before** it:

```markdown
### Risk, OMS & Governance Pack
- **Risk Engine** - portfolio VaR/CVaR, backtest risk attribution, and stress scenario analysis
- **Execution Simulator** - cost modeling with commission, slippage, spread, and market-impact parameters
- **OMS / Compliance** - order lifecycle management, fill tracking, restricted-list enforcement, and full audit log
- **Model Governance** - run registration with code hash + data version, multi-run comparison, and model promotion workflow
- **Ops Dashboard** - real-time data feed health monitoring and kill-switch controls
- **Technical Screener** - pattern-based screener with breakout scanner engine and real-time scanner alerts
```

**Step 1: Open README.md and locate insertion point**

The line `### Platform & APIs` is near line 57. Insert the new block above it.

**Step 2: Verify the section renders correctly**

```bash
grep -n "Risk, OMS" README.md
```

Expected: one match at the correct line.

---

### Task 7: Update README.md — Features list

**Files:**
- Modify: `README.md`

Append these lines to the `## Features` section (before `## Roadmap`):

```markdown
- **Technical Screener**: pattern-based screener rules engine + breakout scanner with scanner alert delivery.
- **Institutional Data Layer**: point-in-time data versions, corporate actions service, EOD price series, and PIT fundamentals with DB migration `0004`.
- **Risk Engine**: portfolio-level VaR/CVaR, backtest risk attribution, and configurable stress scenarios via `/api/risk/`.
- **Execution Simulator**: transaction cost model (commission, slippage, bid-ask spread, market impact) integrated into backtest runs.
- **OMS / Compliance**: order management with fill tracking, restricted-list enforcement, and audit log via `/api/oms/` and `/api/audit`.
- **Model Governance**: run registration with code hash + data version binding, multi-run comparison, and model promotion via `/api/governance/`.
- **Ops Dashboard**: feed health status and kill-switch controls via `/api/ops/`; new Ops Dashboard UI page.
```

**Step 1: Find the end of the Features section**

```bash
grep -n "^## Roadmap" README.md
```

Insert the new feature lines immediately before that line.

**Step 2: Verify**

```bash
grep -n "Technical Screener\|Risk Engine\|Execution Sim" README.md
```

Expected: 3 matches.

---

### Task 8: Update README.md — Roadmap

**Files:**
- Modify: `README.md`

The existing roadmap has unchecked items. Change:

```markdown
- [ ] Portfolio-level backtesting and strategy comparison views
```
to:
```markdown
- [x] Portfolio-level backtesting and strategy comparison views
```

And add new completed items before the remaining `[ ]` items:

```markdown
- [x] Technical Screener with breakout scanner engine and real-time scanner alerts
- [x] Institutional data layer: data versions, corp actions, EOD prices, PIT fundamentals
- [x] Risk Engine: portfolio/backtest VaR, CVaR, and stress scenarios
- [x] Execution Simulator: commission, slippage, spread, and market-impact cost modeling
- [x] OMS / Compliance: order management, restricted list, fill tracking, and audit log
- [x] Model Governance: run registration, comparison, and model promotion
- [x] Ops Dashboard: data feed health and kill-switch controls
```

**Step 1: Locate roadmap section**

```bash
grep -n "Portfolio-level backtesting\|\[ \]" README.md
```

**Step 2: Apply the changes using Edit tool**

Update the roadmap lines as described above.

**Step 3: Verify**

```bash
grep -n "\[x\].*Risk\|\[x\].*OMS\|\[x\].*Governance" README.md
```

Expected: 3 matches.

---

### Task 9: Update About.tsx — new Risk/OMS/Governance panel

**Files:**
- Modify: `frontend/src/pages/About.tsx`

**Step 1: Locate the insertion point**

The `<TerminalPanel title="Infrastructure">` block is around line 104. Insert a new panel **before** it:

```tsx
      <TerminalPanel title="Risk, OMS & Governance">
        <ul className="space-y-1 text-xs text-terminal-text">
          <li>- Risk Engine: portfolio VaR/CVaR, backtest risk attribution, and configurable stress scenario analysis.</li>
          <li>- Execution Simulator: transaction cost modeling with commission, slippage, spread, and market-impact parameters.</li>
          <li>- OMS / Compliance: order lifecycle management, fill tracking, restricted-list enforcement, and audit log.</li>
          <li>- Model Governance: run registration with code hash + data version, multi-run comparison, and model promotion workflow.</li>
          <li>- Ops Dashboard: real-time data feed health monitoring and kill-switch controls.</li>
          <li>- Technical Screener: pattern-based screener engine with breakout scanner and real-time scanner alert delivery.</li>
        </ul>
      </TerminalPanel>
```

**Step 2: Apply the edit using the Edit tool**

Use `old_string` = `      <TerminalPanel title="Infrastructure">` and `new_string` = the new panel block + the Infrastructure opening tag.

**Step 3: Verify the component still compiles**

```bash
npm run build --prefix frontend 2>&1 | grep -E "error|built"
```

Expected: `built in Xs`, no errors.

---

### Task 10: Update About.tsx — Recent Product Updates

**Files:**
- Modify: `frontend/src/pages/About.tsx`

**Step 1: Find the Recent Product Updates panel**

It is around line 94-102. Add new items to the `<ul>`:

```tsx
          <li>- Technical Screener upgraded with breakout scanner engine and real-time scanner alert delivery.</li>
          <li>- Risk Engine added: portfolio VaR/CVaR, backtest risk attribution, and stress scenarios.</li>
          <li>- Execution Simulator: cost modeling (commission, slippage, spread, impact) now integrated into backtest runs.</li>
          <li>- OMS / Compliance dashboard: order management, restricted list, fill tracking, and audit log.</li>
          <li>- Model Governance page: run registration, multi-run comparison, and model promotion workflow.</li>
          <li>- Ops Dashboard: data feed health status and kill-switch controls.</li>
```

**Step 2: Insert before the closing `</ul>` of the Recent Product Updates panel**

Use Edit tool with precise old_string from the existing last `<li>` in that panel.

**Step 3: Confirm build still passes**

```bash
npm run build --prefix frontend 2>&1 | grep -E "error|built"
```

---

### Task 11: Safety checks before commit

**Files:**
- `.gitignore` (read-only check)

**Step 1: Confirm no secrets are tracked**

```bash
git ls-files | grep -E "\.env$|\.env\."
```

Expected: no output.

**Step 2: Confirm no build artifacts are tracked**

```bash
git ls-files | grep -E "node_modules|/dist/|\.db$|\.sqlite"
```

Expected: no output.

**Step 3: Review staged diff**

```bash
git diff HEAD --stat
```

Review the file list. Should include: `README.md`, `frontend/src/pages/About.tsx`, and all the new/modified backend + frontend files from git status.

---

### Task 12: Stage all changes and commit

**Files:**
- All modified tracked files
- All new untracked files (backend routes, services, engines, tests, frontend pages)

**Step 1: Stage modified tracked files**

```bash
git add \
  backend/api/routes/__init__.py \
  backend/api/routes/backtest.py \
  backend/api/routes/search.py \
  backend/equity/routes/__init__.py \
  backend/models/__init__.py \
  backend/models/core.py \
  backend/scanner_engine/runner.py \
  backend/screener/routes.py \
  backend/tests/test_market_classification_integration.py \
  frontend/src/App.tsx \
  frontend/src/api/client.ts \
  frontend/src/components/layout/Sidebar.tsx \
  frontend/src/pages/Backtesting.tsx \
  frontend/src/types/index.ts \
  frontend/tests/e2e/screener-scanner.spec.ts \
  README.md \
  frontend/src/pages/About.tsx
```

**Step 2: Stage new untracked files**

```bash
git add \
  backend/alembic/versions/0004_institutional_risk_ops.py \
  backend/api/routes/audit.py \
  backend/api/routes/data_layer.py \
  backend/api/routes/governance.py \
  backend/api/routes/oms.py \
  backend/api/routes/ops.py \
  backend/api/routes/risk.py \
  backend/execution_sim/ \
  backend/oms/ \
  backend/risk_engine/ \
  backend/services/corp_actions_service.py \
  backend/services/data_version_service.py \
  backend/services/pit_fundamentals_service.py \
  backend/services/price_series_service.py \
  backend/tests/test_data_layer_routes.py \
  backend/tests/test_execution_sim.py \
  backend/tests/test_governance_routes.py \
  backend/tests/test_oms_and_ops_routes.py \
  backend/tests/test_risk_engine.py \
  docs/SWARM_FEATURES_UPGRADE.md \
  frontend/src/pages/ModelGovernance.tsx \
  frontend/src/pages/OmsCompliance.tsx \
  frontend/src/pages/OpsDashboard.tsx \
  frontend/src/pages/RiskDashboard.tsx \
  frontend/tests/e2e/risk-oms-ops.spec.ts
```

**Step 3: Review staged diff**

```bash
git diff --cached --stat
```

Verify the file count looks right (should be ~40 files).

**Step 4: Create the commit**

```bash
git commit -m "$(cat <<'EOF'
feat: institutional risk, OMS, governance, execution sim, and screener upgrades

- Risk Engine: portfolio VaR/CVaR, backtest risk attribution, stress scenarios
- Execution Simulator: commission/slippage/spread/impact cost modeling in backtests
- OMS/Compliance: order management, fills, restricted list, audit log
- Model Governance: run registration, multi-run comparison, model promotion
- Ops Dashboard: feed health monitoring and kill-switch controls
- Technical Screener: breakout scanner engine and real-time scanner alerts
- Institutional data layer: data versions, corp actions, EOD prices, PIT fundamentals
- DB migration 0004 for all new schema tables
- 5 new backend test modules + E2E risk/OMS/ops spec
- README and About screen updated with all new features

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

Expected: commit hash printed, no pre-commit hook failures.

---

### Task 13: Post-commit verification

**Files:** None (read-only verification)

**Step 1: Re-run backend compile**

```bash
python -m compileall backend -q && echo "compile OK"
```

Expected: `compile OK`

**Step 2: Re-run pytest**

```bash
PYTHONPATH=. pytest backend/tests -q --cov=backend --cov-fail-under=45 2>&1 | tail -5
```

Expected: `X passed, 0 failed`

**Step 3: Re-run frontend build**

```bash
npm run build --prefix frontend 2>&1 | grep -E "error|built"
```

Expected: `built in Xs`

**Step 4: Confirm commit is in log**

```bash
git log --oneline -3
```

Expected: the new commit is at the top.

**Step 5: Confirm no secrets in committed files**

```bash
git show --stat HEAD | head -20
git ls-files | grep -E "\.env$|\.env\."
```

Expected: no `.env` files in output.
