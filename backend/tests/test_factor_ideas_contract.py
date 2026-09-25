from __future__ import annotations

import backend.core.factor_analysis as fa


def _row(symbol: str, composite: float, percentile: float, rank: int, name: str = "") -> dict:
    return {
        "symbol": symbol,
        "company_name": name,
        "sector": "IT",
        "scores": {"value": 0.1, "momentum": 0.2, "quality": 0.3, "low_volatility": 0.0, "composite": composite, "percentile": percentile, "rank": rank},
    }


def test_top_factor_ideas_sorted_by_composite_with_flat_fields(monkeypatch) -> None:
    rows = [
        _row("AAA", 0.9, 85.0, 3, "Alpha Ltd"),
        _row("BBB", 1.5, 95.0, 1, "Beta Ltd"),
        _row("CCC", 1.1, 90.0, 2, ""),
        _row("DDD", -0.4, 20.0, 9, "Delta Ltd"),
    ]
    monkeypatch.setattr(fa, "compute_factor_scores", lambda *a, **k: list(rows))

    ideas = fa.top_factor_ideas(None, market="IN")  # type: ignore[arg-type]

    assert [i["symbol"] for i in ideas] == ["BBB", "CCC", "AAA"]
    assert ideas[0]["name"] == "Beta Ltd"
    assert ideas[1]["name"] == "CCC"  # falls back to symbol, never "-"
    assert ideas[0]["composite_score"] == 1.5
    assert ideas[0]["percentile"] == 95.0
    assert ideas[0]["rank"] == 1
