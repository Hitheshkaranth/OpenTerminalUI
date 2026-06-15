# Fork TODO

## Done (branch `feat/postgres-support`)
- [x] Robust SQLite↔Postgres portability (see `postgres-notes.md`).
- [x] Postgres wired as default service in docker-compose (healthcheck + depends_on).
- [x] Fix prerequisite install on modern Python: `empyrical` → `empyrical-reloaded`
      (original fails to build on Python 3.12+ via `configparser.SafeConfigParser`).
- [x] Verified: full `pip install` resolves (116 pkgs, `pip check` clean); alembic
      `upgrade head` runs on both SQLite and Postgres 16; targeted test suite green.

## Open — providers & EUR / European data (not started)
The original is NSE/India-centric and many calls 404/403 from the EU. Goal: make
it usable with non-India providers and EUR-denominated / European instruments.

- [ ] Inventory upstream data sources and which fail outside India:
      - Zerodha **Kite** (`kiteconnect`) — Indian broker, needs Indian account.
      - **NSEPython** / **nsetools** — scrape NSE India; 403 outside India / without
        cookies. Used heavily by F&O (`backend/fno/...`), corporate actions, events.
      - **Finnhub**, **FMP**, **yfinance**, **polygon-api-client** — global, usable
        from EU; candidates to lean on.
- [ ] Decide the EU/global provider set (candidates: Finnhub, FMP, Polygon,
      yfinance, Alpaca — already partly referenced in `.env.example`).
      *Ask the user before committing to a provider mix; this is still being scoped.*
- [ ] Abstract the provider layer so NSE-specific calls are gated/optional rather
      than always-on (avoid 404/403 noise when no Indian provider is configured).
- [ ] Currency/locale: surface EUR pricing and European exchanges/symbols.
- [ ] Replace or guard NSE-only screens/pages so the UI degrades gracefully.

## Misc / nice-to-have
- [ ] LM provider: committed defaults still point at LM Studio (`:1234`, Gemma).
      We run Ollama (`host.docker.internal:11434`, e.g. a qwen model). Keep this in
      local `.env` for now; decide whether to change committed defaults.
- [ ] Dockerfile pins Python 3.11; local dev now works on 3.12/3.13 too after the
      `empyrical-reloaded` swap. Consider bumping the Docker base image to 3.12.
- [ ] `backend/bg_services/instruments_loader.py` uses its own sqlite3 file (NSE
      futures cache). Intentionally SQLite; revisit if/when F&O is de-Indianized.
