from __future__ import annotations

from pydantic import BaseModel, Field


class BacktestConfig(BaseModel):
    initial_cash: float = Field(100000.0, gt=0)
    fee_bps: float = Field(0.0, ge=0)
    slippage_bps: float = Field(0.0, ge=0)
    position_size: float = Field(1.0, gt=0)
    position_fraction: float | None = Field(default=None, gt=0, le=1)
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
    asset: str
    bars: int
    initial_cash: float
    final_equity: float
    pnl_amount: float
    ending_cash: float
    total_return: float
    max_drawdown: float
    sharpe: float
    trades: list[TradeRecord]
    equity_curve: list[EquityPoint]
