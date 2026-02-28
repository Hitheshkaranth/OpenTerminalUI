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


def _intraday_trade_stats(trades: list[TradeRecord], date_index: pd.DatetimeIndex) -> tuple[float, float, float]:
    if not trades:
        return 0.0, 0.0, 0.0

    hold_times = []
    morning_wins = 0
    morning_losses = 0
    afternoon_wins = 0
    afternoon_losses = 0

    open_trade: TradeRecord | None = None
    open_time: pd.Timestamp | None = None

    for trade in trades:
        action = trade.action.upper()
        trade_time = pd.to_datetime(trade.date)

        if action == "BUY":
            open_trade = trade
            open_time = trade_time
            continue

        if action == "SELL" and open_trade is not None:
            qty = abs(open_trade.quantity or trade.quantity or 1.0)
            pnl = (trade.price - open_trade.price) * qty

            if open_time is not None:
                hold_mins = (trade_time - open_time).total_seconds() / 60.0
                hold_times.append(hold_mins)

            is_morning = trade_time.hour < 12
            if pnl > 0:
                if is_morning:
                    morning_wins += 1
                else:
                    afternoon_wins += 1
            elif pnl < 0:
                if is_morning:
                    morning_losses += 1
                else:
                    afternoon_losses += 1

            open_trade = None

    avg_hold = float(np.mean(hold_times)) if hold_times else 0.0
    morning_total = morning_wins + morning_losses
    afternoon_total = afternoon_wins + afternoon_losses

    win_rate_morning = (morning_wins / morning_total * 100.0) if morning_total > 0 else 0.0
    win_rate_afternoon = (afternoon_wins / afternoon_total * 100.0) if afternoon_total > 0 else 0.0

    return _safe_float(avg_hold), _safe_float(win_rate_morning), _safe_float(win_rate_afternoon)


class BacktestEngine:
    def __init__(self, config: BacktestConfig | None = None) -> None:
        self.config = config or BacktestConfig()

    def run(self, symbol: str, frame: pd.DataFrame, signals: pd.Series, asset: str | None = None) -> BacktestResult:
        if frame.empty:
            raise ValueError("No OHLCV data provided")
        required = {"date", "close"}
        missing = required - set(frame.columns)
        if missing:
            raise ValueError(f"Missing columns: {sorted(missing)}")
        if len(signals) != len(frame):
            raise ValueError("Signals length must match OHLCV length")

        date_index = pd.to_datetime(frame["date"], errors="coerce")
        N = len(frame)

        target_signals = signals.fillna(0).astype(int).values
        if not self.config.allow_short:
            target_signals[target_signals < 0] = 0

        # Apply fill delay
        delay = getattr(self.config, "fill_delay_bars", 0)
        if delay > 0:
            target_signals = np.roll(target_signals, delay)
            target_signals[:delay] = 0

        closes = frame["close"].values.astype(float)
        opens = frame["open"].values.astype(float) if "open" in frame.columns else closes
        highs = frame["high"].values.astype(float) if "high" in frame.columns else closes
        lows = frame["low"].values.astype(float) if "low" in frame.columns else closes
        dates = frame["date"].values

        timeframe = getattr(self.config, "timeframe", "1d")
        if timeframe != "1d":
            trade_prices = np.roll(opens, -1)
            trade_prices[-1] = closes[-1]
        else:
            trade_prices = closes

        positions = np.zeros(N, dtype=float)
        cash = np.zeros(N, dtype=float)
        equity = np.zeros(N, dtype=float)

        current_cash = float(self.config.initial_cash)
        current_pos = 0.0

        # Assume fee + slippage
        cost_bps = self.config.fee_bps + self.config.slippage_bps
        cost_multiplier_buy = 1.0 + (cost_bps / 10000.0)
        cost_multiplier_sell = 1.0 - (cost_bps / 10000.0)

        pos_size = float(self.config.position_size)
        pos_frac = float(self.config.position_fraction) if self.config.position_fraction is not None else None

        trades: list[TradeRecord] = []
        equity_curve: list[EquityPoint] = []

        for i in range(N):
            target = target_signals[i]
            trade_px = trade_prices[i]
            close_px = closes[i]

            if target == 0:
                target_pos = 0.0
            elif pos_frac is not None:
                eq_now = max(current_cash + current_pos * close_px, 0.0)
                target_notional = eq_now * pos_frac
                units = int(target_notional // trade_px) if trade_px > 0 else 0
                target_pos = float(units * (1 if target > 0 else -1))
            else:
                target_pos = float(target) * pos_size

            if target_pos != current_pos:
                qty_delta = target_pos - current_pos
                trade_notional = qty_delta * trade_px

                if qty_delta > 0:
                    cost = trade_notional * (cost_multiplier_buy - 1.0)
                else:
                    cost = abs(trade_notional) * (1.0 - cost_multiplier_sell)

                current_cash -= trade_notional
                current_cash -= cost
                current_pos = target_pos

                action = "BUY" if qty_delta > 0 else "SELL"
                trades.append(
                    TradeRecord(
                        date=str(dates[i]),
                        action=action,
                        quantity=float(qty_delta),
                        price=float(trade_px),
                        cash_after=float(current_cash),
                        position_after=float(current_pos),
                    )
                )

            positions[i] = current_pos
            cash[i] = current_cash
            equity[i] = current_cash + current_pos * close_px

            equity_curve.append(
                EquityPoint(
                    date=str(dates[i]),
                    open=float(opens[i]),
                    high=float(highs[i]),
                    low=float(lows[i]),
                    equity=float(equity[i]),
                    cash=float(current_cash),
                    position=float(current_pos),
                    close=float(close_px),
                    signal=int(target),
                )
            )

        equity_series = pd.Series(equity, index=date_index)
        returns = equity_series.pct_change().replace([np.inf, -np.inf], np.nan).dropna()
        final_equity = float(equity[-1]) if N > 0 else float(self.config.initial_cash)
        pnl_amount = final_equity - float(self.config.initial_cash)
        total_return = (final_equity / self.config.initial_cash) - 1.0 if N > 0 else 0.0

        running_max = np.maximum.accumulate(equity)
        drawdowns = (equity / running_max) - 1.0
        max_drawdown = float(np.min(drawdowns)) if N > 0 else 0.0

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
        drawdown_start, drawdown_trough, drawdown_recovery = _drawdown_metadata(pd.Series(drawdowns, index=date_index))
        rolling_metrics = _rolling_metrics(returns, window=60)

        if N > 2:
            x = np.arange(N, dtype=float)
            y = equity
            coeff = np.polyfit(x, y, 1)
            trend = coeff[0] * x + coeff[1]
            ss_res = float(np.sum((y - trend) ** 2))
            ss_tot = float(np.sum((y - np.mean(y)) ** 2))
            return_stability_r2 = float(1.0 - (ss_res / ss_tot)) if ss_tot > 0 else 0.0
        else:
            return_stability_r2 = 0.0

        daily_returns = [round(float(x), 8) for x in returns.tolist()][:500] # Limiting size for API
        drawdown_series = [round(float(x), 8) for x in np.nan_to_num(drawdowns).tolist()][:500]

        # Intraday specific metrics
        avg_hold, win_rate_morning, win_rate_afternoon = _intraday_trade_stats(trades, date_index)
        unique_days = len(np.unique(date_index.date)) if not date_index.empty else 1
        trades_per_day = float(len(trades) / unique_days) if unique_days > 0 else 0.0

        return BacktestResult(
            symbol=symbol,
            asset=(asset or symbol),
            bars=len(equity_curve),
            initial_cash=float(self.config.initial_cash),
            final_equity=final_equity,
            pnl_amount=pnl_amount,
            ending_cash=float(current_cash),
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
            trades_per_day=trades_per_day,
            average_hold_time_minutes=avg_hold,
            max_intraday_drawdown=max_drawdown if timeframe != '1d' else 0.0,
            win_rate_morning=win_rate_morning,
            win_rate_afternoon=win_rate_afternoon,
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
