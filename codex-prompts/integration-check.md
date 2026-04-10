# TASK: Post-Wave Integration Verification

## Project Context

OpenTerminalUI — React 18 + TypeScript + Vite frontend, FastAPI + SQLAlchemy backend. This is a verification task to ensure all recently added features integrate correctly.

## Steps

Run the following checks and report results for each:

### 1. Backend Verification
```bash
cd backend
python -c "from main import app; print('Backend imports OK')"
python -m pytest tests/ -v --tb=short 2>&1 | tail -50
```
- Verify all new route files are imported in `main.py`
- Verify no import errors
- Report test pass/fail counts

### 2. Frontend Build Check
```bash
cd frontend
npx tsc --noEmit 2>&1 | tail -30
npx vite build 2>&1 | tail -20
```
- Verify no TypeScript errors
- Verify Vite build succeeds

### 3. Frontend Tests
```bash
cd frontend
npx vitest run 2>&1 | tail -30
```
- Report unit test pass/fail counts

### 4. E2E Tests
```bash
npx playwright test 2>&1 | tail -50
```
- Report E2E test pass/fail counts
- List any failing tests

### 5. Route Verification
- Read `frontend/src/App.tsx` and verify all new pages have routes
- Read `frontend/src/components/layout/Sidebar.tsx` and verify all new nav entries are present
- Check for any duplicate routes or conflicting paths

### 6. Theme Consistency
- For each new page, verify it uses terminal color tokens (`text-terminal-text`, `bg-terminal-panel`, etc.)
- Flag any hardcoded colors that should use theme tokens

### 7. Responsive Check
- For each new page, verify mobile considerations exist (responsive classes, mobile alternatives)

### 8. Linting
```bash
cd frontend
npx eslint src/ --ext .ts,.tsx 2>&1 | tail -30
```

## Output

Create a report file at `codex-prompts/integration-report.md` with:
- Summary: X/8 checks passed
- Details per check: pass/fail + issues found
- Action items: list of fixes needed (if any)

If issues are found, fix them immediately before creating the report. Only create the report after all fixable issues are resolved.
