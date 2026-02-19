# OpenTerminalUI Installation (Docker, Fresh Clone)

This guide is for a new machine starting from a public git clone.
Only Docker Desktop/Engine + Docker Compose are required; local Python/Node are not needed for this path.

## 1) Clone

```bash
git clone <PUBLIC_REPO_URL>
cd OpenTerminalUI
```

## 2) Start in one command

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\docker-up.ps1
```

macOS/Linux:

```bash
sh ./scripts/docker-up.sh
```

## 3) Open

- App: `http://127.0.0.1:8000`
- API docs: `http://127.0.0.1:8000/docs`
- Health: `http://127.0.0.1:8000/health`

## Optional profiles

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\docker-up.ps1 -Redis
powershell -ExecutionPolicy Bypass -File .\scripts\docker-up.ps1 -Redis -Postgres
powershell -ExecutionPolicy Bypass -File .\scripts\docker-up.ps1 -Port 8010
```

macOS/Linux:

```bash
sh ./scripts/docker-up.sh --redis
sh ./scripts/docker-up.sh --redis --postgres
sh ./scripts/docker-up.sh --port 8010
```

## Common issues

- Docker not running: start Docker Desktop and wait until engine is ready.
- `docker compose` not found: install/update Docker Desktop (Compose v2 required).
- Missing provider credentials: update root `.env` with your own API keys.
- Port `8000` already in use: use `-Port 8010` or `--port 8010`.
