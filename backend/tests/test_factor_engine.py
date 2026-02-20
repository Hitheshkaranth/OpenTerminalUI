from __future__ import annotations

import pandas as pd

from backend.equity.screener_v2 import FactorEngine, FactorSpec


def test_factor_composite_score():
    df = pd.DataFrame(
        [
            {"ticker": "A", "sector": "IT", "roe_pct": 25, "pe": 15, "rev_growth_pct": 18},
            {"ticker": "B", "sector": "IT", "roe_pct": 12, "pe": 35, "rev_growth_pct": 5},
            {"ticker": "C", "sector": "BANK", "roe_pct": 20, "pe": 18, "rev_growth_pct": 12},
            {"ticker": "D", "sector": "BANK", "roe_pct": 8, "pe": 28, "rev_growth_pct": 4},
        ]
    )
    engine = FactorEngine(df)
    scored = engine.score(
        [
            FactorSpec("roe_pct", weight=0.4, higher_is_better=True),
            FactorSpec("pe", weight=0.4, higher_is_better=False),
            FactorSpec("rev_growth_pct", weight=0.2, higher_is_better=True),
        ],
        sector_neutral=False,
    )

    ranked = scored.sort_values("composite_score", ascending=False).reset_index(drop=True)
    assert ranked.loc[0, "ticker"] == "A"
    assert ranked.loc[0, "composite_rank"] == 1
    assert "factor_roe_pct_z" in scored.columns
    assert "factor_pe_z" in scored.columns


def test_sector_neutralization():
    df = pd.DataFrame(
        [
            {"ticker": "IT1", "sector": "IT", "roe_pct": 30},
            {"ticker": "IT2", "sector": "IT", "roe_pct": 10},
            {"ticker": "BNK1", "sector": "BANK", "roe_pct": 15},
            {"ticker": "BNK2", "sector": "BANK", "roe_pct": 5},
        ]
    )
    engine = FactorEngine(df)
    scored = engine.score([FactorSpec("roe_pct", weight=1.0)], sector_neutral=True)

    grouped_means = scored.groupby("sector")["factor_roe_pct_z"].mean().round(6)
    assert abs(float(grouped_means["IT"])) < 1e-6
    assert abs(float(grouped_means["BANK"])) < 1e-6
