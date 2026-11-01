from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import Boolean, DateTime, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from backend.shared.db import Base


def utcnow():
    return datetime.now(timezone.utc)


class ScreenSchedule(Base):
    __tablename__ = "screen_monitor_schedules"
    __table_args__ = (UniqueConstraint("user_id", "screen_id", name="uq_screen_monitor_owner_screen"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    screen_id: Mapped[str] = mapped_column(String(36), index=True)
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    frequency: Mapped[str] = mapped_column(String(16), default="daily")
    next_run_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    __mapper_args__ = {"version_id_col": revision}


class ScreenChange(Base):
    __tablename__ = "screen_monitor_changes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    schedule_id: Mapped[str] = mapped_column(String(36), index=True)
    symbol: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(16))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    observed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
