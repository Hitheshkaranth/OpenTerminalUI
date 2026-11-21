from __future__ import annotations

import logging
import os
import sqlite3

from sqlalchemy import event
from sqlalchemy import inspect
from sqlalchemy import create_engine
from sqlalchemy import text
from sqlalchemy.orm import declarative_base, sessionmaker

from backend.db.base import get_sync_database_url
from backend.shared.sqlite_utils import configure_sqlite_connection

logger = logging.getLogger(__name__)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _engine_kwargs(url: str) -> dict:
    if url.startswith("sqlite"):
        # SQLite keeps its single-file settings (WAL pragmas are applied on connect).
        return {"connect_args": {"check_same_thread": False, "timeout": 15}, "pool_pre_ping": True}
    return {
        "pool_size": _env_int("DB_POOL_SIZE", 10),
        "max_overflow": _env_int("DB_MAX_OVERFLOW", 20),
        "pool_recycle": _env_int("DB_POOL_RECYCLE", 1800),
        "pool_pre_ping": os.getenv("DB_POOL_PRE_PING", "1").strip() != "0",
    }


database_url = get_sync_database_url()
engine = create_engine(database_url, **_engine_kwargs(database_url))
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_connection: object, connection_record: object) -> None:
    if isinstance(dbapi_connection, sqlite3.Connection):
        configure_sqlite_connection(dbapi_connection)


def auto_schema_enabled() -> bool:
    """Schema is owned by Alembic; create_all/ALTER shims only run in dev or when opted in."""
    from backend.config.security import is_development_env

    return is_development_env() or os.getenv("OPENTERMINALUI_AUTO_SCHEMA", "").strip() == "1"


def init_db() -> None:
    if not auto_schema_enabled():
        # Production: `alembic upgrade head` (backend/entrypoint.sh) owns the schema.
        return

    from backend.db import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _ensure_news_sentiment_columns()
    _ensure_news_availability_columns()
    _ensure_backtest_columns()
    _ensure_fundamentals_pit_columns()
    _ensure_alerts_columns()
    _ensure_agent_run_columns()
    _ensure_paper_currency_column()
    _ensure_tenant_columns()


_TENANT_COLUMNS = {
    "holdings": "user_id",
    "tax_lots": "user_id",
    "watchlist_items": "user_id",
    "model_experiments": "owner_id",
    "portfolio_definitions": "owner_id",
    "strategy_blends": "owner_id",
    "experiments": "owner_id",
}


def _ensure_tenant_columns() -> None:
    """Dev-only mirror of migration 0020 for databases bootstrapped by create_all."""
    inspector = inspect(engine)
    added: list[tuple[str, str]] = []
    with engine.begin() as conn:
        for table, column in _TENANT_COLUMNS.items():
            if not inspector.has_table(table):
                continue
            existing = {str(c["name"]) for c in inspector.get_columns(table)}
            if column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} VARCHAR(36)"))
                added.append((table, column))
            conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table}_{column} ON {table} ({column})"))
        for table in ("alerts", "virtual_orders"):
            if inspector.has_table(table):
                conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table}_symbol_status ON {table} (symbol, status)"))
        if not added or not inspector.has_table("users"):
            return
        owner = conn.execute(
            text("SELECT id FROM users WHERE UPPER(CAST(role AS VARCHAR(16))) = 'ADMIN' ORDER BY created_at ASC, id ASC LIMIT 1")
        ).first() or conn.execute(text("SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1")).first()
        if owner is None:
            return
        for table, column in added:
            conn.execute(text(f"UPDATE {table} SET {column} = :owner WHERE {column} IS NULL"), {"owner": str(owner[0])})


def _ensure_paper_currency_column() -> None:
    inspector = inspect(engine)
    if not inspector.has_table("virtual_portfolios"):
        return
    existing = {column["name"] for column in inspector.get_columns("virtual_portfolios")}
    if "base_currency" not in existing:
        with engine.begin() as conn:
            # Legacy paper orders defaulted to NSE symbols and INR cash.
            conn.execute(text("ALTER TABLE virtual_portfolios ADD COLUMN base_currency VARCHAR(3) NOT NULL DEFAULT 'INR'"))


def _ensure_agent_run_columns() -> None:
    inspector = inspect(engine)
    if not inspector.has_table("agent_runs"):
        return
    existing = {str(column["name"]) for column in inspector.get_columns("agent_runs")}
    with engine.begin() as conn:
        if "grounding_json" not in existing:
            conn.execute(text("ALTER TABLE agent_runs ADD COLUMN grounding_json TEXT"))
        if "finished_at" not in existing:
            # TIMESTAMP is accepted by both SQLite and PostgreSQL.
            conn.execute(text("ALTER TABLE agent_runs ADD COLUMN finished_at TIMESTAMP"))


def _ensure_news_availability_columns() -> None:
    inspector = inspect(engine)
    if not inspector.has_table("news_articles"):
        return
    existing = {str(column["name"]) for column in inspector.get_columns("news_articles")}
    with engine.begin() as conn:
        for name, ddl in {"source_published_at": "VARCHAR(40)",
                          "publication_verified": "BOOLEAN DEFAULT FALSE", "publication_source": "VARCHAR(32)"}.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE news_articles ADD COLUMN {name} {ddl}"))


def _ensure_news_sentiment_columns() -> None:
    columns_to_add = {
        "sentiment_score": "REAL",
        "sentiment_label": "TEXT",
        "sentiment_confidence": "REAL",
    }
    inspector = inspect(engine)
    if not inspector.has_table("news_articles"):
        return
    existing = {str(column["name"]) for column in inspector.get_columns("news_articles")}
    with engine.begin() as conn:
        for col, ddl in columns_to_add.items():
            if col in existing:
                continue
            conn.execute(text(f"ALTER TABLE news_articles ADD COLUMN {col} {ddl}"))


def _ensure_backtest_columns() -> None:
    table_columns = {
        "backtest_runs": {
            "data_version_id": "VARCHAR(36)",
            "execution_profile_json": "TEXT DEFAULT '{}'",
        },
        "model_runs": {
            "data_version_id": "VARCHAR(36)",
            "code_hash": "VARCHAR(128)",
            "execution_profile_json": "TEXT DEFAULT '{}'",
        },
    }
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table_name, columns_to_add in table_columns.items():
            if not inspector.has_table(table_name):
                continue
            existing = {str(column["name"]) for column in inspector.get_columns(table_name)}
            for col, ddl in columns_to_add.items():
                if col in existing:
                    continue
                conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col} {ddl}"))


def _ensure_fundamentals_pit_columns() -> None:
    columns_to_add = {
        "fiscal_period": "VARCHAR(32) NOT NULL DEFAULT ''",
        "release_date_estimated": "BOOLEAN NOT NULL DEFAULT 0",
        "source": "VARCHAR(32) NOT NULL DEFAULT ''",
        "market": "VARCHAR(8) NOT NULL DEFAULT ''",
    }
    inspector = inspect(engine)
    if not inspector.has_table("fundamentals_pit"):
        return
    existing = {str(column["name"]) for column in inspector.get_columns("fundamentals_pit")}
    with engine.begin() as conn:
        for col, ddl in columns_to_add.items():
            if col in existing:
                continue
            conn.execute(text(f"ALTER TABLE fundamentals_pit ADD COLUMN {col} {ddl}"))


def _ensure_alerts_columns() -> None:
    columns_to_add = {
        "conditions": "JSON NOT NULL DEFAULT '[]'",
        "logic": "VARCHAR(5) NOT NULL DEFAULT 'AND'",
        "delivery_channels": "JSON NOT NULL DEFAULT '[\"in_app\"]'",
        "delivery_config": "JSON NOT NULL DEFAULT '{}'",
        "cooldown_minutes": "INTEGER NOT NULL DEFAULT 0",
        "last_triggered_at": "DATETIME",
        "expiry_date": "DATETIME",
        "max_triggers": "INTEGER NOT NULL DEFAULT 0",
        "trigger_count": "INTEGER NOT NULL DEFAULT 0",
        "last_triggered_value": "REAL",
        "last_notification_error": "VARCHAR(512)",
    }
    inspector = inspect(engine)
    if not inspector.has_table("alerts"):
        return
    existing = {str(column["name"]) for column in inspector.get_columns("alerts")}
    with engine.begin() as conn:
        for col, ddl in columns_to_add.items():
            if col in existing:
                continue
            conn.execute(text(f"ALTER TABLE alerts ADD COLUMN {col} {ddl}"))
