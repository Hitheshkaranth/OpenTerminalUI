# .agents — working notes for AI assistants & maintainers

This directory holds context for anyone (human or AI) picking up work on this
**fork** of OpenTerminalUI. It is not used by the application at runtime.

## Why this fork exists

The upstream project (`Hitheshkaranth/OpenTerminalUI`) is India / NSE-focused and
ships assuming SQLite + Zerodha Kite + Indian data providers. This fork diverges on:

1. **PostgreSQL support** — make Postgres a first-class, actually-working backend
   (upstream had SQLite-only SQL baked into migrations and a few services).
2. **Non-India providers & EUR / European data** — *still being scoped.* The goal
   is to swap NSE-centric data sources for providers that work outside India and
   add EUR-denominated / European instruments. Many upstream API calls 404/403
   from outside India. **Not yet implemented** — see `TODO.md`.
3. **Local LLM provider** — upstream uses LM Studio + Gemma; we run Ollama locally.
   This is a config-only choice (`LM_STUDIO_BASE_URL` / `LM_STUDIO_MODEL`) and is
   left at upstream defaults in committed files. Override in your local `.env`.

## Branches

- `feat/postgres-support` — first fork branch. Robust Postgres portability +
  prerequisite fixes. See `postgres-notes.md`.

## Files here

- `postgres-notes.md` — what was broken for Postgres and how it was fixed robustly.
- `TODO.md` — open work, especially the provider / EUR-data effort.
