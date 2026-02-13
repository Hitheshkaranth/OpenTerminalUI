from __future__ import annotations

import pandas as pd


DEFAULT_PEER_METRICS = [
    "pe",
    "pb_calc",
    "ps_calc",
    "ev_ebitda",
    "roe_pct",
    "roa_pct",
    "op_margin_pct",
    "net_margin_pct",
    "rev_growth_pct",
    "eps_growth_pct",
]


def build_peer_comparison(df: pd.DataFrame, ticker: str, metrics: list[str] | None = None) -> pd.DataFrame:
    if df.empty:
        return df
    metrics = metrics or DEFAULT_PEER_METRICS
    subset_cols = ["ticker", "sector", "industry"] + [m for m in metrics if m in df.columns]
    local = df[subset_cols].copy()
    ticker = ticker.upper()
    target = local[local["ticker"] == ticker]
    if target.empty:
        return pd.DataFrame()

    sector = target["sector"].iloc[0]
    industry = target["industry"].iloc[0]
    peers = local.copy()
    if pd.notna(industry):
        peers = peers[peers["industry"] == industry]
    elif pd.notna(sector):
        peers = peers[peers["sector"] == sector]
    if peers.empty:
        peers = local

    rows: list[dict] = []
    for m in [x for x in metrics if x in peers.columns]:
        series = pd.to_numeric(peers[m], errors="coerce")
        target_val = pd.to_numeric(target[m], errors="coerce").iloc[0]
        if pd.isna(target_val):
            continue
        rows.append(
            {
                "metric": m,
                "target_value": float(target_val),
                "peer_median": float(series.median()) if series.notna().any() else None,
                "peer_mean": float(series.mean()) if series.notna().any() else None,
                "target_percentile": float((series <= target_val).mean() * 100) if series.notna().any() else None,
            }
        )
    return pd.DataFrame(rows)

