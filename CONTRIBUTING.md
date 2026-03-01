# Contributing to OpenTerminalUI

Thank you for contributing.

## Development Setup

### Backend

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\\Scripts\\activate
pip install -r backend/requirements.txt
pip install -r backend/requirements-dev.txt
cp .env.example .env
PYTHONPATH=. uvicorn backend.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm ci
npm run dev
```

## Branching and PRs

1. Create a feature branch: `feat/<scope>-<short-name>` or `fix/<scope>-<short-name>`
2. Keep PRs focused and small where possible.
3. Include tests for behavior changes.
4. Do not commit secrets or `.env`.

## Code Style

- Python: `black`, `isort`, type hints in service/provider layers
- TypeScript: ESLint + strict mode
- Avoid unsafe `eval()`/`exec()` on user-controlled input

## Required Checks

Run before opening a PR:

```bash
make gate
```

If you run individual checks:

```bash
PYTHONPATH=. pytest backend/tests -x -q --cov=backend --cov-fail-under=45
cd frontend && npm test
cd frontend && npm run test:e2e
```

## Forge Execution Rules

- Respect `.forge/tasks/*.json` file locks.
- Execute one Forge task at a time.
- Keep `auto_commit` disabled unless explicitly approved.
- Capture verification artifacts under `.forge/results/<TASK-ID>/`.
