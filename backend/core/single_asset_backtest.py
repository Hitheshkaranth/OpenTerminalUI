from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from backend.core.backtesting_models import BacktestConfig, BacktestResult, EquityPoint, TradeRecord


@dataclass
class Portfolio:
    cash: float
    position: float = 0.0

    def equity(self, close_price: float) -> float:
        return self.cash + (self.position * close_price)


class Broker:
    def __init__(self, fee_bps: float = 0.0, slippage_bps: float = 0.0) -> None:
        self.fee_bps = fee_bps
        self.slippage_bps = slippage_bps

    def _cost_multiplier(self) -> float:
        return 1.0 + ((self.fee_bps + self.slippage_bps) / 10000.0)

    def execute(self, portfolio: Portfolio, target_position: float, close_price: float) -> tuple[float, str] | None:
        current = portfolio.position
        if current == target_position:
            return None
        qty_delta = target_position - current
        trade_notional = qty_delta * close_price
        cost = abs(trade_notional) * (self._cost_multiplier() - 1.0)
        portfolio.cash -= trade_notional
        portfolio.cash -= cost
        portfolio.position = target_position
        action = "BUY" if qty_delta > 0 else "SELL"
        return float(qty_delta), action


class BacktestEngine:
    def __init__(self, config: BacktestConfig | None = None) -> None:
        self.config = config or BacktestConfig()
        self.broker = Broker(fee_bps=self.config.fee_bps, slippage_bps=self.config.slippage_bps)

    def run(self, symbol: str, frame: pd.DataFrame, signals: pd.Series, asset: str | None = None) -> BacktestResult:
        if frame.empty:
            raise ValueError("No OHLCV data provided")
        required = {"date", "close"}
        missing = required - set(frame.columns)
        if missing:
            raise ValueError(f"Missing columns: {sorted(missing)}")
        if len(signals) != len(frame):
            raise ValueError("Signals length must match OHLCV length")
        if not set(int(x) for x in signals.tolist()).issubset({-1, 0, 1}):
            raise ValueError("Signals must contain only -1, 0, 1")

        work = frame.copy()
        work["signal"] = signals.astype(int).values
        portfolio = Portfolio(cash=float(self.config.initial_cash))
        trades: list[TradeRecord] = []
        equity_curve: list[EquityPoint] = []

        for _, row in work.iterrows():
            target = int(row["signal"])
            if not self.config.allow_short and target < 0:
                target = 0
            close_price = float(row["close"])
            if target == 0:
                target_position = 0.0
            elif self.config.position_fraction is not None:
                equity_now = max(portfolio.equity(close_price), 0.0)
                target_notional = equity_now * float(self.config.position_fraction)
                units = int(target_notional // close_price) if close_price > 0 else 0
                target_position = float(units * (1 if target > 0 else -1))
            else:
                target_position = float(target) * float(self.config.position_size)
            trade = self.broker.execute(portfolio, target_position, close_price)
            if trade is not None:
                qty_delta, action = trade
                trades.append(
                    TradeRecord(
                        date=str(row["date"]),
                        action=action,
                        quantity=qty_delta,
                        price=close_price,
                        cash_after=portfolio.cash,
                        position_after=portfolio.position,
                    )
                )
            equity_curve.append(
                EquityPoint(
                    date=str(row["date"]),
                    open=float(row["open"]),
                    high=float(row["high"]),
                    low=float(row["low"]),
                    equity=portfolio.equity(close_price),
                    cash=portfolio.cash,
                    position=portfolio.position,
                    close=close_price,
                    signal=target,
                )
            )

        equity_series = pd.Series([point.equity for point in equity_curve], dtype=float)
        returns = equity_series.pct_change().dropna()
        final_equity = float(equity_series.iloc[-1]) if not equity_series.empty else float(self.config.initial_cash)
        pnl_amount = final_equity - float(self.config.initial_cash)
        total_return = (equity_series.iloc[-1] / self.config.initial_cash) - 1.0 if not equity_series.empty else 0.0
        drawdown = (equity_series / equity_series.cummax()) - 1.0 if not equity_series.empty else pd.Series(dtype=float)
        max_drawdown = float(drawdown.min()) if not drawdown.empty else 0.0
        vol = float(returns.std() * (252 ** 0.5)) if not returns.empty else 0.0
        sharpe = float((returns.mean() * 252) / vol) if vol > 0 else 0.0

        return BacktestResult(
            symbol=symbol,
            asset=(asset or symbol),
            bars=len(equity_curve),
            initial_cash=float(self.config.initial_cash),
            final_equity=final_equity,
            pnl_amount=pnl_amount,
            ending_cash=float(portfolio.cash),
            total_return=float(total_return),
            max_drawdown=max_drawdown,
            sharpe=sharpe,
            trades=trades,
            equity_curve=equity_curve,
        )


def generate_sma_crossover_signals(
    frame: pd.DataFrame,
    short_window: int = 20,
    long_window: int = 50,
) -> pd.Series:
    if short_window <= 0 or long_window <= 0:
        raise ValueError("SMA windows must be positive")
    if short_window >= long_window:
        raise ValueError("short_window must be less than long_window")
    work = frame.copy()
    work["sma_short"] = work["close"].rolling(short_window, min_periods=short_window).mean()
    work["sma_long"] = work["close"].rolling(long_window, min_periods=long_window).mean()
    signal = pd.Series(0, index=work.index, dtype=int)
    signal.loc[work["sma_short"] > work["sma_long"]] = 1
    signal.loc[work["sma_short"] < work["sma_long"]] = -1
    return signal
