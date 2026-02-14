from __future__ import annotations

from pydantic import BaseModel, Field


class BacktestConfig(BaseModel):
    initial_cash: float = Field(100000.0, gt=0)
    fee_bps: float = Field(0.0, ge=0)
    slippage_bps: float = Field(0.0, ge=0)
    allow_short: bool = True


class TradeRecord(BaseModel):
    date: str
    action: str
    quantity: float
    price: float
    cash_after: float
    position_after: float


class EquityPoint(BaseModel):
    date: str
    open: float
    high: float
    low: float
    equity: float
    cash: float
    position: float
    close: float
    signal: int


class BacktestResult(BaseModel):
    symbol: str
    bars: int
    total_return: float
    max_drawdown: float
    sharpe: float
    trades: list[TradeRecord]
    equity_curve: list[EquityPoint]
