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
# Allow Yahoo-native symbols: optional leading ^ for indices (e.g. ^NSEI, ^GSPC),
# and = for futures codes (e.g. GC=F, CL=F).
SYMBOL_RE = re.compile(r"^\^?[A-Z0-9][A-Z0-9._=\-]{0,24}$")
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


def _is_global_symbol(s: str) -> bool:
    """Return True for Yahoo Finance-native symbols that don't need a market suffix.

    Covers:
    - Index symbols starting with ^ (e.g. ^NSEI, ^BSESN, ^IXIC, ^GSPC)
    - Futures symbols ending with =F (e.g. GC=F, CL=F, SI=F)
    - Forex symbols ending with =X (e.g. USDINR=X)
    """
    return s.startswith("^") or s.endswith("=F") or s.endswith("=X")


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


async def _fetch_yahoo_quotes(fetcher: Any, symbols: list[str], now_iso: str) -> list[dict[str, Any]]:
    """Fetch quotes from Yahoo Finance for the given symbol list (as-is, no suffix added)."""
    quotes: list[dict[str, Any]] = []
    try:
        rows = await fetcher.yahoo.get_quotes(symbols)
        valid_set = {s.upper() for s in symbols}
        for row in rows:
            if not isinstance(row, dict):
                continue
            raw_symbol = str(row.get("symbol") or "").upper()
            if raw_symbol not in valid_set:
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
                    "symbol": raw_symbol,
                    "last": last,
                    "change": change if change is not None else 0.0,
                    "changePct": change_pct if change_pct is not None else 0.0,
                    "ts": ts_iso,
                }
            )
    except Exception:
        pass
    return quotes


@router.get("/quotes")
async def get_quotes(
    market: str = Query(..., description="NSE|BSE|NYSE|NASDAQ"),
    symbols: str = Query(..., description="Comma-separated symbols, e.g. RELIANCE,TCS"),
) -> dict[str, Any]:
    market_code = market.strip().upper()
    if market_code not in SUPPORTED_MARKETS:
        raise HTTPException(status_code=400, detail=f"Unsupported market: {market_code}")

    symbol_list = _parse_symbols(symbols)
    now_iso = _now_iso()

    # Split: global symbols (indices/futures use Yahoo-native notation like ^NSEI, GC=F)
    # are fetched directly from Yahoo without any market suffix.
    global_syms = [s for s in symbol_list if _is_global_symbol(s)]
    local_syms = [s for s in symbol_list if not _is_global_symbol(s)]

    fetcher = await get_unified_fetcher()
    all_quotes: list[dict[str, Any]] = []

    # --- Global symbols via Yahoo (no suffix, no market routing) ---
    if global_syms:
        global_quotes = await _fetch_yahoo_quotes(fetcher, global_syms, now_iso)
        all_quotes.extend(global_quotes)

    # If there are no local symbols, we are done.
    if not local_syms:
        return {"market": market_code, "quotes": all_quotes}

    # --- Local symbols via adapter registry ---
    registry = get_adapter_registry()
    adapter_quotes: list[dict[str, Any]] = []
    for symbol_item in local_syms:
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
                    "ts": quote.ts or now_iso,
                }
            )
            break
    if adapter_quotes:
        all_quotes.extend(adapter_quotes)
        return {"market": market_code, "quotes": all_quotes}

    # --- US local symbols: Finnhub ---
    if market_code in US_MARKETS:
        if not fetcher.finnhub.api_key:
            return {"market": market_code, "status": "unavailable", "quotes": all_quotes}

        payloads = await asyncio.gather(
            *(fetcher.finnhub.get_quote(symbol) for symbol in local_syms),
            return_exceptions=True,
        )
        local_quotes: list[dict[str, Any]] = []
        for symbol, payload in zip(local_syms, payloads):
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
            local_quotes.append(
                {
                    "symbol": symbol,
                    "last": last,
                    "change": change if change is not None else 0.0,
                    "changePct": change_pct if change_pct is not None else 0.0,
                    "ts": ts_iso,
                }
            )
        all_quotes.extend(local_quotes)
        return {"market": market_code, "quotes": all_quotes}

    local_quotes = []

    # --- India local symbols: Kite (primary) ---
    kite_token = fetcher.kite.resolve_access_token()
    if fetcher.kite.api_key and kite_token:
        instruments = [f"{market_code}:{symbol}" for symbol in local_syms]
        try:
            data = await fetcher.kite.get_quote(kite_token, instruments)
            quote_map = data.get("data") if isinstance(data, dict) else {}
            if isinstance(quote_map, dict):
                for instrument, symbol in zip(instruments, local_syms):
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
                    local_quotes.append(
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

    # --- India local symbols: Yahoo fallback (with .NS / .BO suffix) ---
    if not local_quotes:
        suffix = ".NS" if market_code == "NSE" else ".BO"
        yahoo_symbols = [f"{symbol}{suffix}" for symbol in local_syms]
        try:
            rows = await fetcher.yahoo.get_quotes(yahoo_symbols)
            for row in rows:
                if not isinstance(row, dict):
                    continue
                raw_symbol = str(row.get("symbol") or "").upper()
                symbol = raw_symbol.replace(".NS", "").replace(".BO", "")
                if symbol not in local_syms:
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
                local_quotes.append(
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

    all_quotes.extend(local_quotes)
    return {"market": market_code, "quotes": all_quotes}
