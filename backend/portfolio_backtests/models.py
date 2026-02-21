from sqlalchemy import Column, String, DateTime, JSON
from backend.db.database import Base
from datetime import datetime, timezone


def _utcnow():
    return datetime.now(timezone.utc)


class PortfolioBacktestJob(Base):
    __tablename__ = "portfolio_backtest_jobs"

    id = Column(String, primary_key=True, index=True)
    status = Column(String, default="queued")
    created_at = Column(DateTime, default=_utcnow)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    request_json = Column(JSON, nullable=True)
    result_json = Column(JSON, nullable=True)
    error = Column(String, nullable=True)
