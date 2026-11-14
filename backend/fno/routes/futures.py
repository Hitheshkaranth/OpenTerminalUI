from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Query
from sqlalchemy import distinct, func

from backend.api.deps import get_unified_fetcher
from backend.core.ttl_policy import market_open_now, ttl_seconds
from backend.db.models import FutureContract
from backend.fno.services.nse_derivatives import get_nse_futures_snapshot
from backend.shared.cache import cache as cache_instance
from backend.shared.db import SessionLocal

router = APIRouter()
DEFAULT_FUTURES_UNDERLYINGS = [
    "NIFTY",
    "BANKNIFTY",
    "FINNIFTY",
    "MIDCPNIFTY",
    "NIFTYNXT50",
]


def _to_float(value: Any) -> float | None:
    try:
        out = float(value)
        if out != out:
            return None
        return out
    except (TypeError, ValueError):
        return None


@router.get("/futures/underlyings")
async def list_futures_underlyings(
    q: str = Query(default="", description="Prefix query, e.g. REL"),
    limit: int = Query(default=25, ge=1, le=100),
) -> dict[str, Any]:
    query_text = (q or "").strip().upper()
    db = SessionLocal()
    try:
        stmt = db.query(distinct(FutureContract.underlying))
        if query_text:
            stmt = stmt.filter(func.upper(FutureContract.underlying).like(f"{query_text}%"))
        values = stmt.order_by(FutureContract.underlying.asc()).limit(limit).all()
        items = [str(row[0]).upper() for row in values if row and row[0]]
        if not items:
            fallback = [u for u in DEFAULT_FUTURES_UNDERLYINGS if (not query_text or u.startswith(query_text))]
            items = fallback[:limit]
        return {"count": len(items), "items": items}
    finally:
        db.close()


@router.get("/futures/chain/{underlying}")
async def get_futures_chain(underlying: str) -> dict[str, Any]:
    key_underlying = (underlying or "").strip().upper()
    cache_key = cache_instance.build_key("futures_chain_v2", key_underlying, {})
    cached = await cache_instance.get(cache_key)
    if cached:
        return cached

    today = datetime.now(timezone.utc).date().isoformat()
    db = SessionLocal()
    try:
        rows = (
            db.query(FutureContract)
            .filter(func.upper(FutureContract.underlying) == key_underlying)
            .filter(FutureContract.expiry_date >= today)
            .order_by(FutureContract.expiry_date.asc(), FutureContract.tradingsymbol.asc())
            .all()
        )
    finally:
        db.close()

    if not rows:
        response = await get_nse_futures_snapshot(key_underlying)
        await cache_instance.set(cache_key, response, ttl=ttl_seconds("futures_chain", market_open_now()))
        return response

    instruments = [f"{row.exchange}:{row.tradingsymbol}" for row in rows]
    quotes_by_instrument: dict[str, dict[str, Any]] = {}
    if instruments:
        fetcher = await get_unified_fetcher()
        kite_token = fetcher.kite.resolve_access_token()
        if fetcher.kite.api_key and kite_token:
            try:
                payload = await fetcher.kite.get_quote(kite_token, instruments)
                data = payload.get("data") if isinstance(payload, dict) else {}
                if isinstance(data, dict):
                    quotes_by_instrument = {str(k): v for k, v in data.items() if isinstance(v, dict)}
            except Exception:
                quotes_by_instrument = {}

    snapshot = await get_nse_futures_snapshot(key_underlying) if len(quotes_by_instrument) < len(instruments) else {}
    snapshots_by_expiry = {row["expiry_date"]: row for row in snapshot.get("contracts", [])}
    contracts: list[dict[str, Any]] = []
    ws_symbols: list[str] = []
    token_to_ws_symbol: dict[str, str] = {}
    for row in rows:
        instrument = f"{row.exchange}:{row.tradingsymbol}"
        ws_symbols.append(instrument)
        token_to_ws_symbol[str(row.instrument_token)] = instrument
        quote = quotes_by_instrument.get(instrument, {})
        ohlc = quote.get("ohlc") if isinstance(quote.get("ohlc"), dict) else {}
        observed = snapshots_by_expiry.get(str(row.expiry_date), {})
        ltp = _to_float(quote.get("last_price"))
        close = _to_float(ohlc.get("close"))
        change = (ltp - close) if (ltp is not None and close not in (None, 0.0)) else None
        change_pct = ((change / close) * 100.0) if (change is not None and close not in (None, 0.0)) else None
        has_quote = ltp is not None
        contracts.append(
            {
                "expiry_date": row.expiry_date,
                "tradingsymbol": row.tradingsymbol,
                "exchange": row.exchange,
                "ws_symbol": instrument,
                "instrument_token": row.instrument_token,
                "lot_size": row.lot_size,
                "tick_size": row.tick_size,
                "ltp": ltp if has_quote else observed.get("ltp"),
                "change": change if has_quote else observed.get("change"),
                "change_pct": change_pct if has_quote else observed.get("change_pct"),
                "oi": _to_float(quote.get("oi")) if has_quote else observed.get("oi"),
                "volume": _to_float(quote.get("volume")) if has_quote else observed.get("volume"),
                "volume_unit": "shares" if has_quote else "contracts",
                "source": "kite" if has_quote else observed.get("source", "unavailable"),
                "as_of": quote.get("timestamp") if has_quote else observed.get("as_of"),
            }
        )

    sources = {row["source"] for row in contracts}
    response = {
        "underlying": key_underlying,
        "count": len(contracts),
        "ws_symbols": ws_symbols,
        "token_to_ws_symbol": token_to_ws_symbol,
        "contracts": contracts,
        "source": next(iter(sources)) if len(sources) == 1 else "mixed",
        "as_of": snapshot.get("as_of"),
        "data_status": "snapshot" if any(row.get("ltp") is not None for row in contracts) else "unavailable",
    }
    await cache_instance.set(
        cache_key,
        response,
        ttl=ttl_seconds("futures_chain", market_open_now()),
    )
    return response
