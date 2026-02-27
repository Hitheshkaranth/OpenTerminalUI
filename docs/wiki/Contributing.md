# Contributing

Thank you for your interest in contributing to OpenTerminalUI. This page covers the development setup, coding conventions, task system, and PR checklist.

---

## Development Setup

### 1. Fork and clone

```bash
git clone https://github.com/YOUR_ORG/OpenTerminalUI.git
cd OpenTerminalUI
```

### 2. Backend

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
pip install -r backend/requirements-dev.txt   # test dependencies
cp .env.example .env        # fill in keys as needed for local testing
```

Run the backend:

```bash
PYTHONPATH=. uvicorn backend.main:app --reload --port 8000
```

### 3. Frontend

```bash
cd frontend
npm ci
npm run dev     # hot-reload dev server on :5173
```

---

## Running Tests

Run the full gate (required before submitting a PR):

```bash
make gate
```

Or individually:

```bash
# Backend tests (pytest)
PYTHONPATH=. pytest backend/tests -x -q --cov=backend --cov-fail-under=45

# Frontend unit tests (Vitest)
cd frontend && npm test

# E2E tests (Playwright)
cd frontend && npm run test:e2e
```

**Coverage threshold:** 45% backend coverage is enforced by CI. Do not submit a PR that drops coverage below this threshold.

**CI workflow:** `.github/workflows/ci.yml` — runs Python compile check, pytest with coverage, frontend build, Vitest, and Playwright on every push and PR.

---

## Project Task System (Forge)

OpenTerminalUI uses a multi-agent orchestration system called **Forge**. Tasks are distributed across three agents based on domain:

| Agent | File | Domain |
|---|---|---|
| Claude | `CLAUDE.md` | Architecture, UX, documentation, persona design |
| Codex | `AGENTS.md` | Backend implementation, API routes, data services |
| Gemini | `GEMINI.md` | Frontend implementation, component UI, QA |

Current tasks are tracked in `.forge/state.json`. Completed task artifacts are in `.forge/results/`.

If you are contributing outside the Forge system (as an open-source contributor), you do not need to use Forge — just open a GitHub Issue or PR as normal.

---

## Coding Conventions

### Expression Safety (Critical)
The screener engine and alert evaluator accept user-written expressions. These **must** use AST whitelist validation. Never use `eval()` or `exec()` on user input.

```python
# WRONG
result = eval(user_expression)

# RIGHT — use the AST-based parser in backend/screener/parser.py
result = safe_eval(user_expression, context)
```

### API Keys and Secrets
- All API keys must come from environment variables via `backend/config/settings.py`.
- Never hardcode keys in any source file.
- Never commit `.env` to git.

### CORS
- The allowed origins list must not be `["*"]` in any non-development configuration.
- Set `OPENTERMINALUI_CORS_ORIGINS` in `.env`.

### Audit Log
- The OMS audit log is append-only. Do not add `DELETE` or `UPDATE` operations to audit tables.
- Audit immutability is a compliance requirement.

### Provider Mocks for CI
- All tests that call external data providers must use mocks from `backend/tests/mocks/`.
- Never make live network calls in CI tests.

### Type Annotations
- Use Python type hints for all new functions in the service and provider layers.
- Use TypeScript strict mode for all new React components.

---

## Adding a Feature

1. Check `CLAUDE.md`, `AGENTS.md`, or `GEMINI.md` for existing task assignments before starting — avoid duplicating work.
2. Create a branch: `git checkout -b feat/your-feature-name`.
3. Write tests first (TDD encouraged).
4. Implement against the file lock list in the relevant task file.
5. Run `make gate` to confirm all tests pass.
6. If using Forge, call `forge_complete_task()` via MCP to mark the task done.
7. Open a PR.

---

## PR Checklist

Before requesting review, confirm:

- [ ] `make gate` passes (pytest + Vitest + Playwright)
- [ ] Frontend `npm run build` produces no TypeScript errors
- [ ] No new `eval()` or `exec()` on user-controlled input
- [ ] No API keys hardcoded in source files
- [ ] Coverage has not dropped below 45%
- [ ] New external API calls use mocks in tests
- [ ] New environment variables are documented in `.env.example`
- [ ] Audit log tables have no new DELETE/UPDATE operations

---

## Reporting Bugs

Open a [GitHub Issue](https://github.com/YOUR_ORG/OpenTerminalUI/issues) with:

1. **What you expected** — describe the expected behaviour
2. **What happened** — paste the exact error message or describe the wrong behaviour
3. **Steps to reproduce** — minimal reproducible steps
4. **Environment** — OS, Python version, Node version, browser
5. **Logs** — paste relevant uvicorn or browser console output

For security vulnerabilities, please do not open a public issue. Email the maintainers directly (see `SECURITY.md` if present).
