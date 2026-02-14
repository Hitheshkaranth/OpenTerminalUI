from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from backend.api.deps import get_unified_fetcher
from backend.api.routes.chart import _parse_yahoo_chart
from backend.core.crypto_adapter import CryptoAdapter
from backend.core.models import ChartResponse, OhlcvPoint

router = APIRouter()


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
