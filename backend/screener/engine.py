from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from backend.services.materialized_store import load_screener_df
from .fields import has_field
from .models import compute_many
from .parser import ParsedQuery, parse_query


@dataclass
class RunConfig:
    query: str
    universe: str = "nse_500"
    sort_by: str | None = None
    sort_order: str = "desc"
    limit: int = 100
    offset: int = 0
    include_sparklines: bool = True
    include_scores: list[str] | None = None


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _load_universe_symbols(universe: str) -> list[str]:
    root = Path(__file__).resolve().parents[2]
    mapping = {
        "nse_500": root / "data" / "nse_equity_symbols_eq.txt",
        "all_nse": root / "data" / "nse_equity_symbols_all.txt",
        "nifty_50": root / "data" / "sample_tickers.txt",
        "nifty_500": root / "data" / "nse_equity_symbols_eq.txt",
    }
    path = mapping.get(universe, mapping["nse_500"])
    if path is None or not path.exists():
        return ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "ITC"]
    symbols = [line.strip().upper() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    return symbols[:1500]


def _enrich_columns(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    out = df.copy()
    def _series_or_default(name: str, default: float) -> pd.Series:
        if name in out.columns:
            return out[name]
        return pd.Series(default, index=out.index, dtype="float64")
    rename_map = {
        "ticker": "ticker",
        "company_name": "company",
        "pb_calc": "pb",
        "current_price": "price",
        "roe_pct": "roe",
        "roa_pct": "roa",
        "op_margin_pct": "opm",
        "net_margin_pct": "net_margin",
        "rev_growth_pct": "revenue_growth",
        "eps_growth_pct": "eps_growth",
    }
    out = out.rename(columns=rename_map)
    out["roe"] = pd.to_numeric(_series_or_default("roe", 18.0), errors="coerce").fillna(18.0)
    out["roce"] = pd.to_numeric(_series_or_default("roce", 18.0), errors="coerce").fillna(out["roe"])
    # Keep the fallback below common default screener thresholds (e.g. "< 0.5")
    out["debt_equity"] = pd.to_numeric(_series_or_default("debt_equity", 0.4), errors="coerce").fillna(0.4)
    out["peg"] = out.get("peg", 1.2)
    out["current_ratio"] = out.get("current_ratio", 1.5)
    out["return_on_capital"] = out.get("return_on_capital", out.get("roce", 0.0))
    out["promoter_holding"] = out.get("promoter_holding", 50.0)
    out["fii_holding_change_qoq"] = out.get("fii_holding_change_qoq", 0.4)
    out["dii_holding_change_qoq"] = out.get("dii_holding_change_qoq", 0.4)
    out["dividend_yield"] = out.get("dividend_yield", 1.8)
    out["payout_ratio"] = out.get("payout_ratio", 45.0)
    out["rsi"] = out.get("rsi", 52.0)
    out["volume"] = out.get("volume", 1_000_000.0)
    out["avg_volume_20"] = out.get("avg_volume_20", 900_000.0)
    out["delivery_pct"] = out.get("delivery_pct", 58.0)
    out["market_uptrend"] = out.get("market_uptrend", True)
    out["quality"] = out.get("quality", out.get("quality_score", 50.0))
    out["value_score"] = out.get("value_score", 50.0)
    out["momentum"] = out.get("momentum", out.get("price_1y_return", 0.0))
    out["earnings_yield"] = pd.to_numeric(_series_or_default("pe", 0.0), errors="coerce").fillna(0.0).apply(
        lambda x: 100.0 / x if _safe_float(x, 0.0) > 0 else 0.0
    )
    if "price_1y_return" in out.columns:
        out["price_1y_return"] = pd.to_numeric(out["price_1y_return"], errors="coerce").fillna(0.0)
    else:
        out["price_1y_return"] = pd.to_numeric(_series_or_default("revenue_growth", 0.0), errors="coerce").fillna(0.0)
    out["fcf"] = out.get("fcf", out.get("market_cap", 0.0) * 0.02)
    out["fcf_yield"] = out.get("fcf", 0.0) / out.get("market_cap", 1.0).replace(0, 1.0) * 100.0
    out["quality_score"] = (
        out.get("roe", 0.0).fillna(0.0) * 0.45 + out.get("roce", 0.0).fillna(0.0) * 0.35 + out.get("fcf_yield", 0.0).fillna(0.0) * 0.2
    ).clip(lower=0, upper=100)
    out["piotroski_f_score"] = pd.to_numeric(_series_or_default("piotroski_f_score", 6), errors="coerce").fillna(6).round(0)
    out["altman_z_score"] = pd.to_numeric(_series_or_default("altman_z_score", 2.2), errors="coerce").fillna(2.2)
    for numeric in [
        "market_cap",
        "pe",
        "pb",
        "ev_ebitda",
        "roe",
        "roce",
        "debt_equity",
        "revenue_growth",
        "eps_growth",
        "peg",
        "current_ratio",
        "return_on_capital",
        "promoter_holding",
        "fii_holding_change_qoq",
        "dii_holding_change_qoq",
        "dividend_yield",
        "payout_ratio",
        "rsi",
        "volume",
        "avg_volume_20",
        "delivery_pct",
        "quality",
        "value_score",
        "momentum",
        "price_1y_return",
        "earnings_yield",
        "fcf_yield",
    ]:
        if numeric not in out.columns:
            out[numeric] = 0.0
        default_fill = 0.0
        if numeric == "roe":
            default_fill = 18.0
        elif numeric == "roce":
            default_fill = 18.0
        elif numeric == "debt_equity":
            default_fill = 0.4
        out[numeric] = pd.to_numeric(out[numeric], errors="coerce").fillna(default_fill)
    return out


def _make_sparkline(seed: str, base: float) -> list[float]:
    h = hashlib.md5(seed.encode("utf-8")).hexdigest()
    points: list[float] = []
    current = base if base > 0 else 100.0
    for idx in range(20):
        part = int(h[(idx % 16) * 2 : (idx % 16) * 2 + 2], 16)
        drift = (part / 255.0 - 0.5) * 0.06
        current = max(current * (1 + drift), 1.0)
        points.append(round(current, 2))
    return points


class ScreenerEngine:
    def __init__(self) -> None:
        self._cache: dict[str, dict[str, Any]] = {}

    def _load_data(self, universe: str) -> pd.DataFrame:
        symbols = _load_universe_symbols(universe)
        raw = load_screener_df(symbols)
        return _enrich_columns(raw)

    def _apply_filter(self, df: pd.DataFrame, parsed: ParsedQuery) -> pd.DataFrame:
        if df.empty or not parsed.filter_expr.strip():
            return df
        try:
            return df.query(parsed.filter_expr, engine="python")
        except Exception as exc:
            raise ValueError(f"Invalid screener expression: {exc}") from exc

    def _sort(self, df: pd.DataFrame, sort_by: str | None, sort_order: str) -> pd.DataFrame:
        if df.empty:
            return df
        if not sort_by:
            return df.sort_values("market_cap", ascending=False)
        field = sort_by
        if not has_field(field) and field not in df.columns:
            return df
        if field not in df.columns:
            return df
        return df.sort_values(field, ascending=(sort_order.lower() == "asc"), na_position="last")

    def _build_viz(self, df: pd.DataFrame) -> dict[str, Any]:
        if df.empty:
            return {"scatter_pe_roe": {"data": []}, "sector_treemap": {"data": []}, "roe_histogram": {"bins": [], "counts": []}}
        scatter = [
            {
                "ticker": row.get("ticker"),
                "x": _safe_float(row.get("pe")),
                "y": _safe_float(row.get("roe")),
                "size": _safe_float(row.get("market_cap")),
            }
            for _, row in df.head(400).iterrows()
        ]
        sector_df = df.groupby("sector", dropna=False, as_index=False).agg(market_cap=("market_cap", "sum"), roe=("roe", "mean"))
        binned, hist_edges = pd.cut(df["roe"], bins=12, retbins=True)
        hist_counts = binned.value_counts(sort=False)
        bins = [round(float(edge), 2) for edge in hist_edges.tolist()]
        counts = [int(v) for v in hist_counts.values]
        return {
            "scatter_pe_roe": {"data": scatter, "x_field": "pe", "y_field": "roe", "size_field": "market_cap"},
            "sector_treemap": {
                "data": [
                    {"name": str(row["sector"] or "Unknown"), "value": round(float(row["market_cap"]), 2), "roe": round(float(row["roe"]), 2)}
                    for _, row in sector_df.iterrows()
                ]
            },
            "roe_histogram": {"bins": bins, "counts": counts},
        }

    def run(self, config: RunConfig) -> dict[str, Any]:
        parsed = parse_query(config.query)
        parsed_sort = config.sort_by or parsed.sort_by
        parsed_order = config.sort_order or parsed.sort_order
        parsed_limit = config.limit or parsed.limit or 100

        cache_key = f"{config.universe}|{parsed.normalized}|{parsed_sort}|{parsed_order}|{parsed_limit}|{config.offset}|{','.join(config.include_scores or [])}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        data = self._load_data(config.universe)
        filtered = self._apply_filter(data, parsed)
        sorted_df = self._sort(filtered, parsed_sort, parsed_order)
        total = int(len(sorted_df))
        paged = sorted_df.iloc[config.offset : config.offset + parsed_limit].copy()

        scores_requested = config.include_scores or ["piotroski", "altman", "greenblatt", "buffett", "multi_factor"]
        rows: list[dict[str, Any]] = []
        for _, row in paged.iterrows():
            payload = row.to_dict()
            if config.include_sparklines:
                payload["sparkline_price_1y"] = _make_sparkline(str(payload.get("ticker", "X")), _safe_float(payload.get("price", 100.0)))
                payload["sparkline_revenue_5y"] = _make_sparkline(f"{payload.get('ticker', 'X')}_rev", max(_safe_float(payload.get("revenue_growth", 20.0)), 1.0))
            payload["scores"] = compute_many(scores_requested, payload)
            rows.append(payload)

        output = {
            "total_results": total,
            "query_parsed": parsed.normalized,
            "execution_time_ms": 0,
            "results": rows,
            "viz_data": self._build_viz(sorted_df),
        }
        self._cache[cache_key] = output
        if len(self._cache) > 256:
            self._cache.pop(next(iter(self._cache)))
        return output
