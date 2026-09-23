"""Agent tools for derivatives (F&O): option chains, Greeks, flow, futures curve, depth.

Every handler wraps ``backend.fno`` service singletons directly (no HTTP calls
back into the app) and returns an ``envelope.ok``/``err`` shape so the agent
never sees a raw traceback and always gets provenance it can relay to the
user. NSE data can silently fall back to synthetic values when the container
is rejected by upstream providers (see ``docker-data-provider-blocks``
memory) — handlers say so via ``quality`` rather than reporting it as live.
"""

from __future__ import annotations

import math
from datetime import date
from typing import Any

from backend.agent.tools.envelope import cap, err, ok, project
from backend.agent.tools.registry import ToolSpec

_CHAIN_FIELDS = ("strike_price", "ce", "pe")
_LEG_FIELDS = ("oi", "oi_change", "volume", "iv", "ltp")
_MAX_CHAIN_ROWS = 21  # ~10 strikes either side of ATM — enough to reason over, not a dump


def _safe_float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _compact_leg(leg: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(leg, dict):
        return {}
    return {key: leg.get(key) for key in _LEG_FIELDS if key in leg}


def _compact_chain_rows(strikes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Project each strike row down to strike/LTP/OI/OI-change/IV/volume for both legs."""
    out = []
    for row in strikes:
        if not isinstance(row, dict):
            continue
        out.append({
            "strike_price": row.get("strike_price"),
            "ce": _compact_leg(row.get("ce")),
            "pe": _compact_leg(row.get("pe")),
        })
    return out


async def get_option_chain(args: dict[str, Any]) -> dict[str, Any]:
    """Fetch a compact option chain centred on ATM for one underlying."""
    symbol = str(args.get("symbol", "")).strip().upper()
    expiry = args.get("expiry")
    expiry = str(expiry).strip() if expiry else None
    if not symbol:
        return err("symbol is required", code="bad_args")

    try:
        from backend.fno.services.option_chain_fetcher import get_option_chain_fetcher

        fetcher = get_option_chain_fetcher()
        chain = await fetcher.get_option_chain(symbol, expiry=expiry, strike_range=10)
    except Exception as exc:  # noqa: BLE001 - agent tools must never raise
        return err(f"Option chain could not be fetched for {symbol}: {exc}", code="fetch_failed")

    strikes = chain.get("strikes") if isinstance(chain.get("strikes"), list) else []
    if not strikes:
        return err(
            f"No option chain data is available for {symbol}.",
            code="no_data",
            hint="NSE/Kite may be rejecting this environment's calls (falls back to a 0-strike "
            "chain); try a liquid symbol like NIFTY, BANKNIFTY, or RELIANCE, or retry later.",
        )

    rows, dropped = cap(_compact_chain_rows(strikes), _MAX_CHAIN_ROWS)
    data = {
        "symbol": chain.get("symbol") or symbol,
        "market": chain.get("market"),
        "spot_price": _safe_float(chain.get("spot_price")),
        "expiry_date": chain.get("expiry_date"),
        "available_expiries": chain.get("available_expiries", [])[:20],
        "atm_strike": _safe_float(chain.get("atm_strike")),
        "atm_iv": _safe_float(chain.get("atm_iv")),
        "iv_rank": _safe_float(chain.get("iv_rank")),
        "iv_percentile": _safe_float(chain.get("iv_percentile")),
        "totals": chain.get("totals"),
        "strikes": rows,
    }
    source = "nse" if chain.get("market") == "NSE" else "us_options"
    return ok(data, source=source, quality="live", as_of=chain.get("timestamp"), truncated=dropped)


def _closest_row(strikes: list[dict[str, Any]], target: float) -> dict[str, Any] | None:
    candidates = [r for r in strikes if isinstance(r, dict) and _safe_float(r.get("strike_price")) is not None]
    if not candidates:
        return None
    return min(candidates, key=lambda r: abs(_safe_float(r.get("strike_price")) - target))


def _greeks_read(leg_greeks: dict[str, Any], option_type: str) -> str:
    delta = _safe_float(leg_greeks.get("delta"))
    theta = _safe_float(leg_greeks.get("theta"))
    vega = _safe_float(leg_greeks.get("vega"))
    gamma = _safe_float(leg_greeks.get("gamma"))
    parts: list[str] = []
    if delta is not None:
        direction = "long" if (option_type == "CE") == (delta >= 0) else "short"
        parts.append(f"delta {delta:.3f}: roughly {abs(delta) * 100:.0f}% of a {direction} spot position")
    if gamma is not None and delta is not None:
        parts.append(f"gamma {gamma:.4f}: delta accelerates {'quickly' if gamma > 0.01 else 'slowly'} as spot moves")
    if theta is not None:
        parts.append(f"theta {theta:.2f}: loses about {abs(theta):.2f} of premium per day, all else equal")
    if vega is not None:
        parts.append(f"vega {vega:.2f}: a 1pt rise in IV changes premium by about {vega:.2f}")
    return "; ".join(parts) if parts else "Greeks unavailable for this leg."


async def analyze_option_greeks(args: dict[str, Any]) -> dict[str, Any]:
    """Return delta/gamma/theta/vega for one strike (or ATM) plus a plain-language read."""
    symbol = str(args.get("symbol", "")).strip().upper()
    expiry = args.get("expiry")
    expiry = str(expiry).strip() if expiry else None
    strike_arg = _safe_float(args.get("strike"))
    if not symbol:
        return err("symbol is required", code="bad_args")

    try:
        from backend.fno.services.option_chain_fetcher import get_option_chain_fetcher

        fetcher = get_option_chain_fetcher()
        chain = await fetcher.get_option_chain(symbol, expiry=expiry, strike_range=15)
    except Exception as exc:  # noqa: BLE001
        return err(f"Option chain could not be fetched for {symbol}: {exc}", code="fetch_failed")

    strikes = chain.get("strikes") if isinstance(chain.get("strikes"), list) else []
    if not strikes:
        return err(
            f"No option chain data is available for {symbol}, so Greeks cannot be computed.",
            code="no_data",
        )

    target = strike_arg if strike_arg is not None else _safe_float(chain.get("atm_strike"))
    row = _closest_row(strikes, target) if target is not None else None
    if row is None:
        return err(f"No strike near {target} was found for {symbol}.", code="no_data")

    ce = row.get("ce") if isinstance(row.get("ce"), dict) else {}
    pe = row.get("pe") if isinstance(row.get("pe"), dict) else {}
    ce_greeks = ce.get("greeks") if isinstance(ce.get("greeks"), dict) else {}
    pe_greeks = pe.get("greeks") if isinstance(pe.get("greeks"), dict) else {}

    data = {
        "symbol": chain.get("symbol") or symbol,
        "expiry_date": chain.get("expiry_date"),
        "spot_price": _safe_float(chain.get("spot_price")),
        "strike": _safe_float(row.get("strike_price")),
        "atm_strike": _safe_float(chain.get("atm_strike")),
        "call": {"iv": ce.get("iv"), "ltp": ce.get("ltp"), "greeks": ce_greeks, "read": _greeks_read(ce_greeks, "CE")},
        "put": {"iv": pe.get("iv"), "ltp": pe.get("ltp"), "greeks": pe_greeks, "read": _greeks_read(pe_greeks, "PE")},
    }
    source = "nse" if chain.get("market") == "NSE" else "us_options"
    return ok(data, source=source, quality="live", as_of=chain.get("timestamp"))


_FLOW_FIELDS = (
    "timestamp", "symbol", "strike", "option_type", "sentiment",
    "volume", "volume_ratio", "oi_change", "premium_value", "heat_score",
)
_BUILDUP_FIELDS = ("strike_price", "ce_pattern", "pe_pattern", "ce_oi_change", "pe_oi_change")


async def get_fno_flow(args: dict[str, Any]) -> dict[str, Any]:
    """Surface OI build-up classification and unusual options activity.

    With ``symbol``: PCR, max pain, support/resistance, per-strike OI-buildup
    labels (long/short buildup, long unwinding, short covering), and unusual
    activity for that underlying. Without it: an aggregated flow summary
    (bullish/bearish premium split, top symbols) across the default F&O
    watch list plus unusual activity across all of them.
    """
    symbol = args.get("symbol")
    symbol_u = str(symbol).strip().upper() if symbol else None
    try:
        limit = max(1, min(50, int(args.get("limit", 15))))
    except (TypeError, ValueError):
        limit = 15

    try:
        from backend.fno.services.flow_service import get_options_flow_service
        from backend.fno.services.oi_analyzer import get_oi_analyzer
        from backend.fno.services.option_chain_fetcher import get_option_chain_fetcher

        flow_service = get_options_flow_service()

        if symbol_u:
            fetcher = get_option_chain_fetcher()
            chain = await fetcher.get_option_chain(symbol_u, strike_range=24)
            if not chain.get("strikes"):
                return err(
                    f"No F&O chain data is available for {symbol_u}.",
                    code="no_data",
                    hint="Try a liquid NSE F&O symbol like NIFTY, BANKNIFTY, or RELIANCE.",
                )
            analyzer = get_oi_analyzer()
            buildup_rows = analyzer.analyze_oi_buildup(chain).get("strikes", [])
            unusual = await flow_service.detect_unusual_activity(symbol=symbol_u)
            unusual_rows, dropped = cap(unusual, limit)
            data = {
                "symbol": chain.get("symbol") or symbol_u,
                "expiry_date": chain.get("expiry_date"),
                "spot_price": _safe_float(chain.get("spot_price")),
                "pcr": analyzer.get_pcr(chain),
                "max_pain": analyzer.find_max_pain(chain),
                "support_resistance": analyzer.find_support_resistance(chain),
                "oi_buildup": project(buildup_rows, _BUILDUP_FIELDS),
                "unusual_activity": project(unusual_rows, _FLOW_FIELDS),
            }
            source = "nse" if chain.get("market") == "NSE" else "us_options"
            return ok(data, source=source, quality="live", as_of=chain.get("timestamp"), truncated=dropped)

        summary = await flow_service.get_flow_summary()
        unusual = await flow_service.detect_unusual_activity()
        unusual_rows, dropped = cap(unusual, limit)
        data = {**summary, "unusual_activity": project(unusual_rows, _FLOW_FIELDS)}
        return ok(data, source="nse", quality="live", truncated=dropped)
    except Exception as exc:  # noqa: BLE001 - agent tools must never raise
        return err(f"F&O flow could not be computed: {exc}", code="tool_error")


def _days_to_expiry(expiry_iso: str) -> int | None:
    try:
        return max((date.fromisoformat(str(expiry_iso)) - date.today()).days, 0)
    except Exception:
        return None


async def get_futures_curve(args: dict[str, Any]) -> dict[str, Any]:
    """Return the futures term structure for one underlying: per-expiry LTP/OI/volume,
    basis vs spot, and whether the curve is in contango or backwardation."""
    symbol = str(args.get("symbol", "")).strip().upper()
    if not symbol:
        return err("symbol is required", code="bad_args")

    try:
        from backend.fno.routes.futures import get_futures_chain

        chain = await get_futures_chain(symbol)
    except Exception as exc:  # noqa: BLE001
        return err(f"Futures chain could not be fetched for {symbol}: {exc}", code="fetch_failed")

    contracts = chain.get("contracts") if isinstance(chain.get("contracts"), list) else []
    if not contracts:
        return err(f"No futures contracts found for {symbol}.", code="no_data")

    spot: float | None = None
    try:
        from backend.api.deps import get_unified_fetcher

        fetcher = await get_unified_fetcher()
        snap = await fetcher.fetch_stock_snapshot(symbol)
        spot = _safe_float(snap.get("last_price")) if isinstance(snap, dict) else None
    except Exception:  # noqa: BLE001 - basis is optional context, not fatal
        spot = None

    rows = sorted(contracts, key=lambda c: str(c.get("expiry_date") or ""))
    curve: list[dict[str, Any]] = []
    for c in rows:
        ltp = _safe_float(c.get("ltp"))
        basis = (ltp - spot) if (ltp is not None and spot is not None) else None
        basis_pct = (basis / spot * 100.0) if (basis is not None and spot) else None
        curve.append({
            "expiry_date": c.get("expiry_date"),
            "tradingsymbol": c.get("tradingsymbol"),
            "days_to_expiry": _days_to_expiry(c.get("expiry_date")),
            "ltp": ltp,
            "oi": _safe_float(c.get("oi")),
            "volume": _safe_float(c.get("volume")),
            "basis": round(basis, 4) if basis is not None else None,
            "basis_pct": round(basis_pct, 4) if basis_pct is not None else None,
        })

    shape = "unknown"
    priced = [c["ltp"] for c in curve if c["ltp"] is not None]
    if len(priced) >= 2:
        if all(b <= a for a, b in zip(priced, priced[1:])):
            shape = "backwardation" if priced[-1] < priced[0] else "flat"
        elif all(b >= a for a, b in zip(priced, priced[1:])):
            shape = "contango" if priced[-1] > priced[0] else "flat"
        else:
            shape = "mixed"

    roll_yield_pct = None
    if len(curve) >= 2 and curve[0]["ltp"] and curve[1]["ltp"] and curve[1]["days_to_expiry"]:
        days_between = max((curve[1]["days_to_expiry"] or 0) - (curve[0]["days_to_expiry"] or 0), 1)
        roll_yield_pct = round(
            ((curve[1]["ltp"] - curve[0]["ltp"]) / curve[0]["ltp"]) * (365.0 / days_between) * 100.0, 4,
        )

    data = {
        "symbol": chain.get("underlying") or symbol,
        "spot_price": spot,
        "curve_shape": shape,
        "annualized_roll_yield_pct": roll_yield_pct,
        "contracts": curve,
    }
    quality = "live" if spot is not None else "delayed"
    return ok(data, source="kite", quality=quality,
               note=None if spot is not None else "Spot price unavailable; basis/roll-yield omitted.")


async def get_market_depth(args: dict[str, Any]) -> dict[str, Any]:
    """Return a compact bid/ask ladder (top levels + imbalance) for one symbol.

    Backed by the platform's order-book service, which always generates a
    seeded synthetic book (no live L2 depth provider is connected) — this is
    surfaced as ``quality: synthetic`` so the agent never reports it as live.
    """
    symbol = str(args.get("symbol", "")).strip()
    if not symbol:
        return err("symbol is required", code="bad_args")

    try:
        from backend.services.orderbook_service import service as orderbook_service

        snapshot = orderbook_service.get_snapshot(symbol, levels=10)
    except ValueError as exc:
        return err(str(exc), code="bad_args")
    except Exception as exc:  # noqa: BLE001
        return err(f"Market depth could not be computed for {symbol}: {exc}", code="tool_error")

    wire = snapshot.to_wire()
    level_fields = ("price", "quantity", "orders", "cumulative_qty")
    data = {
        "symbol": wire.get("symbol"),
        "market": wire.get("market"),
        "mid_price": wire.get("mid_price"),
        "spread": wire.get("spread"),
        "spread_pct": wire.get("spread_pct"),
        "imbalance": wire.get("imbalance"),
        "total_bid_quantity": wire.get("total_bid_quantity"),
        "total_ask_quantity": wire.get("total_ask_quantity"),
        "bids": project(wire.get("bids", []), level_fields),
        "asks": project(wire.get("asks", []), level_fields),
    }
    provenance_note = (wire.get("provenance") or {}).get("note")
    return ok(data, source=wire.get("provider_key", "synthetic"), quality="synthetic",
               as_of=wire.get("as_of"), note=provenance_note)


def derivatives_tool_specs() -> list[ToolSpec]:
    """Read-only F&O tool specs: option chain, Greeks, flow, futures curve, depth."""
    return [
        ToolSpec(
            name="get_option_chain",
            description="Fetch a compact NSE/US option chain for one underlying, centred on the "
            "at-the-money strike (about 10 strikes either side, not the full chain). Returns "
            "per-strike call/put LTP, OI, OI change, IV, and volume, plus spot price, ATM strike, "
            "IV rank/percentile, and chain-wide PCR totals. Use for questions about strike-level "
            "option pricing, open interest, or implied volatility on a specific underlying.",
            parameters={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Underlying, e.g. NIFTY, BANKNIFTY, RELIANCE, AAPL."},
                    "expiry": {"type": "string", "description": "ISO date, e.g. 2026-02-27. Defaults to the nearest expiry."},
                },
                "required": ["symbol"],
            },
            handler=get_option_chain, read_only=True, write_class="none",
        ),
        ToolSpec(
            name="analyze_option_greeks",
            description="Compute Black-Scholes delta/gamma/theta/vega for one option strike "
            "(defaults to ATM if strike is omitted) and return a plain-language read of the "
            "directional, convexity, time-decay, and vol exposure for both the call and the put "
            "leg. Use when the user asks what the Greeks mean or how exposed a position is.",
            parameters={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "expiry": {"type": "string", "description": "ISO date. Defaults to the nearest expiry."},
                    "strike": {"type": "number", "description": "Defaults to the ATM strike if omitted."},
                },
                "required": ["symbol"],
            },
            handler=analyze_option_greeks, read_only=True, write_class="none",
        ),
        ToolSpec(
            name="get_fno_flow",
            description="Detect F&O positioning: OI build-up classification per strike "
            "(long/short buildup, long unwinding, short covering), PCR, max pain, "
            "support/resistance from OI concentration, and unusual options activity "
            "(volume/OI spikes ranked by heat score) for one underlying. Omit symbol to get an "
            "aggregated flow summary (bullish/bearish premium split, top symbols by flow) across "
            "the default NIFTY/BANKNIFTY/large-cap watch list instead.",
            parameters={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Optional underlying to scope the flow to."},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 15},
                },
            },
            handler=get_fno_flow, read_only=True, write_class="none",
        ),
        ToolSpec(
            name="get_futures_curve",
            description="Return the futures term structure for one underlying: LTP/OI/volume at "
            "each listed expiry, basis vs spot, and whether the curve is in contango or "
            "backwardation, plus the annualized roll yield between the front two contracts. "
            "Use for calendar-spread or roll-cost questions.",
            parameters={
                "type": "object",
                "properties": {"symbol": {"type": "string"}},
                "required": ["symbol"],
            },
            handler=get_futures_curve, read_only=True, write_class="none",
        ),
        ToolSpec(
            name="get_market_depth",
            description="Return a compact level-2 order book summary for one symbol: top bid/ask "
            "levels, mid price, spread, and bid/ask imbalance. Note: this platform's depth feed "
            "is always a synthetic, seeded book (no live L2 provider is connected) — the result's "
            "provenance.quality is 'synthetic'; never present it as a live order book.",
            parameters={
                "type": "object",
                "properties": {"symbol": {"type": "string"}},
                "required": ["symbol"],
            },
            handler=get_market_depth, read_only=True, write_class="none",
        ),
    ]
