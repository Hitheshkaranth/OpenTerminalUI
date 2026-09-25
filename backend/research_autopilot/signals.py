from __future__ import annotations

import pandas as pd

from backend.alpha_zoo.factors import FACTOR_REGISTRY
from backend.research_autopilot.schemas import SignalSpec


def build_signal_panel(spec: SignalSpec, panels: dict) -> pd.DataFrame:
    """Build a date x symbol signal panel from a signal specification."""

    close = panels.get("close")
    if not isinstance(close, pd.DataFrame):
        return pd.DataFrame()

    if spec.kind == "momentum":
        return (close / close.shift(int(spec.lookback_days)) - 1.0).replace([float("inf"), float("-inf")], float("nan"))

    factor_id = spec.factor_id or "momentum_12_1"
    factor = next((item for item in FACTOR_REGISTRY if item.id == factor_id), None)
    if factor is None:
        raise ValueError(f"Unknown factor_id: {factor_id}")
    return factor.fn(panels).reindex(index=close.index, columns=close.columns)

