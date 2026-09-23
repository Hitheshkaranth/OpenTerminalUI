"""Cross-sectional analytics tools for the agent: correlation, pair trading, factor
attribution, and execution-quality (TCA).

Handlers call the existing engine functions (``backend.core.statlab.cointegration``,
``backend.risk_engine.factor_attribution``, ``backend.tca.service``) directly rather than
re-deriving statistics. Not user-scoped — every tool here operates on symbols the caller
supplies (or, for factor analysis, the shared holdings table) rather than a specific user's
account.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from backend.agent.tools.envelope import cap, err, ok
from backend.agent.tools.registry import ToolSpec
from backend.api.deps import get_unified_fetcher
from backend.api.routes.chart import _parse_yahoo_chart
from backend.api.routes.correlation import _load_returns_frame as _corr_returns_frame
from backend.api.routes.correlation import _normalize_symbols
from backend.core.statlab.cointegration import cointegration_analysis
from backend.risk_engine.factor_attribution import FactorAttributionEngine
from backend.shared.db import SessionLocal
from backend.tca.service import generate_tca_report

_MAX_CORR_TICKERS = 15
_HIGH_CORR_THRESHOLD = 0.8
_MIN_PAIR_ROWS = 30
_MIN_FACTOR_UNIVERSE = 5

_PAIR_PERIOD_TO_RANGE: dict[str, str] = {
    "1M": "1mo", "3M": "3mo", "6M": "6mo", "1Y": "1y", "2Y": "2y", "3Y": "3y", "5Y": "5y",
}
_FACTOR_PERIOD_TO_RANGE: dict[str, str] = {"3M": "3mo", "6M": "6mo", "1Y": "1y", "3Y": "3y"}


# ---------------------------------------------------------------------------
# get_correlation_matrix
# ---------------------------------------------------------------------------

async def get_correlation_matrix(args: dict[str, Any]) -> dict[str, Any]:
    try:
        raw = args.get("tickers") or []
        symbols = _normalize_symbols([str(t) for t in raw])
        if len(symbols) < 2:
            return err("Need at least two distinct tickers to compute a correlation matrix.", code="bad_request")
        if len(symbols) > _MAX_CORR_TICKERS:
            return err(
                f"{len(symbols)} tickers requested; cap is {_MAX_CORR_TICKERS} to keep the matrix "
                "and the response compact.",
                code="too_many_tickers",
            )

        period = str(args.get("period") or "1Y").upper()
        try:
            returns_df = await _corr_returns_frame(symbols, period, "daily")
        except Exception as exc:
            return err(f"Could not load return history: {exc}", code="bad_request", hint="period must be one of 1M, 3M, 6M, 1Y, 3Y.")

        if returns_df.empty:
            return err("No overlapping daily return history for the requested tickers.", code="insufficient_history")

        ordered = [s for s in symbols if s in returns_df.columns]
        dropped = [s for s in symbols if s not in returns_df.columns]
        corr = returns_df[ordered].corr(method="pearson").fillna(0.0)
        matrix = [[round(float(corr.loc[r, c]), 4) for c in ordered] for r in ordered]

        high_pairs = []
        for i, a in enumerate(ordered):
            for b in ordered[i + 1:]:
                v = float(corr.loc[a, b])
                if abs(v) >= _HIGH_CORR_THRESHOLD:
                    high_pairs.append({"pair": [a, b], "correlation": round(v, 4)})
        high_pairs.sort(key=lambda r: abs(r["correlation"]), reverse=True)

        data = {
            "symbols": ordered,
            "dropped": dropped,
            "period": period,
            "period_start": str(returns_df.index.min().date()),
            "period_end": str(returns_df.index.max().date()),
            "matrix": matrix,
            "high_correlation_pairs": cap(high_pairs, 25)[0],
            "high_correlation_threshold": _HIGH_CORR_THRESHOLD,
        }
        return ok(data, source="correlation_engine", as_of=str(returns_df.index.max().date()))
    except Exception as exc:  # noqa: BLE001 - agent tools must never raise
        return err(f"get_correlation_matrix failed: {exc}", code="tool_error")


# ---------------------------------------------------------------------------
# analyze_pair_trade
# ---------------------------------------------------------------------------

async def analyze_pair_trade(args: dict[str, Any]) -> dict[str, Any]:
    try:
        a = str(args.get("ticker_a") or "").strip().upper()
        b = str(args.get("ticker_b") or "").strip().upper()
        if not a or not b or a == b:
            return err("ticker_a and ticker_b must be two distinct, non-empty tickers.", code="bad_request")

        period = str(args.get("period") or "2Y").upper()
        range_str = _PAIR_PERIOD_TO_RANGE.get(period)
        if range_str is None:
            return err(
                f"Unsupported period '{period}'.", code="bad_period",
                hint=f"Use one of {', '.join(_PAIR_PERIOD_TO_RANGE)}.",
            )

        fetcher = await get_unified_fetcher()
        series: dict[str, pd.Series] = {}
        for sym in (a, b):
            try:
                raw = await fetcher.fetch_history(sym, range_str=range_str, interval="1d")
            except Exception:
                continue
            frame = _parse_yahoo_chart(raw if isinstance(raw, dict) else {})
            if not frame.empty and "Close" in frame:
                series[sym] = frame["Close"].rename(sym)

        missing = [s for s in (a, b) if s not in series]
        if missing:
            return err(f"No price history for {', '.join(missing)}.", code="no_price_history")

        df = pd.concat([series[a], series[b]], axis=1).dropna()
        if len(df) < _MIN_PAIR_ROWS:
            return err(
                f"Only {len(df)} overlapping trading day(s) between {a} and {b}; need at least {_MIN_PAIR_ROWS}.",
                code="insufficient_history",
            )

        try:
            result = cointegration_analysis(df[a], df[b], entry_z=2.0, exit_z=0.5)
        except ValueError as exc:
            return err(str(exc), code="analysis_failed")

        kept, dropped_n = cap(result.get("series") or [], 60)
        result["series"] = kept
        result["period"] = period

        return ok(result, source="statlab_cointegration", as_of=str(df.index[-1].date()), truncated=dropped_n)
    except Exception as exc:  # noqa: BLE001
        return err(f"analyze_pair_trade failed: {exc}", code="tool_error")


# ---------------------------------------------------------------------------
# run_factor_analysis
# ---------------------------------------------------------------------------

async def _load_universe(tickers: list[str], period: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]] | dict[str, Any]:
    """Build equal-weighted (holdings, universe_data) for FactorAttributionEngine from tickers."""
    range_str = _FACTOR_PERIOD_TO_RANGE.get(period, "1y")
    fetcher = await get_unified_fetcher()
    returns_map: dict[str, pd.Series] = {}
    snapshots: dict[str, dict[str, Any]] = {}
    for sym in tickers:
        try:
            raw = await fetcher.fetch_history(sym, range_str=range_str, interval="1d")
        except Exception:
            continue
        frame = _parse_yahoo_chart(raw if isinstance(raw, dict) else {})
        if frame.empty or "Close" not in frame:
            continue
        ret = frame["Close"].pct_change().dropna()
        if ret.empty:
            continue
        returns_map[sym] = ret
        try:
            snap = await fetcher.fetch_stock_snapshot(sym)
            snapshots[sym] = snap if isinstance(snap, dict) else {}
        except Exception:
            snapshots[sym] = {}

    if len(returns_map) < _MIN_FACTOR_UNIVERSE:
        return err(
            f"Only {len(returns_map)} of {len(tickers)} tickers had usable price history; factor "
            f"analysis needs at least {_MIN_FACTOR_UNIVERSE} names to form quintile factor spreads.",
            code="insufficient_universe",
        )

    returns_df = pd.DataFrame(returns_map).dropna(how="any")
    if returns_df.empty:
        return err("No overlapping return history across the requested tickers.", code="insufficient_history")

    dates = [idx.strftime("%Y-%m-%d") for idx in returns_df.index]
    n = len(returns_df.columns)
    universe_data: list[dict[str, Any]] = []
    holdings: list[dict[str, Any]] = []
    for sym in returns_df.columns:
        snap = snapshots.get(sym, {})
        series = returns_df[sym]

        def _num(key: str, default: float) -> float:
            val = snap.get(key)
            return float(val) if isinstance(val, (int, float)) else default

        universe_data.append({
            "symbol": sym,
            "dates": dates,
            "returns": [float(v) for v in series.to_list()],
            "market_cap": _num("market_cap", 0.0),
            "pb_ratio": _num("pb_ratio", 0.0),
            "roe": _num("roe_pct", 0.0),
            "beta": _num("beta", 1.0),
            "momentum_12m": float(series.sum()),
        })
        holdings.append({"symbol": sym, "weight": 1.0 / n})
    return holdings, universe_data


async def run_factor_analysis(args: dict[str, Any]) -> dict[str, Any]:
    try:
        tickers = list(dict.fromkeys(str(t).strip().upper() for t in (args.get("tickers") or []) if str(t).strip()))
        period = str(args.get("period") or "1Y").upper()

        if tickers:
            scope = "tickers"
        else:
            from backend.models import Holding  # local import: only needed for the portfolio fallback path

            db = SessionLocal()
            try:
                rows = db.query(Holding).all()
            finally:
                db.close()
            if not rows:
                return err(
                    "No holdings available and no tickers were provided.",
                    code="empty_portfolio",
                    hint="Pass a tickers list, or add holdings first.",
                )
            tickers = sorted({str(r.ticker).strip().upper() for r in rows if str(r.ticker).strip()})
            scope = "portfolio"

        loaded = await _load_universe(tickers, period)
        if isinstance(loaded, dict):
            return loaded
        holdings, universe_data = loaded

        engine = FactorAttributionEngine()  # fresh instance: engine keeps mutable "_last_*" state
        factor_returns = engine.compute_factor_returns(universe_data)
        exposures = engine.compute_factor_exposures(holdings, universe_data)
        attribution = engine.attribute_returns(holdings, factor_returns, period)

        requested = args.get("factors")
        if requested:
            wanted = {str(f).strip().lower() for f in requested}
            unknown = wanted - set(exposures)
            exposures = {k: v for k, v in exposures.items() if k in wanted}
            if unknown:
                attribution = dict(attribution)
                attribution["note"] = f"Unknown factor(s) ignored: {', '.join(sorted(unknown))}. Available: {', '.join(FactorAttributionEngine.FACTORS)}."

        data = {
            "scope": scope,
            "period": period,
            "universe": [u["symbol"] for u in universe_data],
            "factor_loadings": exposures,
            "attribution": attribution,
        }
        return ok(data, source="factor_attribution_engine", as_of=universe_data[-1]["dates"][-1] if universe_data else None)
    except Exception as exc:  # noqa: BLE001
        return err(f"run_factor_analysis failed: {exc}", code="tool_error")


# ---------------------------------------------------------------------------
# analyze_execution_quality
# ---------------------------------------------------------------------------

def analyze_execution_quality(args: dict[str, Any]) -> dict[str, Any]:
    try:
        symbol = args.get("symbol")
        window = str(args.get("period") or "1d").strip().lower()

        try:
            report = generate_tca_report(window)
        except Exception as exc:
            return err(f"TCA report generation failed: {exc}", code="tca_error")

        trades = [t.model_dump() for t in report.per_trade_stats]
        kept, dropped_n = cap(trades, 25)

        data = {
            "window": window,
            "per_trade_stats": kept,
            "aggregates": report.aggregates.model_dump(),
            "symbol_note": (
                f"TCA has no per-symbol breakdown today; returning the aggregate window report "
                f"instead of one filtered to {symbol}."
            ) if symbol else None,
        }
        return ok(
            data,
            source="tca_service",
            quality="synthetic",
            note=(
                "backend.tca.service.generate_tca_report is a deterministic hash-seeded mock — no "
                "real order/execution data is wired in yet. Treat these slippage/fee figures as "
                "illustrative, not measured."
            ),
            truncated=dropped_n,
        )
    except Exception as exc:  # noqa: BLE001
        return err(f"analyze_execution_quality failed: {exc}", code="tool_error")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def analytics_tool_specs() -> list[ToolSpec]:
    """Return the four read-only, non-user-scoped analytics tool specs."""
    return [
        ToolSpec(
            name="get_correlation_matrix",
            description="Compute the pairwise Pearson correlation matrix of daily returns for 2-15 "
            "tickers over a lookback period, flagging pairs at or above |0.8| correlation. Returns "
            "err() if fewer than two tickers overlap in price history, or if more than 15 tickers "
            "are requested.",
            parameters={
                "type": "object",
                "properties": {
                    "tickers": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 15},
                    "period": {"type": "string", "enum": ["1M", "3M", "6M", "1Y", "3Y"], "default": "1Y"},
                },
                "required": ["tickers"],
            },
            handler=get_correlation_matrix,
            read_only=True,
            write_class="none",
        ),
        ToolSpec(
            name="analyze_pair_trade",
            description="Run an Engle-Granger cointegration test on two tickers: hedge ratio, ADF "
            "cointegration p-value, mean-reversion half-life, current spread z-score, correlation, "
            "and the current trading signal (LONG_SPREAD/SHORT_SPREAD/FLAT/HOLD). Returns err() if "
            "either symbol has no price history or fewer than 30 overlapping trading days.",
            parameters={
                "type": "object",
                "properties": {
                    "ticker_a": {"type": "string"},
                    "ticker_b": {"type": "string"},
                    "period": {"type": "string", "enum": ["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y"], "default": "2Y"},
                },
                "required": ["ticker_a", "ticker_b"],
            },
            handler=analyze_pair_trade,
            read_only=True,
            write_class="none",
        ),
        ToolSpec(
            name="run_factor_analysis",
            description="Decompose returns into Fama-French-style factor exposures (market, size, "
            "value, momentum, quality, low_vol) and attribution (factor contributions + alpha) for "
            "either an explicit tickers list or, if omitted, the shared holdings table. Optionally "
            "filter to specific factors. Needs at least 5 names with usable price history to form "
            "quintile spreads; returns err() otherwise.",
            parameters={
                "type": "object",
                "properties": {
                    "tickers": {"type": "array", "items": {"type": "string"}},
                    "portfolio_id": {"type": "string", "description": "Accepted for compatibility; the underlying holdings table is not per-portfolio."},
                    "factors": {"type": "array", "items": {"type": "string"}, "description": "Subset of market, size, value, momentum, quality, low_vol."},
                    "period": {"type": "string", "enum": ["3M", "6M", "1Y", "3Y"], "default": "1Y"},
                },
            },
            handler=run_factor_analysis,
            read_only=True,
            write_class="none",
        ),
        ToolSpec(
            name="analyze_execution_quality",
            description="Transaction cost analysis (TCA): per-trade expected vs. realized slippage "
            "and aggregate slippage/fees for a time window. NOTE: the backing service "
            "(backend.tca.service) is a deterministic synthetic mock, not measured execution data — "
            "results always carry quality=synthetic. symbol is accepted but not yet used to filter "
            "(no per-symbol TCA data exists).",
            parameters={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Optional; not yet used to filter results."},
                    "period": {"type": "string", "default": "1d", "description": "Time window, e.g. 1d, 1w, 1m."},
                },
            },
            handler=analyze_execution_quality,
            read_only=True,
            write_class="none",
        ),
    ]
