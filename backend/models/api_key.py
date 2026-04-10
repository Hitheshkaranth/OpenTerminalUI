from __future__ import annotations

from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, func, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from backend.shared.db import Base

class APIKeyORM(Base):
    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, default="1")
    name: Mapped[str] = mapped_column(String(100), nullable=False)          # user-given label
    key_prefix: Mapped[str] = mapped_column(String(12), nullable=False, index=True)      # first 12 chars for display (otui_xxxx)
    key_hash: Mapped[str] = mapped_column(String(256), nullable=False)       # sha256 hash of full key
    permissions: Mapped[str] = mapped_column(String(20), default="read")     # read, read_write
    is_active: Mapped[int] = mapped_column(Integer, default=1)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
