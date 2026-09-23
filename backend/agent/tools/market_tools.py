from __future__ import annotations

import asyncio
import math
import re
from datetime import datetime, timedelta
from typing import Any

import pandas as pd

from backend.agent.tools.registry import ToolRegistry, ToolSpec
from backend.api.deps import get_unified_fetcher
from backend.api.routes.chart import _parse_yahoo_chart
from backend.scanner_engine.detectors import DETECTOR_MAP
from backend.scanner_engine.indicators import compute_indicator_pack
from backend.scanner_engine.runner import ScannerRunner
from backend.scanner_engine.schemas import DetectorRule, LiquidityGate, ScanPresetBase
from backend.screener.engine import RunConfig, ScreenerEngine
from backend.screener.router import _hydrate_missing_universe_rows
from backend.core.single_asset_backtest import BacktestEngine, generate_sma_crossover_signals
from backend.core.backtesting_models import BacktestConfig
from backend.core.backtester import BacktestConfig as RotationConfig, backtest_momentum_rotation
from backend.core.backtest_robustness import multi_window_robustness, permutation_test

# Compact set of columns returned to the agent (the full screener row carries viz
# data, scores and sparklines that just bloat the LLM context).
_AGENT_SCREEN_FIELDS = (
    "ticker", "company", "sector", "industry", "price", "market_cap",
    "pe", "pb", "roe", "roce", "debt_equity", "revenue_growth", "dividend_yield",
    "composite_score", "quality", "value", "momentum",
)

_DETECTOR_DEFAULTS: dict[str, dict[str, Any]] = {
    "breakout_n_day_high": {"n": 20, "buffer_pct": 0.001, "rvol_threshold": 1.5, "near_trigger_pct": 0.02},
    "bb_squeeze_breakout": {"width_pct_threshold": 20, "lookback": 120, "require_keltner": False},
    "nr7_breakout": {},
    "inside_bar_breakout": {},
    "trend_retest": {"ema_tolerance_pct": 0.02, "rvol_threshold": 1.2},
    "supertrend_flip_ema_stack": {},
}


def _safe_float(value: Any) -> float | None:
    """Return a JSON-safe finite float, or None for missing indicator values."""
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _safe_mean(values: list[float]) -> float | None:
    finite = [value for value in values if math.isfinite(value)]
    if not finite:
        return None
    return sum(finite) / len(finite)


def _compact_screen_row(row: dict[str, Any]) -> dict[str, Any]:
    return {key: row.get(key) for key in _AGENT_SCREEN_FIELDS if key in row}


def _screen_candidate_reason(row: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    pe = _safe_float(row.get("pe"))
    roe = _safe_float(row.get("roe"))
    roce = _safe_float(row.get("roce"))
    debt_equity = _safe_float(row.get("debt_equity"))
    growth = _safe_float(row.get("revenue_growth"))
    dividend = _safe_float(row.get("dividend_yield"))
    if pe is not None:
        reasons.append(f"P/E {pe:.1f}")
    if roe is not None:
        reasons.append(f"ROE {roe:.1f}%")
    if roce is not None:
        reasons.append(f"ROCE {roce:.1f}%")
    if debt_equity is not None:
        reasons.append(f"Debt/equity {debt_equity:.2f}")
    if growth is not None:
        reasons.append(f"Revenue growth {growth:.1f}%")
    if dividend is not None and dividend > 0:
        reasons.append(f"Dividend yield {dividend:.1f}%")
    return reasons[:4]


def _screen_analysis(rows: list[dict[str, Any]], count: int) -> dict[str, Any]:
    sector_counts: dict[str, int] = {}
    pe_values: list[float] = []
    roe_values: list[float] = []
    roce_values: list[float] = []
    for row in rows:
        sector = str(row.get("sector") or "Unclassified")
        sector_counts[sector] = sector_counts.get(sector, 0) + 1
        pe = _safe_float(row.get("pe"))
        roe = _safe_float(row.get("roe"))
        roce = _safe_float(row.get("roce"))
        if pe is not None:
            pe_values.append(pe)
        if roe is not None:
            roe_values.append(roe)
        if roce is not None:
            roce_values.append(roce)

    top_sectors = sorted(sector_counts.items(), key=lambda item: item[1], reverse=True)[:5]
    return {
        "matched": count,
        "returned": len(rows),
        "top_sectors": [{"sector": sector, "count": amount} for sector, amount in top_sectors],
        "averages": {
            "pe": _safe_mean(pe_values),
            "roe": _safe_mean(roe_values),
            "roce": _safe_mean(roce_values),
        },
        "interpretation": (
            "Use these rows as candidates that passed the requested filter. "
            "Rank candidates by how many supplied metrics support the user's stated task; "
            "do not claim metrics that are missing from a row."
        ),
    }


_SCREENER_QUERY_ALIASES = (
    (re.compile(r"\bpe_ratio\b", re.IGNORECASE), "pe"),
    (re.compile(r"\bp/e\b", re.IGNORECASE), "pe"),
    (re.compile(r"\bprice_to_earnings\b", re.IGNORECASE), "pe"),
    (re.compile(r"\bpb_ratio\b", re.IGNORECASE), "pb"),
    (re.compile(r"\bprice_to_book\b", re.IGNORECASE), "pb"),
    (re.compile(r"\broe_pct\b", re.IGNORECASE), "roe"),
    (re.compile(r"\broce_pct\b", re.IGNORECASE), "roce"),
    (re.compile(r"\bdebt_to_equity\b", re.IGNORECASE), "debt_equity"),
    (re.compile(r"\bdebt_equity_ratio\b", re.IGNORECASE), "debt_equity"),
    (re.compile(r"\brevenue_growth_pct\b", re.IGNORECASE), "revenue_growth"),
    (re.compile(r"\bdividend_yield_pct\b", re.IGNORECASE), "dividend_yield"),
)


def _normalize_screener_query(query: str) -> str:
    normalized = query.strip()
    for pattern, replacement in _SCREENER_QUERY_ALIASES:
        normalized = pattern.sub(replacement, normalized)
    return normalized


def _technical_empty(ticker: str, note: str) -> dict[str, Any]:
    return {
        "ticker": ticker, "as_of": None, "price": None,
        "trend": {}, "momentum": {}, "volatility": {}, "volume": {},
        "distance_from_20d_high_pct": None, "active_setups": [], "note": note,
    }


def _downsample_rows(rows: list[dict[str, Any]], limit: int = 120) -> list[dict[str, Any]]:
    """Keep an evenly spaced, bounded series and always retain the final point."""
    if len(rows) <= limit:
        return rows
    step = math.ceil((len(rows) - 1) / (limit - 1))
    sampled = rows[::step]
    if sampled[-1] is not rows[-1]:
        sampled[-1] = rows[-1]
    return sampled[:limit]


def _backtest_symbol_empty(ticker: str, short_window: int, long_window: int, note: str) -> dict[str, Any]:
    return {
        "ticker": ticker, "strategy": "sma_crossover",
        "params": {"short_window": short_window, "long_window": long_window},
        "bars": 0, "metrics": {}, "equity_curve": [], "note": note,
    }


async def backtest_symbol(args: dict[str, Any]) -> dict[str, Any]:
    """Run a compact SMA-crossover backtest for one symbol; never raises."""
    ticker = str(args.get("ticker", "")).strip().upper()
    strategy = str(args.get("strategy", "sma_crossover"))
    range_str = str(args.get("range", "3y"))
    try:
        short_window = int(args.get("short_window", 20))
        long_window = int(args.get("long_window", 50))
    except (TypeError, ValueError):
        return _backtest_symbol_empty(ticker, 20, 50, "short_window and long_window must be integers.")
    if not ticker:
        return _backtest_symbol_empty(ticker, short_window, long_window, "ticker is required.")
    if strategy != "sma_crossover":
        return _backtest_symbol_empty(ticker, short_window, long_window, "Only strategy='sma_crossover' is supported.")
    if short_window <= 0 or long_window <= 0 or short_window >= long_window:
        return _backtest_symbol_empty(ticker, short_window, long_window, "short_window must be positive and less than long_window.")

    try:
        fetcher = await get_unified_fetcher()
        raw = await fetcher.fetch_history(ticker, range_str=range_str, interval="1d")
        parsed = await asyncio.to_thread(_parse_yahoo_chart, raw)
        if parsed is None or parsed.empty:
            return _backtest_symbol_empty(ticker, short_window, long_window, "No price history is available for this ticker and timeframe.")

        def run() -> Any:
            frame = pd.DataFrame({
                "date": parsed.index, "open": parsed["Open"].values, "high": parsed["High"].values,
                "low": parsed["Low"].values, "close": parsed["Close"].values,
            }).dropna().reset_index(drop=True)
            if frame.empty:
                raise ValueError("No usable OHLC rows after removing missing values.")
            signals = generate_sma_crossover_signals(frame, short_window, long_window)
            # BacktestEngine mutates the NumPy view of the signals when shorts
            # are disabled; ensure pandas does not hand it a read-only view.
            signals = pd.Series(signals.to_numpy(copy=True), index=signals.index)
            return BacktestEngine(BacktestConfig(
                initial_cash=100000, fee_bps=5, slippage_bps=5,
                position_fraction=1.0, allow_short=False,
            )).run(ticker, frame, signals)

        result = await asyncio.wait_for(asyncio.to_thread(run), timeout=60)
        curve = _downsample_rows([
            {"date": str(point.date), "equity": _safe_float(point.equity)}
            for point in result.equity_curve
        ])
        cagr_pct: float | None = None
        if len(result.equity_curve) >= 2 and result.final_equity > 0:
            first = pd.to_datetime(result.equity_curve[0].date)
            last = pd.to_datetime(result.equity_curve[-1].date)
            years = max((last - first).days / 365.25, 0)
            if years > 0:
                cagr_pct = ((result.final_equity / result.initial_cash) ** (1 / years) - 1) * 100
        metrics: dict[str, Any] = {
            "total_return_pct": _safe_float(result.total_return) * 100,
            "sharpe": _safe_float(result.sharpe), "sortino": _safe_float(result.sortino),
            "calmar": _safe_float(result.calmar), "max_drawdown_pct": _safe_float(result.max_drawdown) * 100,
            "win_rate_pct": _safe_float(result.win_rate), "profit_factor": _safe_float(result.profit_factor),
            "trades": len(result.trades),
        }
        if cagr_pct is not None and math.isfinite(cagr_pct):
            metrics["cagr_pct"] = cagr_pct
        return {
            "ticker": ticker, "strategy": "sma_crossover",
            "params": {"short_window": short_window, "long_window": long_window},
            "bars": result.bars, "metrics": metrics, "equity_curve": curve,
        }
    except asyncio.TimeoutError:
        return _backtest_symbol_empty(ticker, short_window, long_window, "Backtest timed out after 60 seconds.")
    except Exception as exc:  # noqa: BLE001 - agent tools must never raise
        return _backtest_symbol_empty(ticker, short_window, long_window, f"Backtest could not run: {exc}")


async def backtest_basket(args: dict[str, Any]) -> dict[str, Any]:
    """Run a compact momentum-rotation backtest for a basket; never raises."""
    tickers = list(dict.fromkeys(str(t).strip().upper() for t in args.get("tickers", []) if str(t).strip()))
    market = str(args.get("market", "")).upper()
    try:
        top_n = int(args.get("top_n", 5))
        lookback_days = int(args.get("lookback_days", 63))
        years = int(args.get("years", 3))
    except (TypeError, ValueError):
        return {"tickers": tickers, "equity_curve": [], "note": "top_n, lookback_days, and years must be integers."}
    is_india = market == "IN" or (bool(tickers) and all(t.endswith(".NS") for t in tickers))
    benchmark = str(args.get("benchmark") or ("^NSEI" if is_india else "^GSPC"))
    base = {"tickers": tickers, "benchmark": benchmark, "top_n": min(max(top_n, 0), len(tickers)), "equity_curve": []}
    if not 2 <= len(tickers) <= 30:
        return {**base, "note": "tickers must contain between 2 and 30 symbols."}
    if top_n <= 0 or lookback_days <= 0 or years <= 0:
        return {**base, "note": "top_n, lookback_days, and years must be positive."}
    rebalance_freq = str(args.get("rebalance_freq", "ME"))
    end = datetime.now()
    start = end - timedelta(days=365 * years)
    try:
        result = await asyncio.wait_for(asyncio.to_thread(
            backtest_momentum_rotation, tickers, start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"),
            RotationConfig(lookback_days=lookback_days, rebalance_freq=rebalance_freq,
                           top_n=min(top_n, len(tickers)), transaction_cost_bps=10.0, benchmark=benchmark),
            default_suffix=(".NS" if is_india else ""),
        ), timeout=90)
        curve = result.get("equity_curve")
        if not isinstance(curve, pd.DataFrame) or curve.empty:
            return {**base, "note": "Backtest returned no equity curve."}
        rows = _downsample_rows([
            {"date": index.date().isoformat() if hasattr(index, "date") else str(index),
             "strategy": _safe_float(row.get("strategy")), "benchmark": _safe_float(row.get("benchmark"))}
            for index, row in curve.iterrows()
        ])
        raw_summary = result.get("summary", {})
        def metrics(key: str) -> dict[str, float | None]:
            source = raw_summary.get(key, {}) if isinstance(raw_summary, dict) else {}
            return {
                "total_return_pct": _safe_float(source.get("total_return")) * 100,
                "cagr_pct": _safe_float(source.get("cagr")) * 100,
                "volatility_pct": _safe_float(source.get("volatility")) * 100,
                "sharpe": _safe_float(source.get("sharpe")),
                "max_drawdown_pct": _safe_float(source.get("max_drawdown")) * 100,
            }
        return {
            **base, "top_n": min(top_n, len(tickers)),
            "summary": {"strategy": metrics("strategy"), "benchmark": metrics("benchmark"),
                        "alpha_total_return_pct": _safe_float(raw_summary.get("alpha_total_return")) * 100},
            "equity_curve": rows,
        }
    except asyncio.TimeoutError:
        return {**base, "note": "Basket backtest timed out after 90 seconds."}
    except Exception as exc:  # noqa: BLE001 - includes no-price-data ValueError
        return {**base, "note": f"Basket backtest could not run: {exc}"}


def _validate_backtest_empty(metric: str, note: str) -> dict[str, Any]:
    return {
        "points": 0, "metric": metric, "permutation": {}, "robustness": {},
        "verdict": "Unable to validate backtest", "note": note,
    }


async def validate_backtest(args: dict[str, Any]) -> dict[str, Any]:
    """Run compact robustness checks on a backtest curve; never raises."""
    metric = str(args.get("metric", "sharpe"))
    if metric not in {"sharpe", "total_return"}:
        return _validate_backtest_empty(metric, "metric must be 'sharpe' or 'total_return'.")
    try:
        n_permutations = min(2000, max(100, int(args.get("n_permutations", 500))))
        n_windows = min(12, max(2, int(args.get("n_windows", 5))))
        periods_per_year = int(args.get("periods_per_year", 252))
    except (TypeError, ValueError):
        return _validate_backtest_empty(metric, "n_permutations, n_windows, and periods_per_year must be integers.")

    raw_curve = args.get("equity_curve")
    if not isinstance(raw_curve, list):
        return _validate_backtest_empty(metric, "equity_curve must be an array of rows.")
    curve: list[dict[str, Any]] = []
    for row in raw_curve:
        if not isinstance(row, dict):
            continue
        date = row.get("date")
        value = next((row[key] for key in ("equity", "strategy", "value", "nav") if key in row), None)
        equity = _safe_float(value)
        if date is not None and str(date).strip() and equity is not None:
            curve.append({"date": date, "equity": equity})
    if len(curve) < 3:
        return _validate_backtest_empty(metric, "At least 3 usable date/equity points are required.")

    try:
        permutation, robustness = await asyncio.to_thread(
            lambda: (
                permutation_test(curve, n_permutations=n_permutations, metric=metric,
                                 periods_per_year=periods_per_year),
                multi_window_robustness(curve, n_windows=n_windows, periods_per_year=periods_per_year),
            )
        )
        p_value = _safe_float(permutation.get("p_value"))
        consistency = _safe_float(robustness.get("consistency_score"))
        significant = bool(p_value is not None and p_value < 0.05)
        consistent = bool(robustness.get("interpretation") == "Robust performance across windows")
        if significant and consistent:
            verdict = "Significant edge, consistent across windows"
        elif significant:
            verdict = "Significant edge, but inconsistent across windows"
        else:
            verdict = "Indistinguishable from random"
        return {
            "points": len(curve), "metric": metric,
            "permutation": {
                "observed": _safe_float(permutation.get("observed")), "p_value": p_value,
                "percentile": _safe_float(permutation.get("percentile")),
                "null_mean": _safe_float(permutation.get("null_mean")),
                "null_std": _safe_float(permutation.get("null_std")),
                "significant": significant, "interpretation": permutation.get("interpretation"),
            },
            "robustness": {
                "n_windows": robustness.get("n_windows", 0),
                "consistency_score": consistency, "coverage": robustness.get("coverage", {}),
                "interpretation": robustness.get("interpretation"), "windows": robustness.get("windows", []),
            },
            "verdict": verdict,
        }
    except Exception as exc:  # noqa: BLE001 - agent tools must never raise
        return _validate_backtest_empty(metric, f"Backtest validation could not run: {exc}")


async def screen_stocks(args: dict[str, Any]) -> dict[str, Any]:
    """Run the platform screener from a natural filter string.

    Always returns a structured result (never raises) so the agent can reason
    over it even when data is unavailable — a failed tool call would just abort
    the run. Errors/empties come back as ``count: 0`` with a ``note``.
    """
    raw_query = str(args.get("query", ""))
    query = _normalize_screener_query(raw_query)
    universe = str(args.get("universe", "nse_500"))
    market = str(args.get("market", "IN"))
    try:
        limit = max(1, min(100, int(args.get("limit", 25))))
    except (TypeError, ValueError):
        limit = 25

    def _empty(note: str, hydrated: int = 0) -> dict[str, Any]:
        return {
            "query": query, "market": market, "universe": universe,
            "filters_applied": {
                "raw_expression": raw_query,
                "expression": query,
                "market": market,
                "universe": universe,
                "limit": limit,
            },
            "count": 0,
            "hydrated_rows": hydrated,
            "analysis": _screen_analysis([], 0),
            "top_candidates": [],
            "results": [],
            "note": note,
        }

    # The screener reads a materialized store populated lazily. The HTTP route
    # hydrates before running; the agent tool must too, but bounded — a slow or
    # blocked data source must not hang or fail the run.
    hydrated = 0
    try:
        hydrated = await _hydrate_missing_universe_rows(universe, market)
    except Exception:  # noqa: BLE001 - hydration is best-effort
        hydrated = 0

    try:
        config = RunConfig(query=query, universe=universe, market=market, limit=limit)
        result = ScreenerEngine().run(config)
    except Exception as exc:  # noqa: BLE001 - never fail the agent tool
        return _empty(f"Screener could not run: {exc}", hydrated)

    rows = result.get("results", []) if isinstance(result, dict) else []
    trimmed = [_compact_screen_row(row) for row in rows]
    count = int(result.get("total_results", len(trimmed))) if isinstance(result, dict) else len(trimmed)
    top_candidates = [
        {
            "ticker": row.get("ticker"),
            "company": row.get("company"),
            "sector": row.get("sector"),
            "fit_reasons": _screen_candidate_reason(row),
        }
        for row in trimmed[: min(5, len(trimmed))]
    ]
    payload = {
        "query": result.get("query_parsed", query) if isinstance(result, dict) else query,
        "market": market,
        "universe": universe,
        "filters_applied": {
            "raw_expression": raw_query,
            "expression": result.get("query_parsed", query) if isinstance(result, dict) else query,
            "market": market,
            "universe": universe,
            "limit": limit,
        },
        "count": count,
        "hydrated_rows": hydrated,
        "analysis": _screen_analysis(trimmed, count),
        "top_candidates": top_candidates,
        "results": trimmed,
    }
    if count == 0:
        payload["note"] = (
            "No matches. Data for this universe may be unavailable in this "
            "environment (e.g. NSE/India sources), or the filter is too strict. "
            "Try market='US', universe='sp_500', or relax the criteria."
        )
    return payload


async def get_stock_snapshot(args: dict[str, Any]) -> dict[str, Any]:
    """Fetch a full fundamentals/price snapshot for one ticker."""
    symbol = str(args.get("ticker", "")).strip().upper()
    fetcher = await get_unified_fetcher()
    return await fetcher.fetch_stock_snapshot(symbol)


async def compare_stocks(args: dict[str, Any]) -> dict[str, Any]:
    """Fetch snapshots for several tickers, projected to the requested metrics."""
    tickers = [str(t).strip().upper() for t in args.get("tickers", []) if str(t).strip()]
    metrics = [str(m) for m in args.get("metrics", [])]
    fetcher = await get_unified_fetcher()
    rows: list[dict[str, Any]] = []
    for sym in tickers:
        snap = await fetcher.fetch_stock_snapshot(sym)
        row = {"symbol": sym}
        if metrics:
            for m in metrics:
                row[m] = snap.get(m)
        else:
            row.update(snap)
        rows.append(row)
    return {"rows": rows}


async def search_research(args: dict[str, Any]) -> dict[str, Any]:
    """RAG over the local quant-research knowledge base (arXiv etc.)."""
    from backend.core.research import service as research_service

    query = str(args.get("query", "")).strip()
    if not query:
        return {"query": query, "count": 0, "results": [], "note": "query is required"}
    try:
        k = max(1, min(20, int(args.get("k", 6))))
    except (TypeError, ValueError):
        k = 6
    rows = research_service.search(query, k=k)
    trimmed = [
        {
            "title": r.get("title"),
            "authors": r.get("authors"),
            "url": r.get("url"),
            "published_at": r.get("published_at"),
            "score": r.get("score"),
            "abstract": (str(r.get("abstract") or "")[:600]),
        }
        for r in rows
    ]
    note = None if trimmed else "No indexed research yet — ingest via POST /api/research/ingest first."
    return {"query": query, "count": len(trimmed), "results": trimmed, **({"note": note} if note else {})}


async def analyze_technicals(args: dict[str, Any]) -> dict[str, Any]:
    """Return a compact technical snapshot and currently actionable setups."""
    ticker = str(args.get("ticker", "")).strip().upper()
    range_str = str(args.get("range", "1y"))
    interval = str(args.get("interval", "1d"))
    if not ticker:
        return _technical_empty(ticker, "ticker is required")
    try:
        fetcher = await get_unified_fetcher()
        raw = await asyncio.wait_for(
            fetcher.fetch_history(ticker, range_str=range_str, interval=interval), timeout=20,
        )
        frame = await asyncio.to_thread(_parse_yahoo_chart, raw)
        if frame is None or frame.empty:
            return _technical_empty(ticker, "No price history is available for this ticker and timeframe.")
        enriched = await asyncio.to_thread(compute_indicator_pack, frame.sort_index())
        if enriched.empty:
            return _technical_empty(ticker, "Price history could not be enriched with indicators.")
    except asyncio.TimeoutError:
        return _technical_empty(ticker, "Price-history request timed out.")
    except Exception as exc:  # noqa: BLE001 - agent tools must never raise
        return _technical_empty(ticker, f"Technical analysis could not run: {exc}")

    try:
        active_setups: list[dict[str, Any]] = []
        for name, detector in DETECTOR_MAP.items():
            try:
                result = await asyncio.to_thread(detector, enriched, **_DETECTOR_DEFAULTS.get(name, {}))
            except TypeError:
                continue
            except Exception:
                continue
            if not isinstance(result, dict) or (not result.get("passed") and str(result.get("event_type") or "none") == "none"):
                continue
            active_setups.append({
                "setup_type": result.get("setup_type") or name,
                "event_type": result.get("event_type", "none"),
                "trend_state": result.get("trend_state"),
                "distance_to_trigger": _safe_float(result.get("distance_to_trigger")),
                "explain": result.get("explain_steps") or [],
            })

        def last(column: str) -> float | None:
            return _safe_float(enriched[column].iloc[-1]) if column in enriched else None

        price = last("Close")
        ema_50, ema_200 = last("ema_50"), last("ema_200")
        high_20 = _safe_float(enriched["High"].tail(20).max()) if "High" in enriched else None
        distance_high = ((high_20 - price) / high_20 * 100) if high_20 and price is not None else None
        supertrend = last("supertrend_dir")
        return {
            "ticker": ticker,
            "as_of": enriched.index[-1].isoformat(),
            "price": price,
            "trend": {
                "ema_9": last("ema_9"), "ema_21": last("ema_21"), "ema_50": ema_50, "ema_200": ema_200,
                "above_50dma": bool(price is not None and ema_50 is not None and price >= ema_50),
                "above_200dma": bool(price is not None and ema_200 is not None and price >= ema_200),
                "supertrend_dir": int(supertrend) if supertrend is not None else None,
            },
            "momentum": {"rsi_14": last("rsi_14"), "roc_10": last("roc_10"), "roc_20": last("roc_20")},
            "volatility": {"atr_pct": last("atr_pct"), "bb_width_pct_rank_120": last("bb_width_pct_rank_120")},
            "volume": {"rvol_20": last("rvol_20")},
            "distance_from_20d_high_pct": distance_high,
            "active_setups": active_setups,
        }
    except Exception as exc:  # noqa: BLE001 - malformed provider data must not fail the agent
        return _technical_empty(ticker, f"Technical analysis could not be summarized: {exc}")


async def scan_setups(args: dict[str, Any]) -> dict[str, Any]:
    """Scan a supported universe and return only ranked setup essentials."""
    universe = str(args.get("universe", "NSE:NIFTY200"))
    timeframe = str(args.get("timeframe", "1d"))
    requested = args.get("setups")
    setups = [str(s) for s in requested if str(s) in DETECTOR_MAP] if isinstance(requested, list) else list(DETECTOR_MAP)
    if not setups:
        return {"universe": universe, "timeframe": timeframe, "scanned": 0, "matches": 0, "results": [], "note": "No valid setup detectors were requested."}
    try:
        symbol_cap = max(1, min(150, int(args.get("symbol_cap", 60))))
    except (TypeError, ValueError):
        symbol_cap = 60
    try:
        limit = max(1, min(100, int(args.get("limit", 25))))
    except (TypeError, ValueError):
        limit = 25
    try:
        preset = ScanPresetBase(
            name="agent_scan", universe=universe, timeframe=timeframe, liquidity_gate=LiquidityGate(),
            rules=[DetectorRule(type=name, params=_DETECTOR_DEFAULTS[name]) for name in setups],
        )
        fetcher = await get_unified_fetcher()
        bundle = await asyncio.wait_for(ScannerRunner(fetcher).run(preset, symbol_cap=symbol_cap, concurrency=8), timeout=45)
        summary = bundle.summary if isinstance(bundle.summary, dict) else {}
        rows = bundle.results if isinstance(bundle.results, list) else []
    except asyncio.TimeoutError:
        return {"universe": universe, "timeframe": timeframe, "scanned": 0, "matches": 0, "results": [], "note": "Setup scan timed out."}
    except Exception as exc:  # noqa: BLE001 - agent tools must never raise
        return {"universe": universe, "timeframe": timeframe, "scanned": 0, "matches": 0, "results": [], "note": f"Setup scan could not run: {exc}"}

    try:
        fields = ("symbol", "setup_type", "score", "event_type", "trend_state", "rvol", "atr_pct", "distance_to_trigger")
        trimmed = [{key: row.get(key) for key in fields} for row in rows[:limit] if isinstance(row, dict)]
        payload: dict[str, Any] = {
            "universe": universe, "timeframe": timeframe,
            "scanned": int(summary.get("symbols_scanned", 0) or 0),
            "matches": int(summary.get("matches", len(rows)) or 0), "results": trimmed,
        }
        if not trimmed:
            payload["note"] = "No matching setups were found, or price history was unavailable for this scan."
        return payload
    except Exception as exc:  # noqa: BLE001 - malformed runner data must not fail the agent
        return {"universe": universe, "timeframe": timeframe, "scanned": 0, "matches": 0, "results": [], "note": f"Setup scan could not be summarized: {exc}"}


def _strategy_specs() -> list[ToolSpec]:
    """The complete, shared definition of the strategy loop's read-only tools."""
    return [
        ToolSpec(
            name="backtest_symbol",
            description="Backtest a simple SMA crossover strategy for one ticker using daily price history.",
            parameters={
                "type": "object", "properties": {
                    "ticker": {"type": "string"},
                    "strategy": {"type": "string", "enum": ["sma_crossover"], "default": "sma_crossover"},
                    "short_window": {"type": "integer", "minimum": 1, "default": 20},
                    "long_window": {"type": "integer", "minimum": 2, "default": 50},
                    "range": {"type": "string", "default": "3y"},
                }, "required": ["ticker"],
            }, handler=backtest_symbol, read_only=True, write_class="none",
        ),
        ToolSpec(
            name="backtest_basket",
            description="Backtest momentum rotation over a basket of 2 to 30 tickers.",
            parameters={
                "type": "object", "properties": {
                    "tickers": {"type": "array", "minItems": 2, "maxItems": 30, "items": {"type": "string"}},
                    "top_n": {"type": "integer", "minimum": 1, "default": 5},
                    "lookback_days": {"type": "integer", "minimum": 1, "default": 63},
                    "rebalance_freq": {"type": "string", "default": "ME"},
                    "benchmark": {"type": "string"}, "market": {"type": "string", "enum": ["IN", "US"]},
                    "years": {"type": "integer", "minimum": 1, "default": 3},
                }, "required": ["tickers"],
            }, handler=backtest_basket, read_only=True, write_class="none",
        ),
        ToolSpec(
            name="validate_backtest",
            description="Run permutation and multi-window robustness checks on a backtest equity curve.",
            parameters={
                "type": "object", "properties": {
                    "equity_curve": {"type": "array", "items": {"type": "object"}},
                    "metric": {"type": "string", "enum": ["sharpe", "total_return"], "default": "sharpe"},
                    "n_permutations": {"type": "integer", "minimum": 100, "maximum": 2000, "default": 500},
                    "n_windows": {"type": "integer", "minimum": 2, "maximum": 12, "default": 5},
                    "periods_per_year": {"type": "integer", "default": 252},
                }, "required": ["equity_curve"],
            }, handler=validate_backtest, read_only=True, write_class="none",
        ),
    ]


def build_strategy_registry() -> ToolRegistry:
    """Registry for the strategy loop: physically no execution/write tools exist here."""
    reg = ToolRegistry()
    for spec in _strategy_specs():
        reg.register(spec)
    return reg


def build_default_registry(user_id: str | None = None) -> ToolRegistry:
    reg = ToolRegistry()
    # Imported lazily: these modules pull in screener, risk and provider engines
    # that are expensive to import and not needed when the registry is unused.
    from backend.agent.tools.derivatives_tools import derivatives_tool_specs
    from backend.agent.tools.macro_tools import macro_tool_specs
    from backend.agent.tools.analytics_tools import analytics_tool_specs

    if user_id:
        from backend.agent.tools.portfolio_tools import portfolio_tool_specs
        from backend.agent.proposals import proposal_tool_specs
        from backend.agent.tools.news_tools import news_tool_specs
        from backend.agent.tools.action_tools import action_tool_specs
        from backend.agent.tools.risk_tools import risk_tool_specs
        reg.register_many([
            *portfolio_tool_specs(user_id),
            *proposal_tool_specs(user_id),
            *news_tool_specs(user_id),
            *action_tool_specs(user_id),
            *risk_tool_specs(user_id),
        ])
    reg.register_many([
        *derivatives_tool_specs(),
        *macro_tool_specs(),
        *analytics_tool_specs(),
    ])
    reg.register(ToolSpec(
        name="screen_stocks",
        description="Required first tool for user requests that ask to find, screen, scan, filter, "
                    "shortlist, rank, or identify stocks matching criteria. Accepts natural filter "
                    "language or expressions (e.g. 'pe_ratio < 20 and roe > 15') and returns "
                    "filters_applied, analysis, top_candidates, and matching fundamental rows.",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Filter expression."},
                "universe": {"type": "string", "enum": ["nse_500", "sp_500", "nasdaq_100", "us_all"]},
                "market": {"type": "string", "enum": ["IN", "US"]},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100},
            },
            "required": ["query"],
        },
        handler=screen_stocks, read_only=True,
    ))
    reg.register(ToolSpec(
        name="get_stock_snapshot",
        description="Get a full price + fundamentals snapshot for a single ticker.",
        parameters={
            "type": "object",
            "properties": {"ticker": {"type": "string"}},
            "required": ["ticker"],
        },
        handler=get_stock_snapshot, read_only=True,
    ))
    reg.register(ToolSpec(
        name="compare_stocks",
        description="Compare several tickers across the requested metrics "
                    "(e.g. pe_ratio, roe, market_cap).",
        parameters={
            "type": "object",
            "properties": {
                "tickers": {"type": "array", "items": {"type": "string"}},
                "metrics": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["tickers"],
        },
        handler=compare_stocks, read_only=True,
    ))
    reg.register(ToolSpec(
        name="search_research",
        description="Search the local quant-research knowledge base (arXiv papers etc.) for relevant findings. "
                    "Returns titles, authors, abstract snippets and links.",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Topic / question to search for."},
                "k": {"type": "integer", "minimum": 1, "maximum": 20},
            },
            "required": ["query"],
        },
        handler=search_research, read_only=True,
    ))
    reg.register(ToolSpec(
        name="analyze_technicals",
        description="Analyze one stock's trend, momentum, volatility, volume, and active technical setups.",
        parameters={
            "type": "object",
            "properties": {
                "ticker": {"type": "string"}, "range": {"type": "string", "default": "1y"},
                "interval": {"type": "string", "default": "1d"},
            }, "required": ["ticker"],
        }, handler=analyze_technicals, read_only=True, write_class="none",
    ))
    reg.register(ToolSpec(
        name="scan_setups",
        description="Scan a supported market universe for ranked technical setups.",
        parameters={
            "type": "object",
            "properties": {
                "universe": {"type": "string", "default": "NSE:NIFTY200"},
                "timeframe": {"type": "string", "default": "1d"},
                "setups": {"type": "array", "items": {"type": "string", "enum": list(DETECTOR_MAP)}},
                "symbol_cap": {"type": "integer", "minimum": 1, "maximum": 150, "default": 60},
                "limit": {"type": "integer", "minimum": 1, "default": 25},
            },
        }, handler=scan_setups, read_only=True, write_class="none",
    ))
    for spec in _strategy_specs():
        reg.register(spec)
    return reg
