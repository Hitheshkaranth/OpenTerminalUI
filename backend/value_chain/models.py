from __future__ import annotations

# OWNER: agent E. ORM table storing the latest ValueChain payload per symbol.
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from backend.shared.db import Base  # noqa: F401


class ValueChainSnapshot(Base):
    """Latest value-chain payload for a symbol (owner: agent E).

    Persisted by ``POST /extract``; read back by ``GET`` when present.
    """

    __tablename__ = "value_chain_snapshots"

    __table_args__ = (
        UniqueConstraint("symbol", name="uq_value_chain_snapshot_symbol"),
    )

    id: Mapped[int] = mapped_column("id", primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    engine: Mapped[str | None] = mapped_column(String(16), nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        default=lambda: datetime.now(timezone.utc),
    )