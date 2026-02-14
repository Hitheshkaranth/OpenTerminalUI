from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from backend.fno.services.oi_analyzer import get_oi_analyzer
from backend.fno.services.option_chain_fetcher import get_option_chain_fetcher

router = APIRouter()


@router.get("/fno/chain/{symbol}")
async def get_chain(
    symbol: str,
    expiry: str | None = Query(default=None),
    range: int = Query(default=20, ge=5, le=100),
) -> dict[str, Any]:
    fetcher = get_option_chain_fetcher()
    return await fetcher.get_option_chain(symbol, expiry=expiry, strike_range=range)


@router.get("/fno/chain/{symbol}/expiries")
async def get_chain_expiries(symbol: str) -> dict[str, Any]:
    fetcher = get_option_chain_fetcher()
    items = await fetcher.get_expiry_dates(symbol)
    return {"symbol": symbol.strip().upper(), "expiries": items}


@router.get("/fno/chain/{symbol}/summary")
async def get_chain_summary(
    symbol: str,
    expiry: str | None = Query(default=None),
    range: int = Query(default=20, ge=5, le=100),
) -> dict[str, Any]:
    fetcher = get_option_chain_fetcher()
    analyzer = get_oi_analyzer()
    chain = await fetcher.get_option_chain(symbol, expiry=expiry, strike_range=range)
    atm = float(chain.get("atm_strike") or 0.0)
    atm_row = None
    for row in chain.get("strikes", []) if isinstance(chain.get("strikes"), list) else []:
        try:
            if float(row.get("strike_price")) == atm:
                atm_row = row
                break
        except Exception:
            continue
    atm_iv = 0.0
    if isinstance(atm_row, dict):
        ce_iv = float((atm_row.get("ce") or {}).get("iv") or 0.0)
        pe_iv = float((atm_row.get("pe") or {}).get("iv") or 0.0)
        vals = [v for v in [ce_iv, pe_iv] if v > 0]
        if vals:
            atm_iv = sum(vals) / len(vals)

    pcr = analyzer.get_pcr(chain)
    sr = analyzer.find_support_resistance(chain)
    max_pain = analyzer.find_max_pain(chain)
    return {
        "symbol": chain.get("symbol"),
        "expiry_date": chain.get("expiry_date"),
        "spot_price": chain.get("spot_price"),
        "atm_strike": chain.get("atm_strike"),
        "atm_iv": round(atm_iv, 4),
        "pcr": pcr,
        "max_pain": max_pain,
        "support_resistance": sr,
    }
