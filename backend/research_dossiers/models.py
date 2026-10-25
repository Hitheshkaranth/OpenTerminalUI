from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import DateTime, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from backend.shared.db import Base


def now():
    return datetime.now(timezone.utc)


class ResearchDossier(Base):
    __tablename__ = "research_dossiers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    lock_version: Mapped[int] = mapped_column(Integer, default=1)
    share_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    shared_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    monitor_state: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    __mapper_args__ = {"version_id_col": lock_version}


class DossierRevision(Base):
    __tablename__ = "research_dossier_revisions"
    __table_args__ = (UniqueConstraint("dossier_id", "revision", name="uq_dossier_revision"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    dossier_id: Mapped[str] = mapped_column(String(36), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSON)
    changes: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class ResearchExperiment(Base):
    __tablename__ = "research_experiments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    dossier_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    snapshot: Mapped[dict] = mapped_column(JSON)
    sha256: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
