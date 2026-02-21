from typing import List, Optional
from pydantic import BaseModel


class PortfolioSnapshot(BaseModel):
    positions: List[dict]
    pnl: float


class SignalSummary(BaseModel):
    top_signals: List[dict]
    unavailable_reason: Optional[str] = None


class RiskSummary(BaseModel):
    summary: dict


class EventsSummary(BaseModel):
    events: List[dict]


class NewsSummary(BaseModel):
    news: List[dict]


class CockpitSummary(BaseModel):
    portfolio_snapshot: PortfolioSnapshot
    signal_summary: SignalSummary
    risk_summary: RiskSummary
    events: EventsSummary
    news: NewsSummary
