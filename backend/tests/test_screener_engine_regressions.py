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
