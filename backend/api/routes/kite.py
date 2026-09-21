from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from backend.core.kite_client import KiteClient

router = APIRouter()
kite = KiteClient()


_KITE_FAIL_HINT = (
    "Failed to fetch Kite {what}. The Kite access token expires daily — refresh "
    "KITE_ACCESS_TOKEN (or log in again via /api/kite/auth/login-url) and retry."
)


def _num(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


class KiteSessionRequest(BaseModel):
    request_token: str


def _token_or_401(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Use Authorization: Bearer <access_token>")
    return token.strip()

def _token_from_header_or_env(authorization: str | None) -> str:
    header_token = ""
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token:
            header_token = token.strip()
    access_token = kite.resolve_access_token(header_token)
    if not access_token:
        raise HTTPException(
            status_code=401,
            detail="Missing access token. Use Authorization: Bearer <access_token> or set KITE_ACCESS_TOKEN.",
        )
    return access_token

def _normalize_instrument(symbol: str) -> str:
    sym = symbol.strip().upper()
    return sym if ":" in sym else f"NSE:{sym}"

def _movement_payload(instrument: str, quote: dict[str, Any]) -> dict[str, Any]:
    ohlc = quote.get("ohlc") or {}
    ltp = quote.get("last_price")
    close = ohlc.get("close")
    change_pct = None
    try:
        if isinstance(ltp, (int, float)) and isinstance(close, (int, float)) and close:
            change_pct = ((ltp - close) / close) * 100.0
    except Exception:
        change_pct = None
    return {
        "instrument": instrument,
        "last_price": ltp,
        "open": ohlc.get("open"),
        "high": ohlc.get("high"),
        "low": ohlc.get("low"),
        "prev_close": close,
        "change_pct": change_pct,
        "volume": quote.get("volume"),
        "last_trade_time": quote.get("last_trade_time"),
    }


@router.get("/kite/auth/login-url")
async def kite_login_url(redirect_uri: str | None = Query(default=None)) -> dict[str, object]:
    if not kite.api_key:
        raise HTTPException(status_code=400, detail="KITE_API_KEY is not configured")
    return {
        "configured": kite.is_configured,
        "login_url": kite.get_login_url(redirect_uri=redirect_uri),
    }


@router.post("/kite/auth/session")
async def kite_create_session(payload: KiteSessionRequest) -> dict[str, object]:
    if not kite.is_configured:
        raise HTTPException(status_code=400, detail="KITE_API_KEY/KITE_API_SECRET are not configured")
    data = await kite.create_session(payload.request_token)
    if not data:
        raise HTTPException(status_code=502, detail="Failed to create Kite session")
    return data


@router.get("/kite/profile")
async def kite_profile(authorization: str | None = Header(default=None)) -> dict[str, object]:
    if not kite.api_key:
        raise HTTPException(status_code=400, detail="KITE_API_KEY is not configured")
    access_token = _token_or_401(authorization)
    data = await kite.get_profile(access_token)
    if not data:
        raise HTTPException(status_code=502, detail="Failed to fetch Kite profile")
    return data


@router.get("/kite/ltp")
async def kite_ltp(
    instruments: str = Query(..., description="Comma-separated list e.g. NSE:RELIANCE,NSE:TCS"),
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    if not kite.api_key:
        raise HTTPException(status_code=400, detail="KITE_API_KEY is not configured")
    access_token = _token_from_header_or_env(authorization)
    names = [x.strip() for x in instruments.split(",") if x.strip()]
    if not names:
        raise HTTPException(status_code=422, detail="At least one instrument is required")
    data = await kite.get_ltp(access_token, names)
    if not data:
        raise HTTPException(status_code=502, detail="Failed to fetch Kite LTP")
    return data


@router.get("/kite/latest/{symbol}")
async def kite_latest_symbol(
    symbol: str,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    if not kite.api_key:
        raise HTTPException(status_code=400, detail="KITE_API_KEY is not configured")
    access_token = _token_from_header_or_env(authorization)
    instrument = _normalize_instrument(symbol)
    data = await kite.get_quote(access_token, [instrument])
    quote_map = data.get("data") if isinstance(data, dict) else None
    if not isinstance(quote_map, dict):
        raise HTTPException(status_code=502, detail="Failed to fetch Kite latest quote")
    quote = quote_map.get(instrument)
    if not isinstance(quote, dict):
        raise HTTPException(status_code=404, detail=f"No quote found for {instrument}")
    return {
        "status": "ok",
        "source": "kite",
        "symbol": symbol.upper(),
        "instrument": instrument,
        "quote": _movement_payload(instrument, quote),
        "raw": quote,
    }


@router.get("/kite/latest")
async def kite_latest_many(
    symbols: str = Query(..., description="Comma-separated symbols/instruments e.g. RELIANCE,TCS or NSE:RELIANCE"),
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    if not kite.api_key:
        raise HTTPException(status_code=400, detail="KITE_API_KEY is not configured")
    access_token = _token_from_header_or_env(authorization)
    instruments = [_normalize_instrument(x) for x in symbols.split(",") if x.strip()]
    if not instruments:
        raise HTTPException(status_code=422, detail="At least one symbol is required")
    data = await kite.get_quote(access_token, instruments)
    quote_map = data.get("data") if isinstance(data, dict) else None
    if not isinstance(quote_map, dict):
        raise HTTPException(status_code=502, detail="Failed to fetch Kite latest quotes")

    items = []
    for instrument in instruments:
        quote = quote_map.get(instrument)
        if isinstance(quote, dict):
            items.append(_movement_payload(instrument, quote))
    return {"status": "ok", "source": "kite", "count": len(items), "items": items}


@router.get("/kite/holdings")
async def kite_holdings(
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    if not kite.api_key:
        raise HTTPException(status_code=400, detail="KITE_API_KEY is not configured")
    access_token = _token_from_header_or_env(authorization)
    raw = await kite.get_holdings(access_token)
    if raw is None:
        raise HTTPException(status_code=502, detail=_KITE_FAIL_HINT.format(what="holdings"))
    holdings = []
    for h in raw:
        qty = _num(h.get("quantity")) or 0.0
        t1 = _num(h.get("t1_quantity")) or 0.0
        holdings.append({
            "symbol": h.get("tradingsymbol"),
            "exchange": h.get("exchange"),
            "isin": h.get("isin"),
            "quantity": qty + t1,
            "average_price": _num(h.get("average_price")),
            "last_price": _num(h.get("last_price")),
            "pnl": _num(h.get("pnl")),
            "product": h.get("product"),
        })
    return {
        "source": "kite",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "holdings": holdings,
    }


@router.get("/kite/positions")
async def kite_positions(
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    if not kite.api_key:
        raise HTTPException(status_code=400, detail="KITE_API_KEY is not configured")
    access_token = _token_from_header_or_env(authorization)
    data = await kite.get_positions(access_token)
    if data is None:
        raise HTTPException(status_code=502, detail=_KITE_FAIL_HINT.format(what="positions"))
    net = data.get("net")
    if not isinstance(net, list):
        net = []
    positions = []
    for p in net:
        qty = _num(p.get("quantity")) or 0.0
        if qty > 0:
            side = "long"
        elif qty < 0:
            side = "short"
        else:
            side = "flat"
        positions.append({
            "symbol": p.get("tradingsymbol"),
            "exchange": p.get("exchange"),
            "isin": None,
            "quantity": qty,
            "average_price": _num(p.get("average_price")),
            "last_price": _num(p.get("last_price")),
            "pnl": _num(p.get("pnl")),
            "product": p.get("product"),
            "day_pnl": _num(p.get("day_m2m")),
            "side": side,
        })
    return {
        "source": "kite",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "positions": positions,
    }
