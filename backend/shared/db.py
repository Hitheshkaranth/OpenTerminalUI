from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy import text
from sqlalchemy.orm import declarative_base, sessionmaker

from backend.config.settings import get_settings

settings = get_settings()
engine = create_engine(settings.sqlite_url, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def init_db() -> None:
    from backend.db import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _ensure_news_sentiment_columns()


def _ensure_news_sentiment_columns() -> None:
    columns_to_add = {
        "sentiment_score": "REAL",
        "sentiment_label": "TEXT",
        "sentiment_confidence": "REAL",
    }
    with engine.begin() as conn:
        rows = conn.execute(text("PRAGMA table_info(news_articles)")).fetchall()
        existing = {str(r[1]) for r in rows}
        for col, ddl in columns_to_add.items():
            if col in existing:
                continue
            conn.execute(text(f"ALTER TABLE news_articles ADD COLUMN {col} {ddl}"))
