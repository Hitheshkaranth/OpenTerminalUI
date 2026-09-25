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
        try:
            chain = await fetcher.get_option_chain(symbol, strike_range=20)
        except Exception:
            chain = {}
        exp = str(chain.get("expiry_date") or "")
        has_chain = bool(chain.get("strikes"))
        days: int | None = None
        if exp:
            try:
                days = max((date.fromisoformat(exp) - date.today()).days, 0)
            except Exception:
                days = None
        atm_iv: float | None = None
        if has_chain:
            try:
                iv_data = await iv_engine.get_iv_data(symbol, expiry=exp or None)
                atm_iv = float(iv_data.get("atm_iv") or 0.0) or None
            except Exception:
                atm_iv = None
        max_pain = oi.find_max_pain(chain) if has_chain else 0.0
        # Empty/failed chains report nulls ("no data"), not 0 days / 0 IV / 0 max pain.
        items.append(
            {
                "symbol": symbol,
                "market": chain.get("market") or "NSE",
                "available": has_chain,
                "expiry_date": exp or None,
                "days_to_expiry": days,
                "atm_iv": atm_iv,
                "pcr": oi.get_pcr(chain),
                "max_pain": max_pain or None,
                "support_resistance": oi.find_support_resistance(chain),
            }
        )
    return {"universe": "NSE", "items": items}
