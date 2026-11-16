"""Append-only snapshots of user-scoped strategy experiment lifecycle events."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import JSON, DateTime, Index, String, UniqueConstraint, event
from sqlalchemy.orm import Mapped, mapped_column

from backend.shared.db import Base


class AgentStrategyExperiment(Base):
    __tablename__ = "agent_strategy_experiments"
    __table_args__ = (
        UniqueConstraint("user_id", "run_id", "event_kind", name="uq_strategy_experiment_run_event"),
        Index("ix_strategy_experiment_dataset", "user_id", "dataset_id", "symbol", "event_kind"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    run_id: Mapped[str] = mapped_column(String(64), index=True)
    event_kind: Mapped[str] = mapped_column(String(32))
    dataset_id: Mapped[str] = mapped_column(String(64))
    symbol: Mapped[str] = mapped_column(String(64))
    protocol_version: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


@event.listens_for(AgentStrategyExperiment, "before_update")
@event.listens_for(AgentStrategyExperiment, "before_delete")
def _immutable_experiment_snapshot(mapper, connection, target):
    raise ValueError("Strategy experiment snapshots are append-only")
