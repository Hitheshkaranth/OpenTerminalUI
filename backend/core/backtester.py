from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
import yfinance as yf


@dataclass
class BacktestConfig:
    lookback_days: int = 63
    rebalance_freq: str = "M"
    top_n: int = 10
    transaction_cost_bps: float = 10.0
    benchmark: str = "^NSEI"


def _max_drawdown(equity_curve: pd.Series) -> float:
    running_max = equity_curve.cummax()
    drawdown = (equity_curve / running_max) - 1.0
    return float(drawdown.min()) if not drawdown.empty else 0.0


def _perf_metrics(returns: pd.Series, equity_curve: pd.Series) -> dict[str, float]:
    if returns.empty:
        return {"total_return": 0.0, "cagr": 0.0, "volatility": 0.0, "sharpe": 0.0, "max_drawdown": 0.0}
    days = max((equity_curve.index[-1] - equity_curve.index[0]).days, 1)
    total_return = float(equity_curve.iloc[-1] - 1.0)
    cagr = float((equity_curve.iloc[-1]) ** (365.0 / days) - 1.0)
    vol = float(returns.std() * (252**0.5))
    sharpe = float((returns.mean() * 252) / vol) if vol > 0 else 0.0
    mdd = _max_drawdown(equity_curve)
    return {
        "total_return": total_return,
        "cagr": cagr,
        "volatility": vol,
        "sharpe": sharpe,
        "max_drawdown": mdd,
    }


def _download_close(tickers: list[str], start: str, end: str) -> pd.DataFrame:
    norm = []
    for t in tickers:
        t = t.strip().upper()
        if "." in t or t.startswith("^"):
            norm.append(t)
        else:
            norm.append(f"{t}.NS")
    data = yf.download(norm, start=start, end=end, auto_adjust=True, progress=False)
    if data.empty:
        return pd.DataFrame()
    close = data["Close"] if isinstance(data.columns, pd.MultiIndex) else data
    if isinstance(close, pd.Series):
        close = close.to_frame()
    rename_map = {}
    for t in close.columns:
        t_str = str(t).upper()
        rename_map[t] = t_str.replace(".NS", "")
    close = close.rename(columns=rename_map).sort_index()
    return close


def backtest_momentum_rotation(
    tickers: list[str],
    start: str,
    end: str,
    config: BacktestConfig,
) -> dict:
    prices = _download_close(tickers, start, end)
    if prices.empty or len(prices.columns) == 0:
        raise ValueError("No price data available for the selected universe/date range.")
    prices = prices.dropna(axis=1, how="all").ffill().dropna(how="all")
    daily_ret = prices.pct_change().fillna(0.0)
    momentum = prices.pct_change(config.lookback_days)

    rebal_dates = prices.resample(config.rebalance_freq).last().index
    rebal_dates = [d for d in rebal_dates if d in prices.index]
    if len(rebal_dates) < 2:
        raise ValueError("Insufficient data for selected rebalance frequency/date range.")

    port_returns = pd.Series(0.0, index=prices.index)
    holdings_history: list[dict] = []
    prev_holdings: set[str] = set()

    for i in range(len(rebal_dates) - 1):
        dt = rebal_dates[i]
        next_dt = rebal_dates[i + 1]
        scores = momentum.loc[dt].dropna().sort_values(ascending=False)
        picks = scores.head(config.top_n).index.tolist()
        curr_holdings = set(picks)
        if not picks:
            continue
        period_mask = (daily_ret.index > dt) & (daily_ret.index <= next_dt)
        period = daily_ret.loc[period_mask, picks]
        if period.empty:
            continue
        gross = period.mean(axis=1)

        turnover = 1.0 if not prev_holdings else 1.0 - (len(prev_holdings & curr_holdings) / float(config.top_n))
        cost = (config.transaction_cost_bps / 10000.0) * max(turnover, 0.0)
        gross.iloc[0] = gross.iloc[0] - cost

        port_returns.loc[period.index] = gross.values
        holdings_history.append(
            {
                "rebalance_date": dt,
                "holdings": ", ".join(sorted(curr_holdings)),
                "turnover": turnover,
                "cost_applied": cost,
            }
        )
        prev_holdings = curr_holdings

    port_returns = port_returns.loc[port_returns.index >= rebal_dates[0]]
    strategy_equity = (1.0 + port_returns).cumprod()
    strategy_metrics = _perf_metrics(port_returns, strategy_equity)

    bench_prices = _download_close([config.benchmark], start, end)
    if bench_prices.empty:
        benchmark_equity = pd.Series(index=strategy_equity.index, data=1.0)
        benchmark_metrics = {"total_return": 0.0, "cagr": 0.0, "volatility": 0.0, "sharpe": 0.0, "max_drawdown": 0.0}
    else:
        bench_col = bench_prices.columns[0]
        bench = bench_prices[bench_col].reindex(strategy_equity.index).ffill()
        bench_ret = bench.pct_change().fillna(0.0)
        benchmark_equity = (1.0 + bench_ret).cumprod()
        benchmark_metrics = _perf_metrics(bench_ret, benchmark_equity)

    summary = {
        "strategy": strategy_metrics,
        "benchmark": benchmark_metrics,
        "alpha_total_return": strategy_metrics["total_return"] - benchmark_metrics["total_return"],
    }
    equity_df = pd.DataFrame(
        {
            "strategy": strategy_equity,
            "benchmark": benchmark_equity.reindex(strategy_equity.index).ffill(),
        }
    )
    holdings_df = pd.DataFrame(holdings_history)
    return {"equity_curve": equity_df, "holdings": holdings_df, "summary": summary}
