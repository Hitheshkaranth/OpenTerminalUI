from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from backend.fno.services.iv_engine import get_iv_engine
from backend.fno.services.pcr_tracker import get_pcr_tracker
from backend.fno.services.option_chain_fetcher import get_option_chain_fetcher

router = APIRouter()


@router.get("/fno/heatmap/oi")
async def heatmap_oi() -> dict[str, Any]:
    tracker = get_pcr_tracker()
    fetcher = get_option_chain_fetcher()
    rows: list[dict[str, Any]] = []
    for symbol in tracker.snapshot_universe()[:20]:
        chain = await fetcher.get_option_chain(symbol, strike_range=20)
        totals = chain.get("totals") if isinstance(chain.get("totals"), dict) else {}
        rows.append(
            {
                "symbol": symbol,
                "ce_oi_total": totals.get("ce_oi_total", 0),
                "pe_oi_total": totals.get("pe_oi_total", 0),
                "pcr_oi": totals.get("pcr_oi", 0.0),
            }
        )
    rows.sort(key=lambda x: float(x.get("ce_oi_total", 0) or 0) + float(x.get("pe_oi_total", 0) or 0), reverse=True)
    return {"items": rows}


@router.get("/fno/heatmap/iv")
async def heatmap_iv() -> dict[str, Any]:
    tracker = get_pcr_tracker()
    iv_engine = get_iv_engine()
    rows: list[dict[str, Any]] = []
    for symbol in tracker.snapshot_universe()[:20]:
        iv = await iv_engine.get_iv_data(symbol)
        rows.append({"symbol": symbol, "atm_iv": iv.get("atm_iv", 0.0), "iv_rank": iv.get("iv_rank", 0.0)})
    rows.sort(key=lambda x: float(x.get("atm_iv", 0.0) or 0.0), reverse=True)
    return {"items": rows}
