from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from backend.config.settings import get_settings

settings = get_settings()
engine = create_engine(settings.sqlite_url, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def init_db() -> None:
    # Import ORM models before metadata create_all.
    from backend.db import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
