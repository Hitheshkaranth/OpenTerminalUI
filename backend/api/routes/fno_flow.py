from __future__ import annotations

from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Query

from backend.fno.services.flow_service import get_options_flow_service

router = APIRouter(prefix="/api/fno/flow", tags=["fno-flow"])


@router.get("/unusual")
async def get_unusual_flow(
    symbol: str | None = Query(default=None),
    min_premium: float = Query(default=0.0, ge=0.0),
    option_type: str | None = Query(default=None, pattern="^(CE|PE)$"),
    expiry: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> dict[str, Any]:
    service = get_options_flow_service()
    flows = await service.detect_unusual_activity(symbol=symbol, min_premium=min_premium)

    option_type_u = (option_type or "").strip().upper()
    expiry_value = (expiry or "").strip()

    if option_type_u:
        flows = [flow for flow in flows if str(flow.get("option_type")).upper() == option_type_u]
    if expiry_value:
        flows = [flow for flow in flows if str(flow.get("expiry")) == expiry_value]

    flows = flows[:limit]
    return {"flows": flows, "count": len(flows)}


@router.get("/summary")
async def get_flow_summary(period: str = Query(default="1d")) -> dict[str, Any]:
    service = get_options_flow_service()
    return await service.get_flow_summary(period=period)


@router.get("/ticker/{symbol}")
async def get_ticker_flow(symbol: str) -> dict[str, Any]:
    service = get_options_flow_service()
    flows = await service.detect_unusual_activity(symbol=symbol)

    total_premium = sum(float(flow.get("premium_value") or 0.0) for flow in flows)
    bullish_premium = sum(float(flow.get("premium_value") or 0.0) for flow in flows if flow.get("sentiment") == "bullish")
    bullish_pct = round((bullish_premium / total_premium) * 100.0, 2) if total_premium > 0 else 0.0

    strikes: dict[float, dict[str, float]] = defaultdict(lambda: {"premium": 0.0, "count": 0.0})
    for flow in flows:
        strike = float(flow.get("strike") or 0.0)
        strikes[strike]["premium"] += float(flow.get("premium_value") or 0.0)
        strikes[strike]["count"] += 1

    top_strikes = sorted(
        (
            {"strike": strike, "premium": round(values["premium"], 2), "flow_count": int(values["count"])}
            for strike, values in strikes.items()
            if strike > 0
        ),
        key=lambda item: (item["premium"], item["flow_count"]),
        reverse=True,
    )[:5]

    return {
        "flows": flows,
        "ticker_summary": {
            "total_premium": round(total_premium, 2),
            "bullish_pct": bullish_pct,
            "top_strikes": top_strikes,
        },
    }
