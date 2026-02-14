from __future__ import annotations

from datetime import datetime

from sqlalchemy import Float, Integer, String, UniqueConstraint
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


class FutureContract(Base):
    __tablename__ = "future_contracts"
    __table_args__ = (
        UniqueConstraint("exchange", "tradingsymbol", name="uq_future_contract_exchange_symbol"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    underlying: Mapped[str] = mapped_column(String(64), index=True)
    expiry_date: Mapped[str] = mapped_column(String(16), index=True)
    exchange: Mapped[str] = mapped_column(String(16), index=True)
    tradingsymbol: Mapped[str] = mapped_column(String(64), index=True)
    instrument_token: Mapped[int] = mapped_column(Integer, index=True)
    lot_size: Mapped[int] = mapped_column(Integer, default=0)
    tick_size: Mapped[float] = mapped_column(Float, default=0.0)
    updated_at: Mapped[str] = mapped_column(String(32), default=lambda: datetime.utcnow().isoformat())


class NewsArticle(Base):
    __tablename__ = "news_articles"
    __table_args__ = (
        UniqueConstraint("url", name="uq_news_articles_url"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    source: Mapped[str] = mapped_column(String(128), index=True)
    title: Mapped[str] = mapped_column(String(1024))
    url: Mapped[str] = mapped_column(String(2048), index=True)
    summary: Mapped[str] = mapped_column(String(4096), default="")
    image_url: Mapped[str] = mapped_column(String(2048), default="")
    published_at: Mapped[str] = mapped_column(String(40), index=True)
    tickers: Mapped[str] = mapped_column(String(2048), default="[]")
    created_at: Mapped[str] = mapped_column(String(40), default=lambda: datetime.utcnow().isoformat())
