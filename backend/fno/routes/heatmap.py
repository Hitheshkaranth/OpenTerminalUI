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
        try:
            chain = await fetcher.get_option_chain(symbol, strike_range=20)
            totals = chain.get("totals") if isinstance(chain.get("totals"), dict) else {}
        except Exception:
            totals = {}
        ce_oi = float(totals.get("ce_oi_total") or 0)
        pe_oi = float(totals.get("pe_oi_total") or 0)
        available = ce_oi + pe_oi > 0
        # A failed/empty fetch is "no data" (nulls), never a real 0 OI / 0 PCR reading.
        rows.append(
            {
                "symbol": symbol,
                "available": available,
                "ce_oi_total": ce_oi if available else None,
                "pe_oi_total": pe_oi if available else None,
                "pcr_oi": totals.get("pcr_oi") if available else None,
            }
        )
    rows.sort(key=lambda x: float(x.get("ce_oi_total") or 0) + float(x.get("pe_oi_total") or 0), reverse=True)
    return {"universe": "NSE", "items": rows}


@router.get("/fno/heatmap/iv")
async def heatmap_iv() -> dict[str, Any]:
    tracker = get_pcr_tracker()
    iv_engine = get_iv_engine()
    rows: list[dict[str, Any]] = []
    for symbol in tracker.snapshot_universe()[:20]:
        try:
            iv = await iv_engine.get_iv_data(symbol)
        except Exception:
            iv = {}
        atm_iv = float(iv.get("atm_iv") or 0.0)
        available = atm_iv > 0
        rows.append(
            {
                "symbol": symbol,
                "available": available,
                "atm_iv": atm_iv if available else None,
                "iv_rank": iv.get("iv_rank") if available else None,
            }
        )
    rows.sort(key=lambda x: float(x.get("atm_iv") or 0.0), reverse=True)
    return {"universe": "NSE", "items": rows}
