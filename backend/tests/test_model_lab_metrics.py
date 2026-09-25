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


def test_trade_stats_use_realized_round_trip_pnl_and_unbiased_beta() -> None:
    equity_curve = [{"date": f"2025-01-0{i}", "equity": v} for i, v in enumerate([100.0, 101.0, 99.0, 102.0, 103.0], start=1)]
    trades = [
        {"action": "BUY", "price": 100, "quantity": 10},
        {"action": "SELL", "price": 102, "quantity": 10},
        {"action": "BUY", "price": 50, "quantity": 4},
        {"action": "SELL", "price": 45, "quantity": 4},
    ]
    out = compute_run_metrics(equity_curve=equity_curve, trades=trades)
    assert out["win_rate"] == 0.5
    assert out["avg_win"] == 20.0
    assert out["avg_loss"] == -20.0
    assert out["profit_factor"] == 1.0

    # Strategy returns exactly 2x the benchmark -> beta must be exactly 2, not 2*n/(n-1).
    bench = [0.01, -0.02, 0.015, 0.005]
    curve = [{"date": "d0", "equity": 1.0}]
    for r in bench:
        curve.append({"date": "d", "equity": curve[-1]["equity"] * (1 + 2 * r)})
    assert abs(compute_run_metrics(curve, benchmark_returns=bench)["beta"] - 2.0) < 1e-9
