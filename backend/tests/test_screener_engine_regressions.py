from __future__ import annotations

import pandas as pd

import backend.screener.engine as screener_engine
from backend.screener.engine import RunConfig, ScreenerEngine


def test_run_handles_multiword_query_and_builds_viz_with_sparse_columns(monkeypatch) -> None:
    # Minimal sparse dataset reproduces prior crashes in _enrich_columns/_build_viz.
    df = pd.DataFrame(
        [
            {
                "ticker": "RELIANCE",
                "company_name": "Reliance Industries",
                "sector": "Energy",
                "current_price": 100.0,
                "market_cap": 1000.0,
                "roe_pct": 20.0,
                "pe": 10.0,
            }
        ]
    )

    monkeypatch.setattr(screener_engine, "load_screener_df", lambda symbols: df)

    engine = ScreenerEngine()
    result = engine.run(
        RunConfig(
            query="Market Capitalization > 500 AND ROE > 15 AND Debt to equity < 0.5",
            universe="nse_500",
            limit=10,
        )
    )

    assert result["total_results"] == 1
    assert len(result["results"]) == 1
    assert "viz_data" in result
    assert "roe_histogram" in result["viz_data"]


def test_run_reports_real_runtime_and_cache_is_not_mutated(monkeypatch) -> None:
    df = pd.DataFrame(
        [{"ticker": "TCS", "company_name": "TCS", "sector": "IT", "current_price": 100.0, "market_cap": 1000.0, "roe_pct": 30.0, "pe": 25.0}]
    )
    monkeypatch.setattr(screener_engine, "load_screener_df", lambda symbols: df)
    engine = ScreenerEngine()
    config = RunConfig(query="ROE > 15", universe="nse_500", limit=10)

    first = engine.run(config)
    assert first["execution_time_ms"] > 0  # was hard-coded 0, so the UI showed "--"

    first["results"] = []  # e.g. router column trimming
    second = engine.run(config)
    assert len(second["results"]) == 1
    assert second["execution_time_ms"] >= 0
