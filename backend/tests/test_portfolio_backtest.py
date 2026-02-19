from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from backend.core.portfolio_backtest import run_portfolio_backtest


@dataclass
class _Bar:
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: int


class _FakeSvc:
    def fetch_daily_ohlcv(self, raw_symbol: str, market: str, start: str | None, end: str | None, limit: int):
        del market, start, end, limit
        bars = [
            _Bar("2025-01-01", 100, 101, 99, 100, 1000),
            _Bar("2025-01-02", 101, 103, 100, 102, 1000),
            _Bar("2025-01-03", 102, 104, 101, 103, 1000),
            _Bar("2025-01-04", 103, 105, 102, 104, 1000),
        ]
        symbol = type("S", (), {"canonical": raw_symbol.upper()})()
        return symbol, bars


class _FakeRunner:
    def __init__(self, timeout_seconds: float) -> None:
        del timeout_seconds

    def run(self, strategy: str, frame: pd.DataFrame, context: dict):
        del strategy, context
        return type("Out", (), {"signals": pd.Series([1] * len(frame), dtype=int)})()


def test_portfolio_backtest_smoke(monkeypatch) -> None:
    monkeypatch.setattr("backend.core.portfolio_backtest.get_historical_data_service", lambda: _FakeSvc())
    monkeypatch.setattr("backend.core.portfolio_backtest.StrategyRunner", _FakeRunner)
    result = run_portfolio_backtest(
        assets=["RELIANCE", "TCS"],
        market="NSE",
        start="2025-01-01",
        end="2025-06-01",
        limit=120,
        strategy="example:sma_crossover",
        context={"short_window": 5, "long_window": 20},
        config={"initial_cash": 100000},
    )
    assert "summary" in result
    assert "equity_curve" in result
    assert isinstance(result["assets"], list)
