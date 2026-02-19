from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def run_walk_forward_validation(
    equity_curve: list[dict[str, Any]],
    folds: int = 4,
    in_sample_ratio: float = 0.7,
) -> dict[str, Any]:
    if folds < 2:
        raise ValueError("folds must be >= 2")
    if in_sample_ratio <= 0.1 or in_sample_ratio >= 0.95:
        raise ValueError("in_sample_ratio must be between 0.1 and 0.95")

    frame = pd.DataFrame(equity_curve)
    if frame.empty or "equity" not in frame.columns:
        return {"folds": [], "summary": {"avg_in_sample_sharpe": 0.0, "avg_out_sample_sharpe": 0.0}}
    frame["equity"] = pd.to_numeric(frame["equity"], errors="coerce")
    frame = frame.dropna(subset=["equity"]).reset_index(drop=True)
    if len(frame) < 20:
        return {"folds": [], "summary": {"avg_in_sample_sharpe": 0.0, "avg_out_sample_sharpe": 0.0}}

    returns = frame["equity"].pct_change().replace([np.inf, -np.inf], np.nan).dropna().reset_index(drop=True)
    n = len(returns)
    fold_size = max(10, n // folds)

    fold_metrics: list[dict[str, Any]] = []
    for i in range(folds):
        start = i * fold_size
        end = min(n, start + fold_size)
        if end - start < 10:
            continue
        fold_slice = returns.iloc[start:end]
        split = max(5, int(len(fold_slice) * in_sample_ratio))
        in_sample = fold_slice.iloc[:split]
        out_sample = fold_slice.iloc[split:]
        if out_sample.empty:
            continue
        in_vol = float(in_sample.std() * np.sqrt(252.0))
        out_vol = float(out_sample.std() * np.sqrt(252.0))
        in_sharpe = float((in_sample.mean() * 252.0) / in_vol) if in_vol > 0 else 0.0
        out_sharpe = float((out_sample.mean() * 252.0) / out_vol) if out_vol > 0 else 0.0
        fold_metrics.append(
            {
                "fold": i + 1,
                "start_index": int(start),
                "end_index": int(end),
                "in_sample_sharpe": round(in_sharpe, 6),
                "out_sample_sharpe": round(out_sharpe, 6),
                "in_sample_return": round(float((1 + in_sample).prod() - 1), 6),
                "out_sample_return": round(float((1 + out_sample).prod() - 1), 6),
            }
        )

    if not fold_metrics:
        return {"folds": [], "summary": {"avg_in_sample_sharpe": 0.0, "avg_out_sample_sharpe": 0.0}}
    avg_in = float(np.mean([f["in_sample_sharpe"] for f in fold_metrics]))
    avg_out = float(np.mean([f["out_sample_sharpe"] for f in fold_metrics]))
    return {
        "folds": fold_metrics,
        "summary": {
            "avg_in_sample_sharpe": round(avg_in, 6),
            "avg_out_sample_sharpe": round(avg_out, 6),
            "degradation": round(avg_in - avg_out, 6),
        },
    }
