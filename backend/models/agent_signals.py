from __future__ import annotations

from uuid import uuid4

from sqlalchemy import Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.shared.db import Base


class AgentSignal(Base):
    __tablename__ = "agent_signals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    run_id: Mapped[str] = mapped_column(String(64), index=True)
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    persona: Mapped[str] = mapped_column(String(32), index=True)
    signal: Mapped[str] = mapped_column(String(16), index=True)
    confidence: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(Text)
    price_at_signal: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=lambda: __import__("datetime", fromlist=["datetime"]).datetime.now(__import__("datetime", fromlist=["timezone"]).timezone.utc).isoformat())
    evaluated_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    horizon_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    realized_return_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    benchmark_return_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    correct: Mapped[bool | None] = mapped_column(Integer, nullable=True)