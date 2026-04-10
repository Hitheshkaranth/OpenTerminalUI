from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import combinations
from math import isnan
from typing import Any, Literal

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.api.deps import get_unified_fetcher
from backend.api.routes.chart import _parse_yahoo_chart
from backend.auth.deps import get_current_user
from backend.models import User
from backend.shared.cache import cache as cache_instance

router = APIRouter(prefix="/api/correlation", tags=["correlation"])

FrequencyCode = Literal["daily"]
MatrixPeriodCode = Literal["1M", "3M", "6M", "1Y", "3Y"]
RollingPeriodCode = Literal["1Y", "3Y"]

_PERIOD_TO_RANGE: dict[str, str] = {
    "1M": "1mo",
    "3M": "3mo",
    "6M": "6mo",
    "1Y": "1y",
    "3Y": "3y",
}
_MATRIX_TTL_SECONDS = 3600


class CorrelationMatrixRequest(BaseModel):
    symbols: list[str] = Field(default_factory=list, min_length=2, max_length=20)
    period: MatrixPeriodCode = "1Y"
    frequency: FrequencyCode = "daily"


class CorrelationRollingRequest(BaseModel):
    symbol1: str = Field(min_length=1)
    symbol2: str = Field(min_length=1)
    window: int = Field(default=60, ge=5, le=252)
    period: RollingPeriodCode = "3Y"


class CorrelationClustersRequest(BaseModel):
    symbols: list[str] = Field(default_factory=list, min_length=2, max_length=20)
    period: MatrixPeriodCode = "1Y"
    n_clusters: int = Field(default=4, ge=2, le=8)


@dataclass
class ClusterNode:
    symbols: tuple[str, ...]
    distance: float
    left: ClusterNode | None = None
    right: ClusterNode | None = None


def _normalize_symbols(symbols: list[str]) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for raw in symbols:
        symbol = raw.strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        normalized.append(symbol)
    return normalized


def _period_to_range(period: str) -> str:
    try:
        return _PERIOD_TO_RANGE[period.upper()]
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=f"Unsupported period: {period}") from exc


def _returns_from_close(frame: pd.DataFrame) -> pd.Series:
    if frame.empty or "Close" not in frame:
        return pd.Series(dtype=float)
    close = pd.to_numeric(frame["Close"], errors="coerce").dropna()
    if close.empty:
        return pd.Series(dtype=float)
    returns = close.pct_change().dropna()
    if isinstance(frame.index, pd.DatetimeIndex):
        returns.index = frame.index[-len(returns):]
    return returns


async def _load_returns_frame(symbols: list[str], period: str, frequency: FrequencyCode = "daily") -> pd.DataFrame:
    if frequency != "daily":
        raise HTTPException(status_code=422, detail="Only daily frequency is supported")
    range_str = _period_to_range(period)
    fetcher = await get_unified_fetcher()
    series_map: dict[str, pd.Series] = {}
    for symbol in symbols:
        raw = await fetcher.fetch_history(symbol, range_str=range_str, interval="1d")
        frame = _parse_yahoo_chart(raw if isinstance(raw, dict) else {})
        if frame.empty:
            continue
        returns = _returns_from_close(frame)
        if returns.empty:
            continue
        series_map[symbol] = returns
    if len(series_map) < 2:
        return pd.DataFrame()
    df = pd.DataFrame(series_map).dropna(how="any")
    if len(df) < 2:
        return pd.DataFrame()
    return df


def _label_regime(value: float) -> str:
    if value > 0.6:
        return "high"
    if value < 0.3:
        return "low"
    return "medium"


def _to_iso_date(value: Any) -> str:
    if isinstance(value, pd.Timestamp):
        ts = value
    else:
        ts = pd.Timestamp(value)
    if ts.tzinfo is not None:
        ts = ts.tz_convert(timezone.utc).tz_localize(None)
    return ts.strftime("%Y-%m-%d")


def _build_regimes(series: pd.Series) -> list[dict[str, Any]]:
    if series.empty:
        return []
    regimes: list[dict[str, Any]] = []
    current_label: str | None = None
    current_values: list[float] = []
    start_idx: Any = None
    prev_idx: Any = None
    for idx, raw_value in series.items():
        value = float(raw_value)
        label = _label_regime(value)
        if current_label is None:
            current_label = label
            current_values = [value]
            start_idx = idx
            prev_idx = idx
            continue
        if label == current_label:
            current_values.append(value)
            prev_idx = idx
            continue
        regimes.append(
            {
                "start": _to_iso_date(start_idx),
                "end": _to_iso_date(prev_idx),
                "avg_correlation": round(sum(current_values) / len(current_values), 4),
                "label": current_label,
            }
        )
        current_label = label
        current_values = [value]
        start_idx = idx
        prev_idx = idx
    if current_label is not None and start_idx is not None and prev_idx is not None:
        regimes.append(
            {
                "start": _to_iso_date(start_idx),
                "end": _to_iso_date(prev_idx),
                "avg_correlation": round(sum(current_values) / len(current_values), 4),
                "label": current_label,
            }
        )
    return regimes


def _matrix_payload(symbols: list[str], corr: pd.DataFrame, returns_df: pd.DataFrame) -> dict[str, Any]:
    matrix = [
        [round(float(corr.loc[row_symbol, col_symbol]), 4) for col_symbol in symbols]
        for row_symbol in symbols
    ]
    return {
        "symbols": symbols,
        "matrix": matrix,
        "period_start": _to_iso_date(returns_df.index.min()),
        "period_end": _to_iso_date(returns_df.index.max()),
    }


def _distance_between(symbols_a: tuple[str, ...], symbols_b: tuple[str, ...], corr: pd.DataFrame) -> float:
    distances: list[float] = []
    for left in symbols_a:
        for right in symbols_b:
            corr_value = float(corr.loc[left, right])
            if isnan(corr_value):
                corr_value = 0.0
            distances.append(1.0 - corr_value)
    return sum(distances) / len(distances) if distances else 1.0


def _hierarchical_tree(symbols: list[str], corr: pd.DataFrame) -> ClusterNode:
    nodes = [ClusterNode(symbols=(symbol,), distance=0.0) for symbol in symbols]
    while len(nodes) > 1:
        best_pair: tuple[int, int] | None = None
        best_distance = float("inf")
        for i in range(len(nodes)):
            for j in range(i + 1, len(nodes)):
                distance = _distance_between(nodes[i].symbols, nodes[j].symbols, corr)
                if distance < best_distance:
                    best_distance = distance
                    best_pair = (i, j)
        if best_pair is None:
            break
        i, j = best_pair
        left = nodes[i]
        right = nodes[j]
        merged = ClusterNode(
            symbols=tuple(sorted(left.symbols + right.symbols)),
            distance=round(best_distance, 4),
            left=left,
            right=right,
        )
        nodes = [node for index, node in enumerate(nodes) if index not in {i, j}]
        nodes.append(merged)
    return nodes[0]


def _node_to_payload(node: ClusterNode) -> dict[str, Any]:
    if node.left is None or node.right is None:
        return {"name": node.symbols[0], "distance": round(node.distance, 4), "children": []}
    return {
        "distance": round(node.distance, 4),
        "children": [_node_to_payload(node.left), _node_to_payload(node.right)],
    }


def _cut_clusters(root: ClusterNode, n_clusters: int) -> list[ClusterNode]:
    clusters = [root]
    while len(clusters) < n_clusters:
        splittable = [node for node in clusters if node.left is not None and node.right is not None]
        if not splittable:
            break
        target = max(splittable, key=lambda node: node.distance)
        clusters.remove(target)
        if target.left is not None:
            clusters.append(target.left)
        if target.right is not None:
            clusters.append(target.right)
    return sorted(clusters, key=lambda node: node.symbols)


def _avg_intra_correlation(symbols: tuple[str, ...], corr: pd.DataFrame) -> float:
    if len(symbols) == 1:
        return 1.0
    values: list[float] = []
    for left, right in combinations(symbols, 2):
        values.append(float(corr.loc[left, right]))
    return round(sum(values) / len(values), 4) if values else 1.0


@router.post("/matrix")
async def correlation_matrix(
    payload: CorrelationMatrixRequest,
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    symbols = _normalize_symbols(payload.symbols)
    if len(symbols) < 2:
        raise HTTPException(status_code=400, detail="At least two symbols are required")

    cache_key = cache_instance.build_key(
        "correlation_matrix",
        "_".join(symbols),
        {"period": payload.period, "frequency": payload.frequency},
    )
    cached = await cache_instance.get(cache_key)
    if isinstance(cached, dict):
        return cached

    returns_df = await _load_returns_frame(symbols, payload.period, payload.frequency)
    if returns_df.empty:
        raise HTTPException(status_code=404, detail="No overlapping return series available")

    ordered_symbols = [symbol for symbol in symbols if symbol in returns_df.columns]
    corr = returns_df[ordered_symbols].corr(method="pearson").fillna(0.0)
    data = _matrix_payload(ordered_symbols, corr, returns_df[ordered_symbols])
    await cache_instance.set(cache_key, data, ttl=_MATRIX_TTL_SECONDS)
    return data


@router.post("/rolling")
async def correlation_rolling(
    payload: CorrelationRollingRequest,
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    symbols = _normalize_symbols([payload.symbol1, payload.symbol2])
    if len(symbols) != 2:
        raise HTTPException(status_code=400, detail="Two distinct symbols are required")

    returns_df = await _load_returns_frame(symbols, payload.period, "daily")
    if returns_df.empty or len(returns_df) < payload.window:
        raise HTTPException(status_code=404, detail="Not enough overlapping data for rolling correlation")

    series = (
        returns_df[symbols[0]]
        .rolling(payload.window)
        .corr(returns_df[symbols[1]])
        .dropna()
    )
    if series.empty:
        raise HTTPException(status_code=404, detail="Rolling correlation series is empty")

    payload_series = [
        {"date": _to_iso_date(idx), "correlation": round(float(value), 4)}
        for idx, value in series.items()
    ]
    return {
        "series": payload_series,
        "current": round(float(series.iloc[-1]), 4),
        "avg": round(float(series.mean()), 4),
        "min": round(float(series.min()), 4),
        "max": round(float(series.max()), 4),
        "regimes": _build_regimes(series),
    }


@router.post("/clusters")
async def correlation_clusters(
    payload: CorrelationClustersRequest,
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    symbols = _normalize_symbols(payload.symbols)
    if len(symbols) < 2:
        raise HTTPException(status_code=400, detail="At least two symbols are required")

    returns_df = await _load_returns_frame(symbols, payload.period, "daily")
    if returns_df.empty:
        raise HTTPException(status_code=404, detail="No overlapping return series available")

    ordered_symbols = [symbol for symbol in symbols if symbol in returns_df.columns]
    corr = returns_df[ordered_symbols].corr(method="pearson").fillna(0.0)
    root = _hierarchical_tree(ordered_symbols, corr)
    assignments = _cut_clusters(root, min(payload.n_clusters, len(ordered_symbols)))
    clusters = [
        {
            "cluster_id": idx + 1,
            "symbols": list(node.symbols),
            "avg_intra_correlation": _avg_intra_correlation(node.symbols, corr),
        }
        for idx, node in enumerate(assignments)
    ]
    return {
        "clusters": clusters,
        "dendrogram": _node_to_payload(root),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
