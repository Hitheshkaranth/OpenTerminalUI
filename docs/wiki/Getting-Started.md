# Getting Started

## Prerequisites

- Python 3.11+
- Node.js 22+
- Docker Desktop (recommended)

## Run with Docker

```bash
cp .env.example .env
docker compose up --build
```

App/API are served from backend container:

- UI/API: `http://127.0.0.1:8000`

## Run Locally (without Docker)

### Backend

```bash
python -m venv .venv
.\.venv\Scripts\activate
pip install -r backend/requirements.txt
$env:PYTHONPATH='.'
uvicorn backend.main:app --reload --port 8000
```

### Frontend

```bash
npm ci --prefix frontend
npm run dev --prefix frontend
```

Frontend dev server:

- `http://127.0.0.1:5173`

## CI-equivalent Validation

```bash
python -m compileall backend
$env:PYTHONPATH='.'; pytest backend/tests -q --cov=backend --cov-fail-under=45 --cov-report=xml --junitxml=pytest-report.xml
npm ci --prefix frontend
npm run build --prefix frontend
npm run test --prefix frontend
npx playwright install --with-deps chromium --prefix frontend
npm run test:e2e --prefix frontend
```
