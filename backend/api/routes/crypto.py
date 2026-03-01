from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from backend.api.deps import get_unified_fetcher
from backend.api.routes.chart import _parse_yahoo_chart
from backend.core.crypto_adapter import CryptoAdapter
from backend.core.models import ChartResponse, OhlcvPoint

router = APIRouter()

_SECTOR_WEIGHTS: dict[str, dict[str, float]] = {
    "L1": {"BTC-USD": 0.65, "ETH-USD": 0.35},
    "DeFi": {"UNI-USD": 0.5, "AAVE-USD": 0.5},
    "Memes": {"DOGE-USD": 0.55, "SHIB-USD": 0.45},
    "AI": {"RNDR-USD": 0.6, "FET-USD": 0.4},
    "Gaming": {"IMX-USD": 0.5, "GALA-USD": 0.5},
    "RWA": {"ONDO-USD": 0.5, "MKR-USD": 0.5},
}

_CRYPTO_META: dict[str, dict[str, str]] = {
    "BTC-USD": {"id": "bitcoin", "name": "Bitcoin", "sector": "L1"},
    "ETH-USD": {"id": "ethereum", "name": "Ethereum", "sector": "L1"},
    "SOL-USD": {"id": "solana", "name": "Solana", "sector": "L1"},
    "BNB-USD": {"id": "binancecoin", "name": "BNB", "sector": "L1"},
    "XRP-USD": {"id": "xrp", "name": "XRP", "sector": "L1"},
    "UNI-USD": {"id": "uniswap", "name": "Uniswap", "sector": "DeFi"},
    "AAVE-USD": {"id": "aave", "name": "Aave", "sector": "DeFi"},
    "DOGE-USD": {"id": "dogecoin", "name": "Dogecoin", "sector": "Memes"},
    "SHIB-USD": {"id": "shiba-inu", "name": "Shiba Inu", "sector": "Memes"},
    "RNDR-USD": {"id": "render-token", "name": "Render", "sector": "AI"},
    "FET-USD": {"id": "fetch-ai", "name": "Fetch.ai", "sector": "AI"},
    "IMX-USD": {"id": "immutable-x", "name": "Immutable", "sector": "Gaming"},
    "GALA-USD": {"id": "gala", "name": "Gala", "sector": "Gaming"},
    "ONDO-USD": {"id": "ondo-finance", "name": "Ondo", "sector": "RWA"},
    "MKR-USD": {"id": "maker", "name": "Maker", "sector": "RWA"},
}


@dataclass
class _Row:
    symbol: str
    name: str
    price: float
    change_24h: float
    volume_24h: float
    market_cap: float
    sector: str


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _f(v: Any, default: float = 0.0) -> float:
    try:
        out = float(v)
        if out != out:
            return default
        return out
    except Exception:
        return default


async def _load_rows(limit: int = 100) -> list[_Row]:
    fetcher = await get_unified_fetcher()
    symbols = list(_CRYPTO_META.keys())[: max(1, min(300, limit))]
    quotes = await fetcher.yahoo.get_quotes(symbols)
    by_symbol = {(str(x.get("symbol") or "").upper()): x for x in quotes if isinstance(x, dict)}

    rows: list[_Row] = []
    for sym in symbols:
        q = by_symbol.get(sym, {})
        meta = _CRYPTO_META.get(sym, {})
        price = _f(q.get("regularMarketPrice"))
        if price <= 0:
            continue
        change_pct = _f(q.get("regularMarketChangePercent"))
        volume = _f(q.get("regularMarketVolume"))
        market_cap_proxy = max(price * max(volume, 1.0), price * 1_000_000.0)
        rows.append(
            _Row(
                symbol=sym,
                name=str(meta.get("name") or sym),
                price=price,
                change_24h=change_pct,
                volume_24h=volume,
                market_cap=market_cap_proxy,
                sector=str(meta.get("sector") or "Other"),
            )
        )
    return rows


@router.get("/v1/crypto/search")
async def search_crypto(q: str = Query(default=""), limit: int = Query(default=20, ge=1, le=100)):
    fetcher = await get_unified_fetcher()
    adapter = CryptoAdapter(fetcher.yahoo)
    return {"items": adapter.search(q, limit=limit)}


@router.get("/v1/crypto/candles", response_model=ChartResponse)
async def crypto_candles(
    symbol: str = Query(...),
    interval: str = Query(default="1d"),
    range: str = Query(default="1y"),
) -> ChartResponse:
    fetcher = await get_unified_fetcher()
    adapter = CryptoAdapter(fetcher.yahoo)
    payload = await adapter.candles(symbol=symbol, interval=interval, range_str=range)
    hist = _parse_yahoo_chart(payload if isinstance(payload, dict) else {})
    if hist.empty:
        raise HTTPException(status_code=404, detail="No crypto candle data available")

    rows: list[OhlcvPoint] = []
    for idx, row in hist.iterrows():
        rows.append(
            OhlcvPoint(
                t=int(idx.timestamp()),
                o=float(row["Open"]),
                h=float(row["High"]),
                l=float(row["Low"]),
                c=float(row["Close"]),
                v=float(row.get("Volume", 0) or 0),
            )
        )
    return ChartResponse(ticker=symbol.upper(), interval=interval, currency="USD", data=rows)


@router.get("/v1/crypto/markets")
async def crypto_markets(limit: int = Query(default=50, ge=1, le=300)) -> dict[str, Any]:
    rows = await _load_rows(limit=limit)
    rows.sort(key=lambda x: x.market_cap, reverse=True)
    return {
        "items": [
            {
                "symbol": r.symbol,
                "name": r.name,
                "price": r.price,
                "change_24h": r.change_24h,
                "volume_24h": r.volume_24h,
                "market_cap": r.market_cap,
                "sector": r.sector,
            }
            for r in rows[:limit]
        ],
        "ts": _now_iso(),
    }


@router.get("/v1/crypto/movers/{metric}")
async def crypto_movers(metric: str, limit: int = Query(default=20, ge=1, le=100)) -> dict[str, Any]:
    metric_key = (metric or "change_24h").strip().lower()
    rows = await _load_rows(limit=300)

    if metric_key in {"gainers", "change_24h"}:
        rows.sort(key=lambda x: x.change_24h, reverse=True)
    elif metric_key == "losers":
        rows.sort(key=lambda x: x.change_24h)
    elif metric_key in {"volume", "volume_24h"}:
        rows.sort(key=lambda x: x.volume_24h, reverse=True)
    elif metric_key in {"market_cap", "cap"}:
        rows.sort(key=lambda x: x.market_cap, reverse=True)
    else:
        raise HTTPException(status_code=400, detail="Unsupported movers metric")

    return {
        "metric": metric_key,
        "items": [
            {
                "symbol": r.symbol,
                "name": r.name,
                "price": r.price,
                "change_24h": r.change_24h,
                "volume_24h": r.volume_24h,
                "market_cap": r.market_cap,
            }
            for r in rows[:limit]
        ],
        "ts": _now_iso(),
    }


@router.get("/v1/crypto/dominance")
async def crypto_dominance() -> dict[str, Any]:
    rows = await _load_rows(limit=300)
    total_cap = sum(r.market_cap for r in rows) or 1.0
    cap_by_symbol = {r.symbol: r.market_cap for r in rows}
    btc = cap_by_symbol.get("BTC-USD", 0.0)
    eth = cap_by_symbol.get("ETH-USD", 0.0)
    others = max(0.0, total_cap - btc - eth)
    return {
        "btc_pct": (btc / total_cap) * 100.0,
        "eth_pct": (eth / total_cap) * 100.0,
        "others_pct": (others / total_cap) * 100.0,
        "total_market_cap": total_cap,
        "ts": _now_iso(),
    }


@router.get("/v1/crypto/index")
async def crypto_index(top_n: int = Query(default=10, ge=1, le=100)) -> dict[str, Any]:
    rows = await _load_rows(limit=300)
    rows.sort(key=lambda x: x.market_cap, reverse=True)
    top = rows[:top_n]
    total_cap = sum(r.market_cap for r in top) or 1.0
    weighted_change = sum((r.market_cap / total_cap) * r.change_24h for r in top)
    index_value = 1000.0 * (1.0 + weighted_change / 100.0)
    return {
        "index_name": "OTUI Crypto Market Cap Index",
        "top_n": top_n,
        "component_count": len(top),
        "index_value": index_value,
        "change_24h": weighted_change,
        "total_market_cap": total_cap,
        "ts": _now_iso(),
    }


@router.get("/v1/crypto/sectors")
async def crypto_sectors() -> dict[str, Any]:
    rows = await _load_rows(limit=300)
    row_by_symbol = {r.symbol: r for r in rows}
    items: list[dict[str, Any]] = []

    for sector, weights in _SECTOR_WEIGHTS.items():
        total_w = sum(weights.values()) or 1.0
        change = 0.0
        cap = 0.0
        components: list[dict[str, Any]] = []
        for symbol, w in weights.items():
            row = row_by_symbol.get(symbol)
            if row is None:
                continue
            weight = w / total_w
            change += row.change_24h * weight
            cap += row.market_cap
            components.append({"symbol": row.symbol, "name": row.name, "weight": weight})
        items.append(
            {
                "sector": sector,
                "change_24h": change,
                "market_cap": cap,
                "components": components,
            }
        )

    return {"items": items, "ts": _now_iso()}
