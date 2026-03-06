from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import math
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from backend.api.deps import cache_instance, get_unified_fetcher
from backend.api.routes.chart import _parse_yahoo_chart
from backend.core.crypto_adapter import CryptoAdapter
from backend.core.models import ChartResponse, OhlcvPoint
from backend.core.ttl_policy import market_open_now, ttl_seconds
from backend.services.crypto_market_service import CryptoMarketService

router = APIRouter()
market_service = CryptoMarketService()

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


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _depth_bucket(change_24h: float) -> str:
    if change_24h >= 5.0:
        return "surge"
    if change_24h >= 2.0:
        return "bullish"
    if change_24h >= 0.5:
        return "up"
    if change_24h <= -5.0:
        return "flush"
    if change_24h <= -2.0:
        return "bearish"
    if change_24h <= -0.5:
        return "down"
    return "flat"


def _synthetic_returns(symbol: str, change_24h: float, window: int) -> list[float]:
    seed = sum(ord(c) for c in symbol) % 17
    drift = _clamp(change_24h / 2400.0, -0.03, 0.03)
    out: list[float] = []
    for i in range(max(2, window)):
        wave = math.sin((i + seed) * 0.45) * 0.004
        phase = math.cos((i + 3 + seed) * 0.19) * 0.0025
        out.append(_clamp(drift + wave + phase, -0.09, 0.09))
    return out


def _corr(a: list[float], b: list[float]) -> float:
    n = min(len(a), len(b))
    if n < 2:
        return 0.0
    aa = a[-n:]
    bb = b[-n:]
    mean_a = sum(aa) / n
    mean_b = sum(bb) / n
    cov = sum((x - mean_a) * (y - mean_b) for x, y in zip(aa, bb))
    var_a = sum((x - mean_a) ** 2 for x in aa)
    var_b = sum((y - mean_b) ** 2 for y in bb)
    if var_a <= 0.0 or var_b <= 0.0:
        return 0.0
    raw = cov / math.sqrt(var_a * var_b)
    return _clamp(raw, -1.0, 1.0)


async def _load_rows(limit: int = 100) -> list[_Row]:
    capped_limit = max(1, min(300, limit))
    symbols = list(_CRYPTO_META.keys())[:capped_limit]
    cache_key = cache_instance.build_key("crypto_quotes", "universe", {"limit": capped_limit})
    cached = await cache_instance.get(cache_key)
    if isinstance(cached, list):
        rows: list[_Row] = []
        for item in cached:
            if not isinstance(item, dict):
                continue
            rows.append(
                _Row(
                    symbol=str(item.get("symbol") or ""),
                    name=str(item.get("name") or ""),
                    price=_f(item.get("price")),
                    change_24h=_f(item.get("change_24h")),
                    volume_24h=_f(item.get("volume_24h")),
                    market_cap=_f(item.get("market_cap")),
                    sector=str(item.get("sector") or "Other"),
                )
            )
        if rows:
            return rows

    fetcher = await get_unified_fetcher()
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

    await cache_instance.set(
        cache_key,
        [
            {
                "symbol": row.symbol,
                "name": row.name,
                "price": row.price,
                "change_24h": row.change_24h,
                "volume_24h": row.volume_24h,
                "market_cap": row.market_cap,
                "sector": row.sector,
            }
            for row in rows
        ],
        ttl=ttl_seconds("crypto", market_open_now()),
    )
    return rows


async def _returns_from_charts(symbol: str, window: int) -> list[float]:
    fetcher = await get_unified_fetcher()
    payload = await fetcher.yahoo.get_chart(symbol, range_str="6mo", interval="1d")
    hist = _parse_yahoo_chart(payload if isinstance(payload, dict) else {})
    if hist.empty:
        return []

    closes = [float(v) for v in hist["Close"].tolist() if v is not None]
    if len(closes) < 2:
        return []

    rets: list[float] = []
    prev = closes[0]
    for cur in closes[1:]:
        if prev <= 0:
            prev = cur
            continue
        rets.append((cur - prev) / prev)
        prev = cur
    return rets[-max(2, window) :]


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
async def crypto_markets(
    limit: int = Query(default=50, ge=1, le=300),
    q: str = Query(default=""),
    sector: str = Query(default=""),
    sort_by: str = Query(default="market_cap"),
    sort_order: str = Query(default="desc"),
) -> dict[str, Any]:
    rows = await _load_rows(limit=limit)
    query_term = (q if isinstance(q, str) else "").strip().lower()
    if query_term:
        rows = [r for r in rows if query_term in r.symbol.lower() or query_term in r.name.lower()]

    sector_term = (sector if isinstance(sector, str) else "").strip().lower()
    if sector_term:
        rows = [r for r in rows if r.sector.lower() == sector_term]

    sort_key = (sort_by if isinstance(sort_by, str) else "market_cap").strip().lower()
    if sort_key not in {"market_cap", "volume_24h", "change_24h", "price", "symbol"}:
        sort_key = "market_cap"
    reverse = (sort_order if isinstance(sort_order, str) else "desc").strip().lower() != "asc"
    rows.sort(key=lambda x: getattr(x, sort_key), reverse=reverse)

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
        "count": min(limit, len(rows)),
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


@router.get("/v1/crypto/heatmap")
async def crypto_heatmap(limit: int = Query(default=80, ge=1, le=200)) -> dict[str, Any]:
    rows = await _load_rows(limit=max(60, limit))
    rows.sort(key=lambda x: x.market_cap, reverse=True)
    items: list[dict[str, Any]] = []
    for row in rows[:limit]:
        depth_bid = max(1.0, row.volume_24h * row.price * (1.0 + max(0.0, row.change_24h) / 100.0))
        depth_ask = max(1.0, row.volume_24h * row.price * (1.0 + max(0.0, -row.change_24h) / 100.0))
        imbalance = _clamp((depth_bid - depth_ask) / (depth_bid + depth_ask), -1.0, 1.0)
        items.append(
            {
                "symbol": row.symbol,
                "name": row.name,
                "sector": row.sector,
                "price": row.price,
                "change_24h": row.change_24h,
                "market_cap": row.market_cap,
                "depth_bid_notional": depth_bid,
                "depth_ask_notional": depth_ask,
                "depth_imbalance": imbalance,
                "bucket": _depth_bucket(row.change_24h),
            }
        )
    return {"items": items, "ts": _now_iso()}


@router.get("/v1/crypto/derivatives")
async def crypto_derivatives(limit: int = Query(default=40, ge=1, le=200)) -> dict[str, Any]:
    from backend.realtime.binance_ws import get_binance_derivatives_state

    rows = await _load_rows(limit=max(60, limit))
    rows.sort(key=lambda x: abs(x.change_24h), reverse=True)
    stream_state = get_binance_derivatives_state()
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

    for row in rows[:limit]:
        funding_rate_8h = _clamp(row.change_24h / 2400.0, -0.003, 0.003)
        liq_scale = max(1.0, row.volume_24h * row.price * abs(row.change_24h) * 0.0001)
        if row.change_24h >= 0:
            long_liq = liq_scale * 0.35
            short_liq = liq_scale * 0.65
        else:
            long_liq = liq_scale * 0.65
            short_liq = liq_scale * 0.35
        stream_state.ingest_event(row.symbol, funding_rate_8h, long_liq, side="long", ts_ms=now_ms)
        stream_state.ingest_event(row.symbol, funding_rate_8h, short_liq, side="short", ts_ms=now_ms)

    snapshot = stream_state.snapshot(limit=limit)
    items = [
        {
            "symbol": item["symbol"],
            "funding_rate_8h": item["funding_rate_8h"],
            "open_interest_usd": item["open_interest_usd"],
            "long_liquidations_24h": item["long_liquidations_24h"],
            "short_liquidations_24h": item["short_liquidations_24h"],
            "liquidations_24h": item["liquidations_24h"],
            "updated_at": item["updated_at"],
        }
        for item in snapshot["items"]
    ]
    return {"items": items, "totals": snapshot["totals"], "ts": _now_iso()}


@router.get("/v1/crypto/defi")
async def crypto_defi_dashboard() -> dict[str, Any]:
    rows = await _load_rows(limit=200)
    defi_rows = [r for r in rows if r.sector == "DeFi"]
    if not defi_rows:
        return {
            "headline": {
                "tvl_usd": 0.0,
                "dex_volume_24h": 0.0,
                "lending_borrowed_usd": 0.0,
                "defi_change_24h": 0.0,
            },
            "protocols": [],
            "ts": _now_iso(),
        }

    total_cap = sum(r.market_cap for r in defi_rows) or 1.0
    tvl = sum(r.market_cap * 0.18 for r in defi_rows)
    dex_volume = sum(r.volume_24h * 0.65 for r in defi_rows)
    borrowed = sum(r.market_cap * 0.07 for r in defi_rows)
    change = sum((r.market_cap / total_cap) * r.change_24h for r in defi_rows)
    protocols = [
        {
            "symbol": r.symbol,
            "name": r.name,
            "price": r.price,
            "change_24h": r.change_24h,
            "market_cap": r.market_cap,
            "dominance_pct": (r.market_cap / total_cap) * 100.0,
            "tvl_proxy_usd": r.market_cap * 0.18,
        }
        for r in sorted(defi_rows, key=lambda x: x.market_cap, reverse=True)
    ]
    return {
        "headline": {
            "tvl_usd": tvl,
            "dex_volume_24h": dex_volume,
            "lending_borrowed_usd": borrowed,
            "defi_change_24h": change,
        },
        "protocols": protocols,
        "ts": _now_iso(),
    }


@router.get("/v1/crypto/correlation")
async def crypto_correlation_matrix(
    window: int = Query(default=30, ge=5, le=180),
    limit: int = Query(default=8, ge=2, le=20),
) -> dict[str, Any]:
    rows = await _load_rows(limit=120)
    rows.sort(key=lambda x: x.market_cap, reverse=True)
    selected = rows[:limit]
    symbols = [r.symbol for r in selected]
    returns_by_symbol: dict[str, list[float]] = {}

    for row in selected:
        returns = await _returns_from_charts(row.symbol, window)
        if len(returns) < 2:
            returns = _synthetic_returns(row.symbol, row.change_24h, window)
        returns_by_symbol[row.symbol] = returns[-window:]

    matrix: list[list[float]] = []
    for left in symbols:
        row_vals: list[float] = []
        for right in symbols:
            if left == right:
                row_vals.append(1.0)
            else:
                row_vals.append(_corr(returns_by_symbol[left], returns_by_symbol[right]))
        matrix.append(row_vals)

    return {
        "symbols": symbols,
        "window": window,
        "matrix": matrix,
        "ts": _now_iso(),
    }


@router.get("/v1/crypto/coins/{symbol}")
async def crypto_coin_detail(symbol: str) -> dict[str, Any]:
    detail = await market_service.coin_detail(symbol)
    if detail is None:
        raise HTTPException(status_code=404, detail="Crypto asset not found")
    return detail
