from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from backend.core.backtesting_models import BacktestConfig, BacktestResult, EquityPoint, TradeRecord


def _safe_float(value: float | int | np.floating | None) -> float:
    if value is None or not np.isfinite(value):
        return 0.0
    return float(value)


def _max_consecutive_losses(trades: list[TradeRecord]) -> int:
    streak = 0
    max_streak = 0
    open_trade: TradeRecord | None = None
    for trade in trades:
        action = trade.action.upper()
        if action == "BUY":
            open_trade = trade
            continue
        if action != "SELL" or open_trade is None:
            continue
        pnl = (trade.price - open_trade.price) * abs(open_trade.quantity or trade.quantity or 1.0)
        if pnl < 0:
            streak += 1
            max_streak = max(max_streak, streak)
        else:
            streak = 0
        open_trade = None
    return max_streak


def _trade_stats(trades: list[TradeRecord]) -> tuple[float, float, float, float]:
    pnls: list[float] = []
    open_trade: TradeRecord | None = None
    for trade in trades:
        action = trade.action.upper()
        if action == "BUY":
            open_trade = trade
            continue
        if action != "SELL" or open_trade is None:
            continue
        qty = abs(open_trade.quantity or trade.quantity or 1.0)
        pnls.append((trade.price - open_trade.price) * qty)
        open_trade = None
    if not pnls:
        return 0.0, 0.0, 0.0, 0.0
    pnl_series = pd.Series(pnls, dtype=float)
    wins = pnl_series[pnl_series > 0]
    losses = pnl_series[pnl_series < 0]
    win_rate = _safe_float((wins.count() / pnl_series.count()) * 100.0)
    avg_win = _safe_float(wins.mean()) if not wins.empty else 0.0
    avg_loss = _safe_float(losses.mean()) if not losses.empty else 0.0
    gross_profit = _safe_float(wins.sum())
    gross_loss = abs(_safe_float(losses.sum()))
    profit_factor = _safe_float(gross_profit / gross_loss) if gross_loss > 0 else 0.0
    return win_rate, avg_win, avg_loss, profit_factor


def _drawdown_metadata(drawdown: pd.Series) -> tuple[str | None, str | None, str | None]:
    if drawdown.empty:
        return None, None, None
    trough_ts = drawdown.idxmin()
    trough_val = float(drawdown.min())
    if not np.isfinite(trough_val) or trough_val >= 0:
        return None, None, None
    start_candidates = drawdown.loc[:trough_ts]
    start_ts = start_candidates[start_candidates == 0].index.max() if not start_candidates.empty else None
    recovery_candidates = drawdown.loc[trough_ts:]
    recovery_hits = recovery_candidates[recovery_candidates >= 0]
    recovery_ts = recovery_hits.index.min() if not recovery_hits.empty else None
    start = start_ts.date().isoformat() if hasattr(start_ts, "date") else None
    trough = trough_ts.date().isoformat() if hasattr(trough_ts, "date") else None
    recovery = recovery_ts.date().isoformat() if hasattr(recovery_ts, "date") else None
    return start, trough, recovery


def _rolling_metrics(returns: pd.Series, window: int = 60) -> list[dict[str, float | str]]:
    if returns.empty or len(returns) < window:
        return []
    rolling_mean = returns.rolling(window).mean() * 252.0
    rolling_vol = returns.rolling(window).std() * np.sqrt(252.0)
    rolling_sharpe = (rolling_mean / rolling_vol.replace(0, np.nan)).replace([np.inf, -np.inf], np.nan)
    out: list[dict[str, float | str]] = []
    for ts, value in rolling_sharpe.dropna().items():
        if hasattr(ts, "date"):
            date_value = ts.date().isoformat()
        else:
            date_value = str(ts)
        out.append({"date": date_value, "rolling_sharpe": round(float(value), 6)})
    return out


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

        date_index = pd.to_datetime(work["date"], errors="coerce")
        if date_index.isna().all():
            equity_series = pd.Series([point.equity for point in equity_curve], dtype=float)
        else:
            equity_series = pd.Series([point.equity for point in equity_curve], index=date_index, dtype=float)
        returns = equity_series.pct_change().replace([np.inf, -np.inf], np.nan).dropna()
        final_equity = float(equity_series.iloc[-1]) if not equity_series.empty else float(self.config.initial_cash)
        pnl_amount = final_equity - float(self.config.initial_cash)
        total_return = (equity_series.iloc[-1] / self.config.initial_cash) - 1.0 if not equity_series.empty else 0.0
        drawdown = (equity_series / equity_series.cummax()) - 1.0 if not equity_series.empty else pd.Series(dtype=float)
        max_drawdown = float(drawdown.min()) if not drawdown.empty else 0.0
        vol = float(returns.std() * (252 ** 0.5)) if not returns.empty else 0.0
        sharpe = float((returns.mean() * 252) / vol) if vol > 0 else 0.0
        downside = returns[returns < 0]
        downside_vol = float(downside.std() * np.sqrt(252.0)) if not downside.empty else 0.0
        sortino = float((returns.mean() * 252) / downside_vol) if downside_vol > 0 else 0.0
        calmar = float((returns.mean() * 252) / abs(max_drawdown)) if max_drawdown < 0 else 0.0
        threshold = 0.0
        gains = returns[returns > threshold] - threshold
        losses = threshold - returns[returns < threshold]
        omega = float(gains.sum() / losses.sum()) if not losses.empty and float(losses.sum()) > 0 else 0.0
        var_95 = float(returns.quantile(0.05)) if not returns.empty else 0.0
        var_99 = float(returns.quantile(0.01)) if not returns.empty else 0.0
        cvar_95 = float(returns[returns <= var_95].mean()) if not returns.empty else 0.0
        cvar_99 = float(returns[returns <= var_99].mean()) if not returns.empty else 0.0
        upper_tail = float(returns.quantile(0.95)) if not returns.empty else 0.0
        lower_tail = abs(float(returns.quantile(0.05))) if not returns.empty else 0.0
        tail_ratio = float(upper_tail / lower_tail) if lower_tail > 0 else 0.0
        win_rate, avg_win, avg_loss, profit_factor = _trade_stats(trades)
        max_cons_losses = _max_consecutive_losses(trades)
        drawdown_start, drawdown_trough, drawdown_recovery = _drawdown_metadata(drawdown)
        rolling_metrics = _rolling_metrics(returns, window=60)
        if len(equity_series) > 2:
            x = np.arange(len(equity_series), dtype=float)
            y = equity_series.to_numpy(dtype=float)
            coeff = np.polyfit(x, y, 1)
            trend = coeff[0] * x + coeff[1]
            ss_res = float(np.sum((y - trend) ** 2))
            ss_tot = float(np.sum((y - np.mean(y)) ** 2))
            return_stability_r2 = float(1.0 - (ss_res / ss_tot)) if ss_tot > 0 else 0.0
        else:
            return_stability_r2 = 0.0
        daily_returns = [round(float(x), 8) for x in returns.tolist()]
        drawdown_series = [round(float(x), 8) for x in drawdown.fillna(0.0).tolist()]

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
            sortino=sortino,
            calmar=calmar,
            omega=omega,
            profit_factor=profit_factor,
            win_rate=win_rate,
            avg_win=avg_win,
            avg_loss=avg_loss,
            var_95=var_95,
            var_99=var_99,
            cvar_95=_safe_float(cvar_95),
            cvar_99=_safe_float(cvar_99),
            tail_ratio=tail_ratio,
            max_consecutive_losses=max_cons_losses,
            return_stability_r2=_safe_float(return_stability_r2),
            drawdown_start=drawdown_start,
            drawdown_trough=drawdown_trough,
            drawdown_recovery=drawdown_recovery,
            daily_returns=daily_returns,
            drawdown_series=drawdown_series,
            rolling_metrics=rolling_metrics,
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
