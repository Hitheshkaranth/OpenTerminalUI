import json

import pandas as pd

from backend.core import factor_analysis as factors


def _sources(monkeypatch, snapshots):
    monkeypatch.setattr(factors, "_load_screener_snapshot", lambda *args: pd.DataFrame(snapshots))
    monkeypatch.setattr(factors, "_load_price_features", lambda *args: {})
    monkeypatch.setattr(factors, "_pit_fundamentals_or_empty", lambda *args: {})


def test_missing_only_universe_does_not_generate_alphabetical_top_ideas(monkeypatch):
    _sources(monkeypatch, [])
    assert factors.compute_factor_scores(None, symbols=["AAA", "ZZZ"]) == []


def test_equal_scores_receive_equal_ranks_and_percentiles(monkeypatch):
    _sources(monkeypatch, [{"ticker": "AAA", "pe": 10, "sector": "IT"}, {"ticker": "ZZZ", "pe": 10, "sector": "IT"}])
    rows = factors.compute_factor_scores(None, symbols=["AAA", "ZZZ"])
    assert rows[0]["scores"] == rows[1]["scores"]
    assert rows[0]["scores"]["percentile"] < 80
    assert rows[0]["raw_metrics"]["price_return_12m"] is None
    json.dumps(rows, allow_nan=False)


def test_missing_rows_are_excluded_from_factor_comparison(monkeypatch):
    _sources(monkeypatch, [{"ticker": "BBB", "pe": 10, "sector": "IT"}, {"ticker": "CCC", "pe": 20, "sector": "IT"}])
    rows = factors.compute_factor_scores(None, symbols=["AAA", "BBB", "CCC"])
    assert [row["symbol"] for row in rows] == ["BBB", "CCC"]
    assert rows[0]["scores"]["composite"] > rows[1]["scores"]["composite"]
    json.dumps(rows, allow_nan=False)


def test_factor_decomposition_requires_observed_factor_inputs():
    result = factors.run_factor_decomposition(daily_returns=[0.01] * 30)
    assert result["status"] == "unavailable"
    assert result["coefficients"] == {}
    assert result["r2"] is None
