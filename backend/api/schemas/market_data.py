from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class DepthLevel(BaseModel):
    price: float
    size: int
    orders: Optional[int] = None


class MarketDepth(BaseModel):
    symbol: str
    market: str
    as_of: datetime
    bids: List[DepthLevel] = Field(default_factory=list)
    asks: List[DepthLevel] = Field(default_factory=list)
    total_bid_quantity: int = 0
    total_ask_quantity: int = 0


class DepthUpdate(BaseModel):
    symbol: str
    snapshot: MarketDepth
    type: str = "depth"
