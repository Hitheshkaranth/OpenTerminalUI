from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class BacktestConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    initial_cash: float = Field(100000.0, gt=0)
    fee_bps: float = Field(0.0, ge=0)
    slippage_bps: float = Field(0.0, ge=0)
    position_size: float = Field(1.0, gt=0)
    position_fraction: float | None = Field(default=None, gt=0, le=1)
    allow_short: bool = True
    timeframe: str = Field("1d")
    fill_delay_bars: int = Field(0, ge=0)
    intraday_slippage_model: bool = Field(False)


class TradeRecord(BaseModel):
    date: str
    action: str
    quantity: float
    price: float
    cash_after: float
    position_after: float
    hold_time_minutes: float = 0.0


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
    sortino: float = 0.0
    calmar: float = 0.0
    omega: float = 0.0
    profit_factor: float = 0.0
    win_rate: float = 0.0
    avg_win: float = 0.0
    avg_loss: float = 0.0
    var_95: float = 0.0
    var_99: float = 0.0
    cvar_95: float = 0.0
    cvar_99: float = 0.0
    tail_ratio: float = 0.0
    max_consecutive_losses: int = 0
    return_stability_r2: float = 0.0
    trades_per_day: float = 0.0
    average_hold_time_minutes: float = 0.0
    max_intraday_drawdown: float = 0.0
    win_rate_morning: float = 0.0
    win_rate_afternoon: float = 0.0
    drawdown_start: str | None = None
    drawdown_trough: str | None = None
    drawdown_recovery: str | None = None
    daily_returns: list[float] = Field(default_factory=list)
    drawdown_series: list[float] = Field(default_factory=list)
    rolling_metrics: list[dict[str, float | str]] = Field(default_factory=list)
    trades: list[TradeRecord]
    equity_curve: list[EquityPoint]
