"""Portfolio-level risk tools for the agent: VaR/CVaR, stress tests, optimization proposals,
and exposure breakdowns, wired straight to the existing risk engines.

Every handler calls into ``backend.risk_engine`` / ``backend.services.stress_test_service`` /
``backend.core.riskfolio`` for the actual math — nothing here reimplements VaR, cointegration,
optimization, or drawdown formulas. The one rule that matters more than any other: if the
backing engine cannot produce a real figure (no holdings, no price history, bad symbols), the
handler returns ``err(...)``. It never fills in a zero or a plausible-looking default that an
agent could mistake for a measured risk number.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from backend.agent.tools.envelope import cap, err, ok
from backend.agent.tools.registry import ToolSpec
from backend.api.deps import get_unified_fetcher
from backend.api.routes.chart import _parse_yahoo_chart
from backend.api.routes.stress_test import _infer_sector
from backend.core.backtester import _max_drawdown
from backend.core.riskfolio.optimization import efficient_frontier
from backend.core.riskfolio.optimization import optimize_portfolio as _riskfolio_optimize
from backend.risk_engine.compute import calculate_beta, ewma_volatility
from backend.risk_engine.engine import compute_portfolio_risk
from backend.services.stress_test_service import stress_test_service
from backend.shared.db import SessionLocal
from backend.shared.market_classifier import market_classifier

# Below this many overlapping daily bars, VaR/vol/beta estimates are noise, not signal.
_MIN_RETURN_ROWS = 20
_MIN_OPTIMIZE_ROWS = 30
_HIGH_POSITION_CONCENTRATION_PCT = 25.0
_HIGH_SECTOR_CONCENTRATION_PCT = 40.0
_MAX_OPTIMIZE_TICKERS = 25

_OBJECTIVE_MAP: dict[str, tuple[str, str]] = {
    # agent-facing objective -> (riskfolio model, riskfolio objective)
    "max_sharpe": ("Classic", "max_sharpe"),
    "min_vol": ("Classic", "min_risk"),
    "risk_parity": ("RP", "min_risk"),
}


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _resolve_holdings(portfolio_id: str | None) -> tuple[list[Any], str] | dict[str, Any]:
    """Resolve holdings for *portfolio_id* via the stress-test service's own lookup.

    Returns ``(holdings, resolved_portfolio_id)`` or an ``err()`` envelope. The legacy
    ``holdings`` table carries no ``user_id`` column (same limitation documented in
    ``portfolio_tools.py``'s ``_holdings_snapshot``), so "scoping" here means validating
    a named portfolio_id exists, not filtering rows by user.
    """
    db = SessionLocal()
    try:
        try:
            holdings, resolved = stress_test_service.resolve_portfolio_holdings(db, portfolio_id or "current")
        except LookupError as exc:
            return err(str(exc), code="not_found", hint="Add holdings or pass a valid portfolio_id.")
        return holdings, resolved
    finally:
        db.close()


def _weighted_symbols(holdings: list[Any]) -> tuple[list[str], dict[str, float], float]:
    """Turn ORM Holding rows into (symbols, weight_by_symbol, total_cost_value).

    Weights are cost-basis weights (quantity * avg_buy_price) — no live price is available
    in this agent context, matching the same caveat ``get_portfolio``/``get_paper_positions``
    already document.
    """
    values: dict[str, float] = {}
    for h in holdings:
        sym = str(h.ticker).strip().upper()
        if not sym:
            continue
        values[sym] = values.get(sym, 0.0) + float(h.quantity) * float(h.avg_buy_price)
    total = sum(values.values())
    symbols = sorted(values)
    weights = {s: (values[s] / total if total > 0 else 1.0 / len(values)) for s in symbols}
    return symbols, weights, total


async def _returns_frame(symbols: list[str], range_str: str = "2y") -> pd.DataFrame:
    """Fetch daily close history for *symbols* and return an aligned daily-return frame."""
    fetcher = await get_unified_fetcher()
    series_map: dict[str, pd.Series] = {}
    for symbol in symbols:
        try:
            raw = await fetcher.fetch_history(symbol, range_str=range_str, interval="1d")
        except Exception:
            continue
        frame = _parse_yahoo_chart(raw if isinstance(raw, dict) else {})
        if frame.empty or "Close" not in frame:
            continue
        ret = frame["Close"].pct_change().dropna()
        if not ret.empty:
            series_map[symbol] = ret
    if not series_map:
        return pd.DataFrame()
    return pd.DataFrame(series_map).dropna(how="any")


def _pick_benchmark(symbols: list[str]) -> str:
    """Cheap heuristic: NSE suffix anywhere in the universe -> Nifty, else S&P 500."""
    return "^NSEI" if any(s.endswith(".NS") or s.endswith(".BO") for s in symbols) else "^GSPC"


# ---------------------------------------------------------------------------
# get_portfolio_risk
# ---------------------------------------------------------------------------

async def _get_portfolio_risk(args: dict[str, Any]) -> dict[str, Any]:
    try:
        resolved = _resolve_holdings(args.get("portfolio_id"))
        if isinstance(resolved, dict):
            return resolved
        holdings, resolved_id = resolved

        symbols, weights, portfolio_value = _weighted_symbols(holdings)
        if not symbols or portfolio_value <= 0:
            return err(
                "Portfolio has no positions with a positive cost basis — there is nothing to measure risk on.",
                code="empty_portfolio",
            )

        returns_df = await _returns_frame(symbols, range_str="2y")
        if returns_df.empty or len(returns_df) < _MIN_RETURN_ROWS:
            got = 0 if returns_df.empty else len(returns_df)
            return err(
                f"Only {got} overlapping daily return(s) available across {symbols}; "
                f"need at least {_MIN_RETURN_ROWS} to compute VaR/CVaR/vol without them being noise.",
                code="insufficient_history",
                hint="Provider price history may be unavailable for one or more holdings.",
            )

        risk = compute_portfolio_risk(returns_df, portfolio_value=portfolio_value, confidence=0.95)
        # compute_portfolio_risk averages the return series equal-weighted (not $-weighted);
        # that's the engine's own convention, kept as-is rather than reimplementing it here.
        port_returns = returns_df.mean(axis=1)
        nav = (1.0 + port_returns).cumprod()
        max_dd = _max_drawdown(nav)
        vol_ann = ewma_volatility(port_returns.to_numpy()) * (252.0 ** 0.5)

        benchmark = _pick_benchmark(symbols)
        beta: float | None = None
        beta_note: str | None = None
        bench_df = await _returns_frame([benchmark], range_str="2y")
        if not bench_df.empty and benchmark in bench_df.columns:
            aligned = pd.concat(
                [port_returns.rename("portfolio"), bench_df[benchmark].rename("benchmark")], axis=1
            ).dropna()
            if len(aligned) >= _MIN_RETURN_ROWS:
                beta = calculate_beta(aligned["portfolio"].to_numpy(), aligned["benchmark"].to_numpy())
        if beta is None:
            beta_note = f"Beta unavailable: could not align portfolio returns with benchmark {benchmark}."

        top_symbol, top_weight = max(weights.items(), key=lambda kv: kv[1])
        hhi = sum(w * w for w in weights.values())

        data = {
            "portfolio_id": resolved_id,
            "symbols": symbols,
            "portfolio_value": round(portfolio_value, 2),
            "confidence": 0.95,
            "var_parametric": round(risk["parametric"]["var"], 2),
            "cvar_parametric": round(risk["parametric"]["es"], 2),
            "var_historical": round(risk["historical"]["var"], 2),
            "cvar_historical": round(risk["historical"]["es"], 2),
            "annualized_volatility_pct": round(vol_ann * 100, 2),
            "beta_vs_benchmark": round(beta, 3) if beta is not None else None,
            "benchmark": benchmark,
            "max_drawdown_pct": round(max_dd * 100, 2),
            "concentration": {
                "top_position": top_symbol,
                "top_position_weight_pct": round(top_weight * 100, 2),
                "herfindahl_index": round(hhi, 4),
                "flagged": top_weight * 100 >= _HIGH_POSITION_CONCENTRATION_PCT,
            },
            "note": beta_note,
        }
        return ok(data, source="risk_engine", as_of=str(returns_df.index[-1].date()))
    except Exception as exc:  # noqa: BLE001 - agent tools must never raise
        return err(f"get_portfolio_risk failed: {exc}", code="tool_error")


# ---------------------------------------------------------------------------
# run_stress_test
# ---------------------------------------------------------------------------

def _run_stress_test(args: dict[str, Any]) -> dict[str, Any]:
    try:
        portfolio_id = args.get("portfolio_id") or "current"
        scenario = args.get("scenario") or "2008_gfc"
        db = SessionLocal()
        try:
            try:
                result = stress_test_service.run_stress_test(db, portfolio_id, scenario, {})
            except KeyError:
                # KeyError is a LookupError subclass, so it must be caught before LookupError below.
                valid = [s["key"] for s in stress_test_service.list_scenarios()]
                return err(
                    f"Unknown scenario '{scenario}'.",
                    code="unknown_scenario",
                    hint=f"Valid scenarios: {', '.join(valid)}.",
                )
            except LookupError as exc:
                return err(str(exc), code="not_found", hint="Add holdings or pass a valid portfolio_id.")
        finally:
            db.close()

        payload = result.to_payload()
        kept, dropped = cap(payload["holdings"], 25)
        payload["holdings"] = kept

        return ok(
            payload,
            source="stress_test_service",
            quality="synthetic",
            note=(
                "Scenario shocks are historically calibrated (per-factor magnitudes from the named "
                "event), but each holding's equity/rate/commodity/fx/credit sensitivities are sector "
                "presets plus deterministic per-ticker jitter, not regression-fitted betas."
            ),
            truncated=dropped,
        )
    except Exception as exc:  # noqa: BLE001
        return err(f"run_stress_test failed: {exc}", code="tool_error")


# ---------------------------------------------------------------------------
# optimize_portfolio
# ---------------------------------------------------------------------------

async def _optimize_portfolio(args: dict[str, Any]) -> dict[str, Any]:
    try:
        raw_tickers = [str(t).strip().upper() for t in (args.get("tickers") or []) if str(t).strip()]
        tickers = list(dict.fromkeys(raw_tickers))
        if not tickers:
            resolved = _resolve_holdings(None)
            if isinstance(resolved, dict):
                return resolved
            holdings, _resolved_id = resolved
            tickers = sorted({str(h.ticker).strip().upper() for h in holdings if str(h.ticker).strip()})

        if len(tickers) < 2:
            return err(
                "optimize_portfolio needs at least 2 distinct tickers (the portfolio has too few holdings).",
                code="insufficient_universe",
            )
        if len(tickers) > _MAX_OPTIMIZE_TICKERS:
            return err(
                f"{len(tickers)} tickers requested; cap is {_MAX_OPTIMIZE_TICKERS} to keep the optimizer "
                "numerically stable and the response compact.",
                code="too_many_tickers",
            )

        objective_arg = str(args.get("objective") or "max_sharpe").strip().lower()
        if objective_arg not in _OBJECTIVE_MAP:
            return err(
                f"Unknown objective '{objective_arg}'.",
                code="bad_objective",
                hint="Use one of: max_sharpe, min_vol, risk_parity.",
            )
        model, riskfolio_objective = _OBJECTIVE_MAP[objective_arg]

        constraints = args.get("constraints") or {}
        min_weight = float(constraints.get("min_weight", 0.0))
        max_weight = float(constraints.get("max_weight", 1.0))

        returns_df = await _returns_frame(tickers, range_str="2y")
        if returns_df.empty or len(returns_df.columns) < 2:
            return err(
                "Could not build an overlapping return history for the requested tickers.",
                code="insufficient_history",
            )
        if len(returns_df) < _MIN_OPTIMIZE_ROWS:
            return err(
                f"Only {len(returns_df)} overlapping daily returns; need at least {_MIN_OPTIMIZE_ROWS} "
                "for a numerically stable optimization.",
                code="insufficient_history",
            )
        dropped = [t for t in tickers if t not in returns_df.columns]

        try:
            result = _riskfolio_optimize(
                returns_df, model=model, objective=riskfolio_objective,
                min_weight=min_weight, max_weight=max_weight,
            )
            frontier = efficient_frontier(returns_df, points=12, min_weight=min_weight, max_weight=max_weight)
        except Exception as exc:
            return err(f"Optimizer could not solve for this universe/constraints: {exc}", code="optimizer_error")

        data = {
            "objective": objective_arg,
            "model": model,
            "universe": list(returns_df.columns),
            "dropped_tickers": dropped,
            "weights": result["weights"],
            "metrics": result["metrics"],
            "risk_contributions": result["risk_contributions"],
            "efficient_frontier": cap(frontier, 12)[0],
            "note": "Proposal only — target weights, not an executed rebalance.",
        }
        return ok(data, source="riskfolio", as_of=str(returns_df.index[-1].date()))
    except Exception as exc:  # noqa: BLE001
        return err(f"optimize_portfolio failed: {exc}", code="tool_error")


# ---------------------------------------------------------------------------
# get_exposure_breakdown
# ---------------------------------------------------------------------------

async def _get_exposure_breakdown(args: dict[str, Any]) -> dict[str, Any]:
    try:
        resolved = _resolve_holdings(args.get("portfolio_id"))
        if isinstance(resolved, dict):
            return resolved
        holdings, resolved_id = resolved

        symbols, weights, total_value = _weighted_symbols(holdings)
        if not symbols or total_value <= 0:
            return err(
                "Portfolio has no positions with a positive cost basis — nothing to break down.",
                code="empty_portfolio",
            )

        # noqa: SLF001 - _TICKER_SECTOR_MAP is the only membership check exposed; used only to
        # flag when a sector came from the deterministic hash fallback rather than the mapped table.
        mapped = stress_test_service._TICKER_SECTOR_MAP  # type: ignore[attr-defined]
        unmapped: list[str] = []
        sector_weights: dict[str, float] = {}
        geography_weights: dict[str, float] = {}
        geo_unresolved: list[str] = []
        for sym in symbols:
            w = weights[sym]
            base = sym.split(".")[0]
            if sym not in mapped and base not in mapped:
                unmapped.append(sym)
            sector = _infer_sector(sym)
            sector_weights[sector] = sector_weights.get(sector, 0.0) + w
            try:
                cls = await market_classifier.classify(sym)
                geo = cls.country_name
            except Exception:
                geo = "Unknown"
                geo_unresolved.append(sym)
            geography_weights[geo] = geography_weights.get(geo, 0.0) + w

        def _rows(weight_map: dict[str, float]) -> list[dict[str, Any]]:
            return sorted(
                ({"name": k, "weight_pct": round(v * 100, 2)} for k, v in weight_map.items()),
                key=lambda r: r["weight_pct"], reverse=True,
            )

        sector_rows = _rows(sector_weights)
        geography_rows = _rows(geography_weights)

        flags: list[str] = []
        if sector_rows and sector_rows[0]["weight_pct"] >= _HIGH_SECTOR_CONCENTRATION_PCT:
            flags.append(f"Sector concentration: {sector_rows[0]['name']} is {sector_rows[0]['weight_pct']}% of the portfolio.")
        top_symbol, top_weight = max(weights.items(), key=lambda kv: kv[1])
        if top_weight * 100 >= _HIGH_POSITION_CONCENTRATION_PCT:
            flags.append(f"Single-name concentration: {top_symbol} is {round(top_weight * 100, 2)}% of the portfolio.")

        data = {
            "portfolio_id": resolved_id,
            "asset_class": [{"name": "equity", "weight_pct": 100.0}],
            "sector": sector_rows,
            "geography": geography_rows,
            "flags": flags,
            "note": (
                "All positions are classified as equity — the holdings table carries no instrument-type "
                "field. Sector labels for tickers outside the mapped preset table fall back to a "
                "deterministic hash bucket, not fundamentals data."
                + (f" Affected: {', '.join(unmapped)}." if unmapped else "")
            ),
        }
        return ok(
            data,
            source="stress_test_service+market_classifier",
            quality="synthetic" if unmapped else "live",
        )
    except Exception as exc:  # noqa: BLE001
        return err(f"get_exposure_breakdown failed: {exc}", code="tool_error")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def risk_tool_specs(user_id: str) -> list[ToolSpec]:
    """Return the four read-only, user-scoped risk tool specs. *user_id* is accepted for factory
    symmetry with ``portfolio_tool_specs`` — the underlying holdings table has no user_id column
    (documented above), so scoping is by explicit ``portfolio_id`` rather than caller identity.
    """
    del user_id  # not usable for scoping today; see _resolve_holdings docstring

    async def _get_portfolio_risk_handler(args: dict[str, Any]) -> dict[str, Any]:
        return await _get_portfolio_risk(args)

    def _run_stress_test_handler(args: dict[str, Any]) -> dict[str, Any]:
        return _run_stress_test(args)

    async def _optimize_portfolio_handler(args: dict[str, Any]) -> dict[str, Any]:
        return await _optimize_portfolio(args)

    async def _get_exposure_breakdown_handler(args: dict[str, Any]) -> dict[str, Any]:
        return await _get_exposure_breakdown(args)

    return [
        ToolSpec(
            name="get_portfolio_risk",
            description="Compute portfolio-level risk for the user's holdings: parametric and "
            "historical VaR/CVaR at 95% confidence, annualized volatility, beta vs. a market "
            "benchmark, max drawdown of the equal-weighted return series, and position "
            "concentration (top holding weight, Herfindahl index). Returns err() if there are no "
            "holdings or too little overlapping price history to compute real figures — never a "
            "zero-filled report. Optional portfolio_id; defaults to the current holdings.",
            parameters={
                "type": "object",
                "properties": {
                    "portfolio_id": {"type": "string", "description": "Optional portfolio identifier."},
                },
            },
            handler=_get_portfolio_risk_handler,
            read_only=True,
            write_class="none",
        ),
        ToolSpec(
            name="run_stress_test",
            description="Apply a named historical or hypothetical stress scenario (e.g. '2008_gfc', "
            "'2020_covid', '2013_taper', '2022_rates') to the user's holdings and return total P&L "
            "impact plus per-position and per-sector breakdown. Per-holding sensitivities are sector "
            "presets, not fitted betas — flagged as quality=synthetic. Optional scenario (default "
            "'2008_gfc') and portfolio_id.",
            parameters={
                "type": "object",
                "properties": {
                    "scenario": {"type": "string", "description": "Scenario key, e.g. 2008_gfc, 2020_covid, 2013_taper, 2022_rates."},
                    "portfolio_id": {"type": "string", "description": "Optional portfolio identifier."},
                },
            },
            handler=_run_stress_test_handler,
            read_only=True,
            write_class="none",
        ),
        ToolSpec(
            name="optimize_portfolio",
            description="Propose target portfolio weights via mean-variance optimization. objective "
            "is one of max_sharpe, min_vol, or risk_parity. Accepts an explicit tickers list (2-25 "
            "symbols) or, if omitted, uses the user's current holdings. Returns target weights, risk "
            "metrics, per-asset risk contributions, and an efficient-frontier sample. Read-only: this "
            "PROPOSES weights, it never places trades or rebalances. Returns err() if there isn't "
            "enough overlapping price history to fit a stable covariance matrix.",
            parameters={
                "type": "object",
                "properties": {
                    "tickers": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 25},
                    "objective": {"type": "string", "enum": ["max_sharpe", "min_vol", "risk_parity"], "default": "max_sharpe"},
                    "constraints": {
                        "type": "object",
                        "properties": {
                            "min_weight": {"type": "number", "minimum": 0, "maximum": 1},
                            "max_weight": {"type": "number", "minimum": 0, "maximum": 1},
                        },
                    },
                },
            },
            handler=_optimize_portfolio_handler,
            read_only=True,
            write_class="none",
        ),
        ToolSpec(
            name="get_exposure_breakdown",
            description="Break the user's holdings down by sector and geography (asset class is "
            "always 'equity' — the holdings table has no instrument-type field), with weight_pct per "
            "bucket and flags when a single name or sector dominates the portfolio (>=25% / >=40% "
            "respectively). Sector labels for unmapped tickers come from a deterministic fallback, "
            "not fundamentals — flagged as quality=synthetic when that happens. Optional portfolio_id.",
            parameters={
                "type": "object",
                "properties": {
                    "portfolio_id": {"type": "string", "description": "Optional portfolio identifier."},
                },
            },
            handler=_get_exposure_breakdown_handler,
            read_only=True,
            write_class="none",
        ),
    ]
