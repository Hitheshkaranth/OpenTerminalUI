from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.api.deps import get_chart_provider
from backend.providers.chart_data import ChartDataProvider
from backend.services.pattern_recognition_service import service as pattern_service

router = APIRouter(prefix="/api/charts", tags=["patterns"])

_TIMEFRAME_TO_INTERVAL: dict[str, str] = {
    "1M": "1m",
    "2M": "2m",
    "5M": "5m",
    "15M": "15m",
    "30M": "30m",
    "1H": "1h",
    "4H": "4h",
    "1D": "1d",
    "1W": "1wk",
    "1MO": "1mo",
}


def _normalize_timeframe(value: str) -> str:
    raw = str(value or "1D").strip().upper()
    return _TIMEFRAME_TO_INTERVAL.get(raw, "")


@router.get("/{symbol}/patterns")
async def get_patterns(
    symbol: str,
    timeframe: str = Query(default="1D"),
    min_confidence: float = Query(default=0.6, ge=0.0, le=1.0),
    lookback: int = Query(default=200, ge=30, le=2000),
    market: str = Query(default="NSE"),
    chart_provider: ChartDataProvider = Depends(get_chart_provider),
) -> dict[str, Any]:
    interval = _normalize_timeframe(timeframe)
    if not interval:
        raise HTTPException(status_code=400, detail="Unsupported timeframe")

    bars = await chart_provider.get_ohlcv(
        symbol=symbol.strip().upper(),
        interval=interval,
        period="1y",
        market_hint=market,
    )
    sampled = bars[-lookback:] if len(bars) > lookback else bars
    ohlcv = [
        {
            "date": bar.timestamp.date().isoformat(),
            "open": float(bar.open),
            "high": float(bar.high),
            "low": float(bar.low),
            "close": float(bar.close),
            "volume": float(bar.volume),
        }
        for bar in sampled
    ]
    patterns = pattern_service.detect_patterns(ohlcv, min_confidence=min_confidence)

    return {
        "symbol": symbol.strip().upper(),
        "timeframe": timeframe,
        "patterns": [pattern.to_wire() for pattern in patterns],
        "scan_bars": len(sampled),
    }
