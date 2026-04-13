from __future__ import annotations

import sqlite3

from sqlalchemy import event
from sqlalchemy import inspect
from sqlalchemy import create_engine
from sqlalchemy import text
from sqlalchemy.orm import declarative_base, sessionmaker

from backend.db.base import get_sync_database_url
from backend.shared.sqlite_utils import configure_sqlite_connection

database_url = get_sync_database_url()
connect_args = {"check_same_thread": False, "timeout": 15} if database_url.startswith("sqlite") else {}
engine = create_engine(
    database_url,
    connect_args=connect_args,
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_connection: object, connection_record: object) -> None:
    if isinstance(dbapi_connection, sqlite3.Connection):
        configure_sqlite_connection(dbapi_connection)


def init_db() -> None:
    from backend.db import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _ensure_news_sentiment_columns()
    _ensure_backtest_columns()
    _ensure_alerts_columns()


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
