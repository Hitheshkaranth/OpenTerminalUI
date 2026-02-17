from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from backend.adapters.registry import get_adapter_registry
from backend.api.deps import get_unified_fetcher

router = APIRouter()

MAX_SYMBOLS = 50
SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9._-]{0,24}$")
IN_MARKETS = {"NSE", "BSE"}
US_MARKETS = {"NYSE", "NASDAQ"}
SUPPORTED_MARKETS = IN_MARKETS | US_MARKETS


def _to_float(value: Any) -> float | None:
    try:
        out = float(value)
        if out != out:
            return None
        return out
    except (TypeError, ValueError):
        return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_symbols(symbols: str) -> list[str]:
    names = [item.strip().upper() for item in symbols.split(",") if item.strip()]
    if not names:
        raise HTTPException(status_code=400, detail="At least one symbol is required")
    if len(names) > MAX_SYMBOLS:
        raise HTTPException(status_code=400, detail=f"Too many symbols. Max {MAX_SYMBOLS}")
    deduped: list[str] = []
    seen = set()
    for name in names:
        if not SYMBOL_RE.match(name):
            raise HTTPException(status_code=400, detail=f"Invalid symbol: {name}")
        if name not in seen:
            seen.add(name)
            deduped.append(name)
    return deduped


@router.get("/quotes")
async def get_quotes(
    market: str = Query(..., description="NSE|BSE|NYSE|NASDAQ"),
    symbols: str = Query(..., description="Comma-separated symbols, e.g. RELIANCE,TCS"),
) -> dict[str, Any]:
    market_code = market.strip().upper()
    if market_code not in SUPPORTED_MARKETS:
        raise HTTPException(status_code=400, detail=f"Unsupported market: {market_code}")

    symbol_list = _parse_symbols(symbols)
    registry = get_adapter_registry()
    adapter_quotes: list[dict[str, Any]] = []
    for symbol_item in symbol_list:
        for adapter in registry.get_chain(market_code):
            try:
                quote = await adapter.get_quote(symbol_item if market_code != "CRYPTO" else f"CRYPTO:{symbol_item}")
            except Exception:
                quote = None
            if quote is None:
                continue
            adapter_quotes.append(
                {
                    "symbol": symbol_item,
                    "last": quote.price,
                    "change": quote.change,
                    "changePct": quote.change_pct,
                    "ts": quote.ts or _now_iso(),
                }
            )
            break
    if adapter_quotes:
        return {"market": market_code, "quotes": adapter_quotes}

    fetcher = await get_unified_fetcher()
    now_iso = _now_iso()

    # US quotes: use Finnhub when configured, otherwise report unavailable.
    if market_code in US_MARKETS:
        if not fetcher.finnhub.api_key:
            return {"market": market_code, "status": "unavailable", "quotes": []}

        payloads = await asyncio.gather(
            *(fetcher.finnhub.get_quote(symbol) for symbol in symbol_list),
            return_exceptions=True,
        )
        quotes: list[dict[str, Any]] = []
        for symbol, payload in zip(symbol_list, payloads):
            if isinstance(payload, Exception) or not isinstance(payload, dict):
                continue
            last = _to_float(payload.get("c"))
            if last is None:
                continue
            change = _to_float(payload.get("d"))
            change_pct = _to_float(payload.get("dp"))
            epoch = payload.get("t")
            ts_iso = now_iso
            if isinstance(epoch, (int, float)) and epoch > 0:
                ts_iso = datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()
            quotes.append(
                {
                    "symbol": symbol,
                    "last": last,
                    "change": change if change is not None else 0.0,
                    "changePct": change_pct if change_pct is not None else 0.0,
                    "ts": ts_iso,
                }
            )
        return {"market": market_code, "quotes": quotes}

    quotes: list[dict[str, Any]] = []

    # India primary path: Kite batch when configured.
    kite_token = fetcher.kite.resolve_access_token()
    if fetcher.kite.api_key and kite_token:
        instruments = [f"{market_code}:{symbol}" for symbol in symbol_list]
        try:
            data = await fetcher.kite.get_quote(kite_token, instruments)
            quote_map = data.get("data") if isinstance(data, dict) else {}
            if isinstance(quote_map, dict):
                for instrument, symbol in zip(instruments, symbol_list):
                    row = quote_map.get(instrument)
                    if not isinstance(row, dict):
                        continue
                    last = _to_float(row.get("last_price"))
                    if last is None:
                        continue
                    ohlc = row.get("ohlc") if isinstance(row.get("ohlc"), dict) else {}
                    prev_close = _to_float(ohlc.get("close"))
                    change = (last - prev_close) if prev_close else None
                    change_pct = ((change / prev_close) * 100.0) if (change is not None and prev_close) else None
                    quotes.append(
                        {
                            "symbol": symbol,
                            "last": last,
                            "change": change if change is not None else 0.0,
                            "changePct": change_pct if change_pct is not None else 0.0,
                            "ts": now_iso,
                        }
                    )
        except Exception:
            pass

    # Fallback: Yahoo batched quotes for NSE/BSE.
    if not quotes:
        suffix = ".NS" if market_code == "NSE" else ".BO"
        yahoo_symbols = [f"{symbol}{suffix}" for symbol in symbol_list]
        try:
            rows = await fetcher.yahoo.get_quotes(yahoo_symbols)
            for row in rows:
                if not isinstance(row, dict):
                    continue
                raw_symbol = str(row.get("symbol") or "").upper()
                symbol = raw_symbol.replace(".NS", "").replace(".BO", "")
                if symbol not in symbol_list:
                    continue
                last = _to_float(row.get("regularMarketPrice"))
                if last is None:
                    continue
                change = _to_float(row.get("regularMarketChange"))
                change_pct = _to_float(row.get("regularMarketChangePercent"))
                epoch = row.get("regularMarketTime")
                ts_iso = now_iso
                if isinstance(epoch, (int, float)) and epoch > 0:
                    ts_iso = datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()
                quotes.append(
                    {
                        "symbol": symbol,
                        "last": last,
                        "change": change if change is not None else 0.0,
                        "changePct": change_pct if change_pct is not None else 0.0,
                        "ts": ts_iso,
                    }
                )
        except Exception:
            pass

    return {"market": market_code, "quotes": quotes}
