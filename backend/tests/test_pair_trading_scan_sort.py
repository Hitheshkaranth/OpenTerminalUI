from __future__ import annotations

import asyncio

import numpy as np
import pandas as pd

from backend.api.routes import pair_trading


def test_pair_scan_ranks_tiny_pvalues_first_and_nan_last(monkeypatch) -> None:
    """_coerce rounds p < 5e-7 to 0.0 (and maps NaN to 0.0); the old `or 1.0` sort key
    pushed the most strongly cointegrated pair to the bottom."""
    frame = pd.DataFrame({"A": np.arange(40.0), "B": np.arange(40.0), "C": np.arange(40.0), "D": np.arange(40.0)})
    pvalues = {("A", "B"): 0.3, ("A", "C"): 1e-9, ("A", "D"): float("nan"), ("B", "C"): 0.02}

    async def _load(_symbols, _period):
        return frame

    async def _no_cache(*_args, **_kwargs):
        return None

    def _eg(y, x):
        p = pvalues.get((y.name, x.name), 0.5)
        return {"beta": 1.0, "coint_pvalue": p, "adf_pvalue": p, "half_life": 5.0, "zscore_current": 0.0, "cointegrated": bool(p < 0.05)}

    monkeypatch.setattr(pair_trading, "_load_close_frame", _load)
    monkeypatch.setattr(pair_trading, "engle_granger", _eg)
    monkeypatch.setattr(pair_trading.cache_instance, "get", _no_cache)
    monkeypatch.setattr(pair_trading.cache_instance, "set", _no_cache)

    out = asyncio.run(pair_trading.pair_scan(pair_trading.PairScanRequest(symbols=["A", "B", "C", "D"]), None))
    order = [(r["symbol1"], r["symbol2"]) for r in out["results"]]
    assert order[0] == ("A", "C")
    assert order[1] == ("B", "C")
    assert order[-1] == ("A", "D")
    assert all("_sort_p" not in r for r in out["results"])
