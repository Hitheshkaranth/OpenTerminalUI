from __future__ import annotations

import math
from typing import Any


def default_score(features: dict[str, Any]) -> float:
    trend_alignment = float(features.get("trend_alignment") or 0.0)
    breakout_strength = float(features.get("breakout_strength") or 0.0)
    rvol = float(features.get("rvol") or 1.0)
    atr_pct = float(features.get("atr_pct") or 0.0)
    return trend_alignment + breakout_strength + math.log(max(rvol, 1e-6)) - (0.2 * atr_pct)


def rank_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    for row in results:
        features = row.get("features") if isinstance(row.get("features"), dict) else {}
        score = default_score(features)
        out = dict(row)
        out["score"] = round(float(score), 6)
        enriched.append(out)
    return sorted(enriched, key=lambda x: (-float(x.get("score") or 0.0), str(x.get("symbol") or "")))
