from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backend.core.technicals import compute_indicator, rsi


def _ohlc(n: int = 60) -> pd.DataFrame:
    close = pd.Series(np.linspace(100, 120, n) + np.sin(np.arange(n)))
    return pd.DataFrame({"High": close + 1, "Low": close - 1, "Close": close, "Volume": 1000.0})


@pytest.mark.parametrize("itype", ["stochastic", "adx", "cci", "williams_r"])
def test_compute_indicator_runs_on_current_pandas(itype: str) -> None:
    out = compute_indicator(_ohlc(), itype, {})
    assert np.isfinite(out.iloc[-1].astype(float)).all()


def test_cci_uses_window_mean_deviation() -> None:
    df = _ohlc()
    tp = (df["High"] + df["Low"] + df["Close"]) / 3
    mad = tp.rolling(20).apply(lambda x: np.abs(x - x.mean()).mean(), raw=True)
    expected = ((tp - tp.rolling(20).mean()) / (0.015 * mad)).iloc[-1]
    assert compute_indicator(df, "cci", {})["cci"].iloc[-1] == pytest.approx(expected)


def test_rsi_is_100_when_window_has_no_losses() -> None:
    out = rsi(pd.Series(np.arange(20.0)), 5)
    assert out.iloc[-1] == pytest.approx(100.0)
