from __future__ import annotations

from datetime import datetime

from sqlalchemy import Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.db.database import Base


class Holding(Base):
    __tablename__ = "holdings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    ticker: Mapped[str] = mapped_column(String(32), index=True)
    quantity: Mapped[float] = mapped_column(Float)
    avg_buy_price: Mapped[float] = mapped_column(Float)
    buy_date: Mapped[str] = mapped_column(String(16))


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    watchlist_name: Mapped[str] = mapped_column(String(64), index=True)
    ticker: Mapped[str] = mapped_column(String(32), index=True)


class AlertRuleORM(Base):
    __tablename__ = "alert_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    ticker: Mapped[str] = mapped_column(String(32), index=True)
    alert_type: Mapped[str] = mapped_column(String(32), index=True)
    condition: Mapped[str] = mapped_column(String(32))
    threshold: Mapped[float] = mapped_column(Float)
    note: Mapped[str] = mapped_column(String(256), default="")
    created_at: Mapped[str] = mapped_column(String(32), default=lambda: datetime.utcnow().isoformat())


class AlertHistoryORM(Base):
    __tablename__ = "alert_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    rule_id: Mapped[int] = mapped_column(Integer, index=True)
    ticker: Mapped[str] = mapped_column(String(32), index=True)
    message: Mapped[str] = mapped_column(String(512))
    triggered_at: Mapped[str] = mapped_column(String(32), default=lambda: datetime.utcnow().isoformat())
