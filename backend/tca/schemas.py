from typing import List
from pydantic import BaseModel


class TCATradeStat(BaseModel):
    trade_id: str
    expected_slippage: float
    realized_slippage: float


class TCAAggregates(BaseModel):
    total_slippage: float
    total_fees: float


class TCAResponse(BaseModel):
    per_trade_stats: List[TCATradeStat]
    aggregates: TCAAggregates
