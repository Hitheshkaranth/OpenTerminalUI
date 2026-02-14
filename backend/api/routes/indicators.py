from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.api.deps import get_unified_fetcher
from backend.api.routes.chart import _parse_yahoo_chart
from backend.core.models import IndicatorComputeRequest, IndicatorPoint, IndicatorRegistryItem, IndicatorRegistryResponse, IndicatorResponse
from backend.core.technicals import compute_indicator

router = APIRouter()

_REGISTRY: list[IndicatorRegistryItem] = [
    IndicatorRegistryItem(id="sma", name="Simple Moving Average", category="trend", supported_markets=["equity", "fno"], default_params={"period": 20}),
    IndicatorRegistryItem(id="ema", name="Exponential Moving Average", category="trend", supported_markets=["equity", "fno"], default_params={"period": 20}),
    IndicatorRegistryItem(id="rsi", name="Relative Strength Index", category="momentum", supported_markets=["equity", "fno"], default_params={"period": 14}),
    IndicatorRegistryItem(id="macd", name="MACD", category="momentum", supported_markets=["equity", "fno"], default_params={"fast": 12, "slow": 26, "signal": 9}),
    IndicatorRegistryItem(id="bollinger", name="Bollinger Bands", category="volatility", supported_markets=["equity", "fno"], default_params={"period": 20, "std_dev": 2.0}),
    IndicatorRegistryItem(id="atr", name="Average True Range", category="volatility", supported_markets=["equity", "fno"], default_params={"period": 14}),
    IndicatorRegistryItem(id="volume", name="Volume", category="volume", supported_markets=["equity", "fno"], default_params={}),
]


@router.get("/v1/indicators/registry", response_model=IndicatorRegistryResponse)
async def get_indicator_registry() -> IndicatorRegistryResponse:
    return IndicatorRegistryResponse(items=_REGISTRY)


@router.post("/v1/indicators/compute", response_model=IndicatorResponse)
async def compute_indicator_series(payload: IndicatorComputeRequest) -> IndicatorResponse:
    fetcher = await get_unified_fetcher()
    raw = await fetcher.fetch_history(payload.symbol, range_str=payload.range, interval=payload.interval)
    hist = _parse_yahoo_chart(raw if isinstance(raw, dict) else {})
    if hist.empty:
        raise HTTPException(status_code=404, detail="No chart data available for indicator computation")

    try:
        result = compute_indicator(hist, payload.indicator, payload.params)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    points: list[IndicatorPoint] = []
    for idx, row in result.iterrows():
        points.append(
            IndicatorPoint(
                t=int(idx.timestamp()),
                values={col: (float(val) if val == val else None) for col, val in row.items()},
            )
        )

    return IndicatorResponse(
        ticker=payload.symbol.upper(),
        indicator=payload.indicator,
        params=payload.params,
        data=points,
        meta={"warnings": []},
    )
