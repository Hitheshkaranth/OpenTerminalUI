from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter

from backend.fno.services.iv_engine import get_iv_engine
from backend.fno.services.oi_analyzer import get_oi_analyzer
from backend.fno.services.option_chain_fetcher import get_option_chain_fetcher
from backend.fno.services.pcr_tracker import get_pcr_tracker

router = APIRouter()


@router.get("/fno/expiry/dashboard")
async def expiry_dashboard() -> dict[str, Any]:
    fetcher = get_option_chain_fetcher()
    iv_engine = get_iv_engine()
    oi = get_oi_analyzer()
    pcr = get_pcr_tracker()
    base = ["NIFTY", "BANKNIFTY"]
    extras = [s for s in pcr.snapshot_universe() if s not in base][:5]
    symbols = base + extras
    items: list[dict[str, Any]] = []
    for symbol in symbols:
        chain = await fetcher.get_option_chain(symbol, strike_range=20)
        exp = str(chain.get("expiry_date") or "")
        days = 0
        if exp:
            try:
                days = max((date.fromisoformat(exp) - date.today()).days, 0)
            except Exception:
                days = 0
        iv_data = await iv_engine.get_iv_data(symbol, expiry=exp or None)
        items.append(
            {
                "symbol": symbol,
                "expiry_date": exp,
                "days_to_expiry": days,
                "atm_iv": iv_data.get("atm_iv", 0.0),
                "pcr": oi.get_pcr(chain),
                "max_pain": oi.find_max_pain(chain),
                "support_resistance": oi.find_support_resistance(chain),
            }
        )
    return {"items": items}
