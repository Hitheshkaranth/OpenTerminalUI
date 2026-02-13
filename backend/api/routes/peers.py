from __future__ import annotations

import asyncio
from typing import Any, List

import pandas as pd
from fastapi import APIRouter

from backend.api.deps import fetch_stock_snapshot_coalesced, get_unified_fetcher
from backend.core.models import PeerResponse, PeerMetric

router = APIRouter()


def _to_float(value: Any) -> float | None:
    if value in (None, "", "NA", "N/A", "-"):
        return None
    try:
        out = float(value)
        if out != out:
            return None
        return out
    except (TypeError, ValueError):
        return None


def _calc_metric(snaps: list[dict], target_snap: dict, key: str, label: str) -> PeerMetric | None:
    vals = [float(s[key]) for s in snaps if _to_float(s.get(key)) is not None]
    target_val = _to_float(target_snap.get(key))
    if not vals or target_val is None:
        return None
    series = pd.Series(vals)
    median = float(series.median())
    mean = float(series.mean())
    percentile = float((series < target_val).sum() / len(series) * 100.0) if len(series) > 0 else None
    return PeerMetric(
        metric=label,
        target_value=target_val,
        peer_median=median,
        peer_mean=mean,
        target_percentile=percentile,
    )


@router.get("/peers/{ticker}", response_model=PeerResponse)
async def get_peers(ticker: str) -> PeerResponse:
    symbol = ticker.strip().upper()
    unified = await get_unified_fetcher()

    try:
        peers_raw = await unified.fmp.get_peers(symbol)
        peers = []
        if isinstance(peers_raw, list):
            for p in peers_raw:
                if isinstance(p, str):
                    peers.append(p.split(".")[0].strip().upper())
                elif isinstance(p, dict):
                    sym = p.get("symbol") or p.get("ticker") or ""
                    if sym:
                        peers.append(str(sym).split(".")[0].strip().upper())
    except Exception:
        peers = []

    subset = peers[:10]
    all_symbols = subset + [symbol]
    results = await asyncio.gather(
        *(fetch_stock_snapshot_coalesced(s) for s in all_symbols),
        return_exceptions=True,
    )

    valid_snaps = [r for r in results if isinstance(r, dict)]
    target_snap = results[-1] if isinstance(results[-1], dict) else {}

    metrics: list[PeerMetric] = []
    for key, label in [("pe", "PE"), ("market_cap", "Market Cap"), ("beta", "Beta")]:
        m = _calc_metric(valid_snaps, target_snap, key, label)
        if m is not None:
            metrics.append(m)

    if not metrics:
        target_pe = _to_float(target_snap.get("pe"))
        metrics.append(PeerMetric(metric="PE", target_value=target_pe or 0.0, peer_median=None))

    return PeerResponse(
        ticker=symbol,
        universe="FMP Peers",
        metrics=metrics,
    )
