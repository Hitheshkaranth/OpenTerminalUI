from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass
class FundamentalSnapshot:
    ticker: str
    captured_at: datetime
    market_cap: float | None = None
    pe: float | None = None
    roe_pct: float | None = None
