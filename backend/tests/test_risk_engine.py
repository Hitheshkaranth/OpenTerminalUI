from __future__ import annotations

import numpy as np
import pandas as pd

from backend.risk_engine.engine import compute_portfolio_risk


def test_compute_portfolio_risk_deterministic() -> None:
    dates = pd.date_range("2025-01-01", periods=120, freq="D")
    df = pd.DataFrame(
        {
            "AAA": np.linspace(-0.02, 0.03, 120),
            "BBB": np.linspace(-0.01, 0.02, 120),
            "CCC": np.linspace(-0.015, 0.01, 120),
        },
        index=dates,
    )
    a = compute_portfolio_risk(df, portfolio_value=1_000_000, confidence=0.95)
    b = compute_portfolio_risk(df, portfolio_value=1_000_000, confidence=0.95)
    assert a["parametric"]["var"] == b["parametric"]["var"]
    assert a["historical"]["es"] == b["historical"]["es"]
    assert "market_beta" in a["factor_exposures"]
