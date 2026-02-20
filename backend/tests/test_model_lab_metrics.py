from __future__ import annotations

from backend.model_lab.metrics import compute_run_metrics, compute_run_timeseries


def test_compute_run_metrics_deterministic() -> None:
    equity_curve = [
        {"date": "2025-01-01", "equity": 100000},
        {"date": "2025-01-02", "equity": 101000},
        {"date": "2025-01-03", "equity": 100500},
        {"date": "2025-01-04", "equity": 102000},
        {"date": "2025-01-05", "equity": 103000},
    ]
    trades = [
        {"action": "BUY", "price": 100, "quantity": 10},
        {"action": "SELL", "price": 102, "quantity": 10},
    ]

    first = compute_run_metrics(equity_curve=equity_curve, trades=trades)
    second = compute_run_metrics(equity_curve=equity_curve, trades=trades)

    assert first == second
    assert first["total_return"] > 0
    assert first["max_drawdown"] >= 0
    assert "sharpe" in first
    assert "sortino" in first


def test_compute_run_timeseries_contains_expected_series() -> None:
    equity_curve = [
        {"date": "2025-01-01", "equity": 100000},
        {"date": "2025-01-02", "equity": 100500},
        {"date": "2025-01-03", "equity": 101000},
        {"date": "2025-01-04", "equity": 100000},
        {"date": "2025-01-05", "equity": 102500},
        {"date": "2025-01-06", "equity": 103000},
    ]

    series = compute_run_timeseries(equity_curve=equity_curve)

    assert len(series["equity_curve"]) == len(equity_curve)
    assert len(series["drawdown"]) == len(equity_curve)
    assert "monthly_returns" in series
    assert "returns_histogram" in series
    assert isinstance(series["returns_histogram"]["counts"], list)
