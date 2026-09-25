"""Agent tools for cross-asset and macro data: calendar, commodities/forex/crypto/bonds,
sector heatmap, ETF profile, yield curve.

Same house rules as ``derivatives_tools.py``: reuse the existing service layer
directly, never make an HTTP call back into the app, and always return an
``envelope.ok``/``err`` shape. Several of these services (the bond screener,
the order-book-style synthetic feeds) are permanently mock data in this
codebase — handlers say so via ``quality="synthetic"`` rather than letting the
agent present it as live.
"""

from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any

from backend.agent.tools.envelope import cap, err, ok, project
from backend.agent.tools.registry import ToolSpec


def _safe_float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


_CALENDAR_FIELDS = ("date", "time", "country", "event_name", "impact", "actual", "forecast", "previous", "unit", "currency")


async def get_economic_calendar(args: dict[str, Any]) -> dict[str, Any]:
    """Return upcoming economic releases, optionally filtered to one country."""
    try:
        days = max(1, min(90, int(args.get("days", 14))))
    except (TypeError, ValueError):
        days = 14
    country = args.get("country")
    country_u = str(country).strip().upper() if country else None

    try:
        from backend.services.economic_data import get_economic_data_service

        service = get_economic_data_service()
        start = date.today()
        end = start + timedelta(days=days)
        events = await service.get_economic_calendar(start.isoformat(), end.isoformat())
    except Exception as exc:  # noqa: BLE001 - agent tools must never raise
        return err(f"Economic calendar could not be fetched: {exc}", code="tool_error")

    rows = [e for e in events if isinstance(e, dict)]
    if country_u:
        rows = [e for e in rows if str(e.get("country") or "").strip().upper() == country_u]

    kept, dropped = cap(rows, 50)
    # Provenance: Finnhub/FMP need a key; without one the service falls back to the free
    # FXMacroData feed (still real data) or, if that call itself fails, two mock rows.
    if service.finnhub_key or service.fmp_key:
        source, quality = "finnhub" if service.finnhub_key else "fmp", "live"
    else:
        source, quality = "fxmacrodata", "delayed"
    data = {"days": days, "country": country_u, "count": len(rows), "events": project(kept, _CALENDAR_FIELDS)}
    note = None if rows else "No matching events. Try a wider day range or drop the country filter."
    return ok(data, source=source, quality=quality, truncated=dropped, note=note)


async def _quote_commodity(symbol_u: str) -> dict[str, Any] | None:
    from backend.services.commodity_service import get_commodities_service

    resp = await get_commodities_service().get_quotes()
    for category in resp.categories:
        for item in category.items:
            if item.symbol.upper() == symbol_u:
                return {
                    "symbol": item.symbol, "name": item.name, "category": category.id,
                    "price": item.price, "change": item.change, "change_pct": item.change_pct,
                    "volume": item.volume, "currency": item.currency, "source": item.source,
                }
    return None


async def _quote_forex(symbol_u: str) -> dict[str, Any] | None:
    from backend.services.forex_service import service as forex_service

    try:
        chart = await forex_service.get_pair_chart(symbol_u)
    except (ValueError, RuntimeError):
        return None
    return {
        "symbol": chart.get("pair"), "base_currency": chart.get("base_currency"),
        "quote_currency": chart.get("quote_currency"), "rate": _safe_float(chart.get("current_rate")),
        "as_of": chart.get("as_of"),
    }


async def _quote_crypto(symbol_u: str) -> dict[str, Any] | None:
    from backend.api.routes.crypto import _load_rows

    rows = await _load_rows(limit=300)
    for row in rows:
        if row.symbol.upper() == symbol_u:
            return {
                "symbol": row.symbol, "name": row.name, "price": row.price,
                "change_24h": row.change_24h, "volume_24h": row.volume_24h,
                "market_cap": row.market_cap, "sector": row.sector,
            }
    return None


async def _quote_bond(symbol_u: str) -> dict[str, Any] | None:
    from backend.services.bond_service import get_bond_service

    bonds = await get_bond_service().get_bond_screener()
    for b in bonds:
        if symbol_u in (str(b.get("isin") or "")).upper() or symbol_u in str(b.get("issuer") or "").upper():
            return b
    return None


_ASSET_QUOTERS = {"commodity": _quote_commodity, "forex": _quote_forex, "crypto": _quote_crypto, "bond": _quote_bond}
# Bond data here is always a small hardcoded screener list — never live.
_SYNTHETIC_CLASSES = {"bond"}


async def get_cross_asset_quote(args: dict[str, Any]) -> dict[str, Any]:
    """One quote lookup across commodity/forex/crypto/bond, instead of four separate tools."""
    symbol = str(args.get("symbol", "")).strip()
    asset_class = str(args.get("asset_class", "")).strip().lower()
    if not symbol:
        return err("symbol is required", code="bad_args")
    quoter = _ASSET_QUOTERS.get(asset_class)
    if quoter is None:
        return err(
            f"Unsupported asset_class {asset_class!r}.", code="bad_args",
            hint="asset_class must be one of: commodity, forex, crypto, bond.",
        )

    try:
        row = await quoter(symbol.upper())
    except Exception as exc:  # noqa: BLE001 - agent tools must never raise
        return err(f"{asset_class} quote could not be fetched for {symbol}: {exc}", code="tool_error")

    if row is None:
        return err(f"No {asset_class} quote found for {symbol!r}.", code="no_data")

    quality = "synthetic" if asset_class in _SYNTHETIC_CLASSES else "live"
    return ok({"asset_class": asset_class, **row}, source=asset_class, quality=quality)


_HEATMAP_FIELDS = ("symbol", "name", "sector", "industry", "price", "change_pct", "volume", "market_cap")


async def get_sector_heatmap(args: dict[str, Any]) -> dict[str, Any]:
    """Return sector performance ranked by change%, with leaders and laggards called out."""
    market = str(args.get("market", "IN")).strip().upper()
    if market not in ("IN", "US"):
        market = "IN"
    timeframe = str(args.get("timeframe", "1d")).strip().lower()
    if timeframe not in ("1d", "1w", "1m", "3m", "ytd", "1y"):
        timeframe = "1d"

    try:
        from backend.api.routes.heatmap import heatmap_treemap

        result = await heatmap_treemap(market=market, group="sector", period=timeframe, size_by="market_cap")
    except Exception as exc:  # noqa: BLE001
        return err(f"Sector heatmap could not be computed: {exc}", code="tool_error")

    rows = result.get("data") if isinstance(result.get("data"), list) else []
    groups = result.get("groups") if isinstance(result.get("groups"), list) else []
    sectors_ranked = sorted(
        ({"sector": g.get("name"), "value": g.get("value"),
          "avg_change_pct": _safe_float(sum(_safe_float(c.get("change_pct")) or 0.0 for c in g.get("children", []))
                                         / max(len(g.get("children", [])), 1))}
         for g in groups),
        key=lambda g: g["avg_change_pct"] or 0.0, reverse=True,
    )
    stocks_ranked = sorted(rows, key=lambda r: _safe_float(r.get("change_pct")) or 0.0, reverse=True)
    data = {
        "market": market, "timeframe": timeframe,
        "sectors_ranked": sectors_ranked,
        "leaders": project(stocks_ranked[:5], _HEATMAP_FIELDS),
        "laggards": project(list(reversed(stocks_ranked))[:5], _HEATMAP_FIELDS),
    }
    return ok(data, source="adapter", quality="live" if rows else "unavailable")


async def get_etf_profile(args: dict[str, Any]) -> dict[str, Any]:
    """Return an ETF's holdings concentration and, when known, its expense ratio/category."""
    ticker = str(args.get("symbol") or args.get("ticker", "")).strip().upper()
    if not ticker:
        return err("symbol is required", code="bad_args")

    try:
        from backend.api.routes.etf import etf_holdings, etf_screener

        holdings_resp = await etf_holdings(ticker)
        screener_rows = await etf_screener(category=None)
    except Exception as exc:  # noqa: BLE001
        return err(f"ETF profile could not be fetched for {ticker}: {exc}", code="tool_error")

    holdings = [{"symbol": h.symbol, "name": h.name, "weight": h.weight} for h in holdings_resp.holdings]
    holdings.sort(key=lambda h: h["weight"] or 0.0, reverse=True)
    top10_weight = round(sum(h["weight"] or 0.0 for h in holdings[:10]), 2)
    screener_row = next((r for r in screener_rows if str(r.get("ticker") or "").upper() == ticker), None)

    data = {
        "ticker": ticker,
        "expense_ratio": screener_row.get("expense_ratio") if screener_row else None,
        "category": screener_row.get("category") if screener_row else None,
        "aum": screener_row.get("aum") if screener_row else None,
        "top_10_weight_pct": top10_weight,
        "holdings_count": len(holdings),
        "top_holdings": holdings[:10],
    }
    note = None if screener_row else "Expense ratio/category not in the platform's tracked ETF list for this ticker."
    return ok(data, source="yahoo", quality="live" if holdings else "unavailable", note=note)


_YIELD_POINT_FIELDS = ("label", "yield", "date", "chg_1d", "chg_1w", "chg_1m", "chg_1y")


async def get_yield_curve(args: dict[str, Any]) -> dict[str, Any]:
    """Return the government bond yield curve plus 2s10s/5s30s/3m10y spreads and an inversion flag.

    Only the US Treasury curve (via FRED) is wired up; other countries return
    an error rather than silently substituting US data.
    """
    country = str(args.get("country", "US")).strip().upper() or "US"
    if country not in ("US", "USA"):
        return err(
            f"Yield curve for country={country!r} is not available.", code="unsupported",
            hint="Only country='US' is currently wired to a data source.",
        )

    try:
        from backend.services.fixed_income_service import get_fixed_income_service

        service = get_fixed_income_service()
        result = await service.get_yield_curve()
    except Exception as exc:  # noqa: BLE001
        return err(f"Yield curve could not be fetched: {exc}", code="tool_error")

    if "error" in result:
        return err(str(result["error"]), code="tool_error")

    points = result.get("data") if isinstance(result.get("data"), list) else []
    spreads = result.get("spreads") if isinstance(result.get("spreads"), dict) else {}
    inverted = bool(spreads.get("2s10s") is not None and spreads["2s10s"] < 0)
    data = {
        "country": "US", "as_of": result.get("date"),
        "points": project(points, _YIELD_POINT_FIELDS),
        "spreads": spreads, "inverted_2s10s": inverted,
    }
    if service.api_key and not result.get("mock"):
        return ok(data, source="fred", quality="live")
    if result.get("source") == "yahoo" and not result.get("mock"):
        return ok(
            data, source="yahoo", quality="live",
            note="FRED_API_KEY not configured — partial curve (3M/5Y/10Y/30Y) from Yahoo Treasury indices.",
        )
    return ok(data, source="mock", quality="synthetic", note="FRED_API_KEY not configured — mock yield curve returned.")


def macro_tool_specs() -> list[ToolSpec]:
    """Read-only cross-asset/macro tool specs: calendar, cross-asset quote, heatmap, ETF, yield curve."""
    return [
        ToolSpec(
            name="get_economic_calendar",
            description="List upcoming macro/economic releases (rate decisions, CPI, payrolls, "
            "PMI, etc.) over the next N days, with prior/forecast/actual values and an impact "
            "rating. Optionally filter to one country (e.g. 'US', 'IN'). Use for questions about "
            "what macro events are coming up or could move markets.",
            parameters={
                "type": "object",
                "properties": {
                    "days": {"type": "integer", "minimum": 1, "maximum": 90, "default": 14},
                    "country": {"type": "string", "description": "ISO-ish country code/name filter, e.g. US, IN."},
                },
            },
            handler=get_economic_calendar, read_only=True, write_class="none",
        ),
        ToolSpec(
            name="get_cross_asset_quote",
            description="Get a single quote for a non-equity instrument — one tool covering "
            "commodities, forex pairs, crypto, and bonds instead of four separate ones. Set "
            "asset_class to 'commodity' (e.g. symbol='GC=F' or 'gold'), 'forex' (symbol='EURUSD' "
            "or 'EUR/USD'), 'crypto' (symbol='BTC-USD'), or 'bond' (symbol=issuer name or ISIN — "
            "this platform's bond data is a small illustrative screener, always synthetic).",
            parameters={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "asset_class": {"type": "string", "enum": ["commodity", "forex", "crypto", "bond"]},
                },
                "required": ["symbol", "asset_class"],
            },
            handler=get_cross_asset_quote, read_only=True, write_class="none",
        ),
        ToolSpec(
            name="get_sector_heatmap",
            description="Rank sectors and stocks by price change over a timeframe for a market "
            "(IN or US), returning sectors ranked by average change plus the top-5 leader and "
            "laggard stocks. Use for 'what's leading/lagging today' or sector-rotation questions.",
            parameters={
                "type": "object",
                "properties": {
                    "market": {"type": "string", "enum": ["IN", "US"], "default": "IN"},
                    "timeframe": {"type": "string", "enum": ["1d", "1w", "1m", "3m", "ytd", "1y"], "default": "1d"},
                },
            },
            handler=get_sector_heatmap, read_only=True, write_class="none",
        ),
        ToolSpec(
            name="get_etf_profile",
            description="Get an ETF's top holdings with concentration (top-10 weight %), and, "
            "when the ticker is in the platform's tracked ETF list, its expense ratio, category, "
            "and AUM. Note: sector tilt is not available from this data source.",
            parameters={
                "type": "object",
                "properties": {"symbol": {"type": "string"}},
                "required": ["symbol"],
            },
            handler=get_etf_profile, read_only=True, write_class="none",
        ),
        ToolSpec(
            name="get_yield_curve",
            description="Return the government bond yield curve (1M through 30Y), the 2s10s/"
            "5s30s/3m10y spreads, and an inversion flag. Only country='US' (the default, via "
            "FRED) is currently wired up.",
            parameters={
                "type": "object",
                "properties": {"country": {"type": "string", "default": "US"}},
            },
            handler=get_yield_curve, read_only=True, write_class="none",
        ),
    ]
