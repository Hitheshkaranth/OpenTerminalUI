from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from backend.core.kite_client import KiteClient

router = APIRouter()
kite = KiteClient()


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
