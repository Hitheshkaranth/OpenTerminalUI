from __future__ import annotations

import asyncio
import re
import string
from datetime import date, datetime, timedelta, timezone
from typing import Any

from backend.equity.services.corporate_actions import corporate_actions_service
from backend.equity.services.earnings import earnings_service
from backend.fno.routes.expiry import expiry_dashboard
from backend.services.economic_data import get_economic_data_service

ALLOWED_TYPES = ("earnings", "dividend", "corporate", "expiry", "macro")

_TYPE_MAP = {
    "corporate": ("split", "bonus", "rights", "corporate"),
    "dividend": ("dividend",),
}


def make_event_id(type_: str, symbol: str | None, date_str: str, title: str) -> str:
    """Contract 6: "<type>:<symbol|GLOBAL>:<date>:<slug>". Only the slug is capped
    (40 chars) — capping the whole id made same-day events with a long shared
    prefix collide and get deduped away."""
    slug = _clean_slug(title)[:40].strip("-")
    return f"{type_}:{(symbol or 'GLOBAL').upper()}:{date_str}:{slug}"


def _clean_slug(value: str) -> str:
    s = value.lower()
    s = "".join(c if c in string.ascii_lowercase + string.digits else "-" for c in s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


async def get_upcoming_events(
    symbols: list[str],
    days: int = 30,
    types: set[str] | None = None,
) -> dict[str, Any]:
    allowed = types or set(ALLOWED_TYPES)

    # Expand user-friendly type names to actual event types
    expanded: set[str] = set()
    for t in allowed:
        if t in _TYPE_MAP:
            expanded.update(_TYPE_MAP[t])
        else:
            expanded.add(t)

    today = datetime.now(timezone.utc).date()
    cutoff = today + timedelta(days=max(1, days))

    items: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    has_symbols = bool(symbols)

    # --- Source dispatch ---
    # When symbols are empty AND types includes earnings/dividend/corporate,
    # skip symbol-bound sources (no universe scan).
    needs_earnings = bool(has_symbols and "earnings" in expanded)
    needs_corporate_actions = bool(has_symbols and ("dividend" in expanded or "corporate" in expanded))
    needs_expiry = "expiry" in expanded
    needs_macro = "macro" in expanded

    # --- Fetch all four sources concurrently ---
    earnings_fut = asyncio.create_task(
        asyncio.wait_for(earnings_service.get_portfolio_earnings(symbols, days), timeout=6.0)
    ) if needs_earnings else None

    corporate_fut = asyncio.create_task(
        asyncio.wait_for(
            corporate_actions_service.get_portfolio_events(symbols, days), timeout=6.0
        )
    ) if needs_corporate_actions else None

    expiry_fut = asyncio.create_task(
        asyncio.wait_for(expiry_dashboard(), timeout=6.0)
    ) if needs_expiry else None

    macro_fut = asyncio.create_task(
        asyncio.wait_for(
            get_economic_data_service().get_economic_calendar(
                today.isoformat(), cutoff.isoformat()
            ),
            timeout=6.0,
        )
    ) if needs_macro else None

    futures = {
        "earnings": (earnings_fut, _parse_earnings, "earnings_service"),
        "corporate_actions": (corporate_fut, _parse_corporate, "corporate_actions"),
        "expiry": (expiry_fut, _parse_expiry, "fno"),
        "macro": (macro_fut, _parse_macro, "economics"),
    }

    for source_name, (fut, parser, source_label) in futures.items():
        if fut is None:
            continue
        try:
            result = await fut
            parsed = parser(result, symbols, today, cutoff, expanded)
            items.extend(parsed)
        except asyncio.TimeoutError:
            errors.append({"source": source_label, "reason": "timed out after 6s"})
        except Exception as exc:
            errors.append({"source": source_label, "reason": (str(exc) or exc.__class__.__name__)[:200]})

    # --- Date window filter (a malformed date from one source drops that item only) ---
    def _in_window(item: dict[str, Any]) -> bool:
        try:
            return today <= date.fromisoformat(str(item["date"])) <= cutoff
        except (ValueError, TypeError):
            return False

    items = [item for item in items if _in_window(item)]

    # --- Type filter (post-date) ---
    if types:
        items = [item for item in items if item["type"] in expanded]

    # --- Impact sort ---
    _impact_order = {"high": 0, "medium": 1, "low": 2, "neutral": 3}
    items.sort(key=lambda x: (
        x["date"],
        _impact_order.get(x["impact"], 3),
        x["symbol"] or "",
    ))

    # --- Dedupe by id (keep first) ---
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for item in items:
        if item["id"] not in seen:
            seen.add(item["id"])
            deduped.append(item)

    return {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "days": days,
        "symbols": [s.upper() for s in symbols],
        "items": deduped,
        "errors": errors,
    }


def _parse_earnings(result: Any, symbols: list[str], *_) -> list[dict[str, Any]]:
    if not isinstance(result, list):
        return []
    out: list[dict[str, Any]] = []
    for e in result:
        sym = getattr(e, "symbol", None) or (isinstance(e, dict) and e.get("symbol"))
        title = f"{getattr(e, 'fiscal_quarter', '')} earnings"
        out.append({
            "id": make_event_id("earnings", sym, str(getattr(e, "earnings_date", "")), title),
            "type": "earnings",
            "symbol": sym,
            "title": title,
            "date": str(getattr(e, "earnings_date", "")),
            "time": getattr(e, "time", "unknown") if getattr(e, "time", "unknown") in ("bmo", "amc") else None,
            "impact": "high",
            "source": "earnings_service",
            "detail": {
                "estimated_eps": getattr(e, "estimated_eps", None),
                "company_name": getattr(e, "company_name", ""),
                "fiscal_year": getattr(e, "fiscal_year", None),
            },
        })
    return out


def _parse_corporate(result: Any, *_) -> list[dict[str, Any]]:
    if not isinstance(result, list):
        return []
    allowed_impacts = ("high", "medium", "low", "neutral")
    out: list[dict[str, Any]] = []
    for e in result:
        et = getattr(e, "event_type", None)
        if hasattr(et, "value"):
            raw_type = et.value
        else:
            raw_type = str(et) if et else "corporate"
        type_map = {
            "dividend": "dividend",
            "split": "split",
            "bonus": "bonus",
            "rights": "rights",
        }
        mapped_type = type_map.get(raw_type, "corporate")
        evt_date = getattr(e, "ex_date", None) or getattr(e, "event_date", None)
        date_val = str(evt_date) if evt_date else str(getattr(e, "event_date", ""))
        imp = getattr(e, "impact", "neutral")
        if not isinstance(imp, str) or imp not in allowed_impacts:
            imp = "neutral"
        sym = getattr(e, "symbol", None) or (isinstance(e, dict) and e.get("symbol"))
        title = getattr(e, "title", "Corporate event")
        out.append({
            "id": make_event_id(mapped_type, sym, date_val, title),
            "type": mapped_type,
            "symbol": sym,
            "title": title,
            "date": date_val,
            "time": None,
            "impact": imp,
            "source": "corporate_actions",
            "detail": {
                "ex_date": str(getattr(e, "ex_date", "")) if getattr(e, "ex_date", None) else None,
                "record_date": str(getattr(e, "record_date", "")) if getattr(e, "record_date", None) else None,
                "payment_date": str(getattr(e, "payment_date", "")) if getattr(e, "payment_date", None) else None,
                "value": getattr(e, "value", None),
                "url": getattr(e, "url", None),
                "description": getattr(e, "description", ""),
            },
        })
    return out


def _parse_expiry(result: Any, symbols: list[str], *_, expanded: set[str] | None = None, **kw) -> list[dict[str, Any]]:
    if not isinstance(result, dict):
        return []
    raw_items = result.get("items", [])
    symbols_set = set(s.upper() for s in symbols) if symbols else set()
    has_symbols = bool(symbols_set)
    out: list[dict[str, Any]] = []
    for item in raw_items:
        sym = item.get("symbol", "")
        if isinstance(sym, str):
            sym = sym.upper()
        # Always include NIFTY/BANKNIFTY; additionally include symbol-bound entries
        if has_symbols and sym not in symbols_set and sym not in ("NIFTY", "BANKNIFTY"):
            continue
        try:
            exp_date = date.fromisoformat(str(item.get("expiry_date", "")))
        except (ValueError, TypeError):
            continue
        title = f"{sym} expiry"
        out.append({
            "id": make_event_id("expiry", sym, str(exp_date), title),
            "type": "expiry",
            "symbol": sym,
            "title": title,
            "date": str(exp_date),
            "time": None,
            "impact": "medium" if sym in ("NIFTY", "BANKNIFTY") else "low",
            "source": "fno",
            "detail": {
                "days_to_expiry": item.get("days_to_expiry", 0),
            },
        })
    return out


def _parse_macro(result: Any, *_) -> list[dict[str, Any]]:
    if not isinstance(result, list):
        return []
    allowed_impacts = ("high", "medium", "low", "neutral")
    out: list[dict[str, Any]] = []
    for row in result:
        if not isinstance(row, dict):
            continue
        country = row.get("country", "") or ""
        event_name = row.get("event_name", "") or ""
        title = f"{country} {event_name}".strip()
        if not title:
            continue
        time_val = row.get("time", "")
        if isinstance(time_val, str) and re.match(r"^\d{2}:\d{2}(:\d{2})?$", time_val) and time_val != "00:00:00":
            time_out = time_val
        else:
            time_out = None
        raw_impact = row.get("impact", "medium")
        if isinstance(raw_impact, str) and raw_impact.lower() in allowed_impacts:
            imp = raw_impact.lower()
        else:
            imp = "medium"
        date_str = str(row.get("date", ""))
        if not date_str:
            continue
        out.append({
            "id": make_event_id("macro", None, date_str, title),
            "type": "macro",
            "symbol": None,
            "title": title,
            "date": date_str,
            "time": time_out,
            "impact": imp,
            "source": "economics",
            "detail": {
                "country": country,
                "raw": dict(row),
            },
        })
    # Cap at 60 items, highest impact first
    _impact_order = {"high": 0, "medium": 1, "low": 2, "neutral": 3}
    out.sort(key=lambda x: _impact_order.get(x["impact"], 3))
    return out[:60]