# Upgrading: security & scalability rehaul

This release fails closed. Read this before you pull a new image or restart an
existing install.

## 1. An unset environment now means production

`OPENTERMINALUI_ENV` empty or unset is treated as **production**. Only `dev`,
`development`, `local` and `test` count as development. In production:

- secrets must be set (no insecure defaults, no ephemeral keys);
- SQLite is refused unless you opt in (see section 3);
- auth cannot be switched off and dev-auth bypasses are ignored;
- self-registration is off (see section 6).

The Docker entrypoint refuses to start when `OPENTERMINALUI_ENV` is unset. Set it
explicitly: `production`, or `development` for a local single-user install.
`./install.sh` / `./install.ps1` write `development` for the local (non-Docker) flow.

## 2. Required secrets

| Variable | Needed by |
|---|---|
| `JWT_SECRET_KEY` | app (JWT signing) |
| `CACHE_SIGNING_KEY` | app (cache integrity) |
| `REDIS_PASSWORD` | Docker Compose (Redis runs with `--requirepass`) |
| `POSTGRES_PASSWORD` | Docker Compose (bundled Postgres) |

Generate each with `openssl rand -hex 32`. The installers fill in any that are blank
and never overwrite a value you already set.

## 3. Compose now defaults to Postgres

`docker compose up` starts a bundled `postgres` service, and `DATABASE_URL` defaults to
it. The `postgres` profile is gone.

**Existing SQLite Docker users who want to keep their data.** Your database is still
in the `openterminalui_data` volume at `/data/openterminal.db`. Add the following to
`.env`:

```dotenv
# either (single-user):
OPENTERMINALUI_ENV=development
# or (production-mode single node):
OPENTERMINALUI_ENV=production
ALLOW_SQLITE_IN_PRODUCTION=1

DATABASE_URL=sqlite:////data/openterminal.db
```

Compose still interpolates `POSTGRES_PASSWORD` and starts the Postgres container, so
leave a value in it even if you don't use Postgres.

## 4. The container now runs as a non-root user (uid 10001)

Volumes created by older images are owned by root. Fix them once:

```bash
docker compose run --rm --user root backend chown -R 10001:10001 /data
```

## 5. Migrations are required in production

The app only auto-creates its schema in development, or when you set
`OPENTERMINALUI_AUTO_SCHEMA=1`. In production, run `alembic upgrade head`. The
container entrypoint does this unless `RUN_MIGRATIONS=0` is set.

- `0019_baseline_orm_tables` creates every ORM table that earlier migrations didn't
  cover. It's idempotent on databases that were auto-created before.
- `0020_tenant_ownership` adds per-user ownership (`user_id`/`owner_id`) to holdings,
  tax lots, watchlist items and the lab tables. Existing rows go to the **oldest
  admin**, or the oldest user if there's no admin, so single-user installs keep their
  data.

Local install: `PYTHONPATH=. alembic -c backend/alembic.ini upgrade head`.

## 6. Accounts

- **Registration.** Self-registration is disabled outside development. Set
  `REGISTRATION_ENABLED=1` to allow it.
- **Password reset is token-based.** `POST /api/auth/forgot-access` always returns
  204, and nothing is emailed. The single-use token (valid for 30 minutes) is
  written to the server log at **WARNING** level, so the operator can deliver it out
  of band. The user then calls `POST /api/auth/reset-password` with `{token, new_password}`.
- **Admin reset.** An admin can call `POST /api/auth/admin/reset-password` with
  `{email, new_password}`.
- Login lockout: 10 failures in 15 minutes locks the account for 15 minutes
  (HTTP 423).

## 7. WebSockets and CORS

Every WebSocket (`/ws/quotes`, `/ws/alerts`, `/ws/us-quotes`, `/ws/depth`) needs an
access token (`?token=<jwt>`). Without one, the server closes the socket with code
4401. Alert and backtest-progress events go only to the owning user's sockets.

In production, the localhost origin defaults are dropped. Set
`OPENTERMINALUI_CORS_ORIGINS` to the origins you serve the UI from, for example
`https://terminal.example.com`, or browsers will be refused.

## 8. Kite

The Kite access token now travels in the `X-Kite-Access-Token` header. It no longer
goes in `Authorization`, which carries the app's JWT. Update any scripts that call
`/api/kite/*` directly.

## 9. New environment knobs

| Variable | Default | Purpose |
|---|---|---|
| `RUN_BACKGROUND_SERVICES` | `1` | `0` runs an API-only process: no schedulers, ingestors, paper engine or hub feeds |
| `RUN_MIGRATIONS` | `1` | `0` skips `alembic upgrade head` in the entrypoint (use it on extra replicas) |
| `WEB_CONCURRENCY` | `1` | uvicorn workers per container (see section 10) |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` / `DB_POOL_RECYCLE` / `DB_POOL_PRE_PING` | `10` / `20` / `1800` / `1` | SQLAlchemy pool (Postgres) |
| `CACHE_L1_MAX_ENTRIES` | `5000` | in-process LRU cache bound |
| `WS_MAX_SYMBOLS_PER_CONN` / `WS_MAX_TOTAL_SYMBOLS` | `100` / `2000` | WebSocket subscription caps |
| `TRUST_PROXY_HEADERS` | `0` | `1` trusts `X-Forwarded-For` for rate limiting (only behind your own proxy) |
| `OMS_MAX_POSITION_NOTIONAL` / `OMS_MAX_ADV_PCT` | built-in | server-side OMS pre-trade limits |
| `LOG_LEVEL` / `LOG_FORMAT` | `INFO` / `json` | `LOG_FORMAT=text` for human-readable logs |
| `OPENTERMINALUI_HTTP_TRUST_ENV` | off | `1` makes the shared outbound HTTP client honour `HTTP(S)_PROXY`/`NO_PROXY`. Alert webhooks use pinned-IP connections and still need direct egress |
| `OPENTERMINALUI_AUTO_SCHEMA` | off | `1` creates tables at startup outside development (prefer migrations) |

## 10. Multi-worker caveat

The login lockout and the authenticated-user cache (30-second TTL) are kept **per
process**. Background services (schedulers, the paper-trading engine, market-data
feeds) run once per process. With N > 1 workers or replicas:

- run exactly one replica with `RUN_BACKGROUND_SERVICES=1`, and set
  `RUN_BACKGROUND_SERVICES=0` on all the others;
- set `RUN_MIGRATIONS=0` on all but one;
- use Postgres (SQLite is single-node only) and Redis;
- the effective lockout threshold scales with the number of workers. Put rate limiting at the proxy if that matters to you.
