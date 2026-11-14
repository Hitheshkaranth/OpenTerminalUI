"""Official NSE futures snapshots; no generated contracts or broker tokens."""
from __future__ import annotations

import asyncio
import math
from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from backend.shared.nse_session import NSESession


class NSEQuoteSession(NSESession):
    # The old /get-quotes/derivatives page redirects to this official site.
    BASE_URL = "https://www.nseindia.in"


_session = NSEQuoteSession()


def _number(value: Any) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def _expiry(value: Any) -> str:
    for fmt in ("%d-%b-%Y", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(str(value), fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def normalize_futures_snapshot(symbol: str, payload: dict[str, Any], *, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    timestamp = None
    try:
        timestamp = datetime.strptime(str(payload.get("timestamp")), "%d-%b-%Y %H:%M:%S").replace(tzinfo=ZoneInfo("Asia/Kolkata")).astimezone(timezone.utc).isoformat()
    except ValueError:
        pass
    contracts = []
    seen = set()
    rows = payload.get("data")
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or row.get("instrumentType") not in {"FUTIDX", "FUTSTK"}:
            continue
        if str(row.get("underlying", "")).upper() != symbol.upper():
            continue
        expiry = _expiry(row.get("expiryDate"))
        identifier = str(row.get("identifier") or "")
        if not expiry or expiry < today.isoformat() or not identifier or identifier in seen:
            continue
        seen.add(identifier)
        price = _number(row.get("lastPrice"))
        contracts.append({
            "expiry_date": expiry, "tradingsymbol": identifier, "provider_identifier": identifier,
            "exchange": "NFO", "ws_symbol": "", "instrument_token": None,
            "lot_size": None, "tick_size": _number(row.get("ticksize")),
            "ltp": price if price is not None and price > 0 else None,
            "change": _number(row.get("change")), "change_pct": _number(row.get("pchange")),
            "oi": _number(row.get("openInterest")), "volume": _number(row.get("totalTradedVolume")),
            "volume_unit": "contracts", "source": "nse_snapshot", "as_of": timestamp,
        })
    contracts.sort(key=lambda row: (row["expiry_date"], row["tradingsymbol"]))
    return {"underlying": symbol.upper(), "count": len(contracts), "contracts": contracts,
            "ws_symbols": [], "token_to_ws_symbol": {}, "source": "nse_snapshot",
            "as_of": timestamp, "data_status": "snapshot" if contracts else "unavailable"}


async def get_nse_futures_snapshot(symbol: str) -> dict[str, Any]:
    try:
        payload = await asyncio.to_thread(_session.get, "/api/NextApi/apiClient/GetQuoteApi",
                                          {"functionName": "getSymbolDerivativesData", "symbol": symbol.upper()})
    except Exception:
        payload = {}
    return normalize_futures_snapshot(symbol, payload)
