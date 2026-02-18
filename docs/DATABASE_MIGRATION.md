# Database Migration

## Overview

The backend now supports async SQLAlchemy engine creation and Alembic migrations.

## Environment

- `DATABASE_URL`
  - SQLite default: `sqlite+aiosqlite:///./data/openterminal.db`
  - PostgreSQL: `postgresql://user:pass@host:5432/dbname` (auto-converted to `postgresql+asyncpg://`)

## Files

- `backend/db/base.py`: async engine factory
- `backend/db/session.py`: async session factory + dependency
- `backend/alembic.ini`: Alembic config
- `backend/alembic/env.py`: async migration environment
- `backend/alembic/versions/0001_initial.py`: initial schema migration

## Run Migrations

```bash
alembic -c backend/alembic.ini upgrade head
```

## Docker

Container startup runs migrations automatically via `backend/entrypoint.sh` before launching API.

To use PostgreSQL profile:

```bash
docker compose --profile postgres up -d --build
```

Then set:

```bash
DATABASE_URL=postgresql://<user>:<password>@postgres:5432/openterminalui
```

## Notes

- BRIN indexes are created on PostgreSQL for selected timestamp-like columns in initial migration.
- Existing legacy sync ORM continues to function; async DB session infrastructure is available for phased adoption.
