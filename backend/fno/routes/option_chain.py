from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Query

from backend.adapters.mock import MockDataAdapter
from backend.fno.services.oi_analyzer import get_oi_analyzer
from backend.fno.services.option_chain_fetcher import get_option_chain_fetcher

router = APIRouter()

_SYMBOL_TO_UNDERLYING = {
    "NIFTY": "NIFTY 50",
    "BANKNIFTY": "NIFTY BANK",
    "FINNIFTY": "NIFTY FIN SERVICE",
}


def _nearest_thursday() -> date:
    today = date.today()
    days_ahead = (3 - today.weekday()) % 7
    return today + timedelta(days=days_ahead or 7)


async def _mock_chain(symbol: str, expiry: str | None, strike_range: int) -> dict[str, Any]:
    symbol_u = symbol.strip().upper()
    underlying = _SYMBOL_TO_UNDERLYING.get(symbol_u, symbol_u)
    exp = date.fromisoformat(expiry) if expiry else _nearest_thursday()
    adapter = MockDataAdapter(seed=42)
    chain = await adapter.get_option_chain(underlying, exp)

    grouped: dict[float, dict[str, Any]] = defaultdict(lambda: {"ce": {}, "pe": {}})
    for c in chain.contracts:
        leg = {
            "oi": c.oi,
            "oi_change": c.oi_change,
            "volume": c.volume,
            "iv": c.iv,
            "ltp": c.ltp,
            "bid": c.bid,
            "ask": c.ask,
            "price_change": 0.0,
            "greeks": {
                "delta": c.delta,
                "gamma": c.gamma,
                "theta": c.theta,
                "vega": c.vega,
                "rho": c.rho,
            },
        }
        row = grouped[float(c.strike)]
        if c.option_type in ("CE", "C"):
            row["ce"] = leg
        else:
            row["pe"] = leg

    strikes = [
        {"strike_price": strike, "ce": row["ce"], "pe": row["pe"]}
        for strike, row in sorted(grouped.items(), key=lambda x: x[0])
    ]
    if strikes and strike_range > 0:
        atm = float(chain.spot_price)
        idx = min(range(len(strikes)), key=lambda i: abs(float(strikes[i]["strike_price"]) - atm))
        left = max(0, idx - strike_range)
        right = min(len(strikes), idx + strike_range + 1)
        strikes = strikes[left:right]

    ce_oi = int(sum(float((row.get("ce") or {}).get("oi") or 0) for row in strikes))
    pe_oi = int(sum(float((row.get("pe") or {}).get("oi") or 0) for row in strikes))
    ce_vol = int(sum(float((row.get("ce") or {}).get("volume") or 0) for row in strikes))
    pe_vol = int(sum(float((row.get("pe") or {}).get("volume") or 0) for row in strikes))

    return {
        "symbol": symbol_u,
        "spot_price": float(chain.spot_price),
        "timestamp": chain.timestamp,
        "expiry_date": chain.expiry,
        "available_expiries": [chain.expiry],
        "atm_strike": float(chain.spot_price),
        "strikes": strikes,
        "totals": {
            "ce_oi_total": ce_oi,
            "pe_oi_total": pe_oi,
            "ce_volume_total": ce_vol,
            "pe_volume_total": pe_vol,
            "pcr_oi": round(pe_oi / ce_oi, 4) if ce_oi > 0 else 0.0,
            "pcr_volume": round(pe_vol / ce_vol, 4) if ce_vol > 0 else 0.0,
        },
    }


@router.get("/fno/chain/{symbol}")
async def get_chain(
    symbol: str,
    expiry: str | None = Query(default=None),
    range: int = Query(default=20, ge=5, le=100),
) -> dict[str, Any]:
    fetcher = get_option_chain_fetcher()
    try:
        chain = await fetcher.get_option_chain(symbol, expiry=expiry, strike_range=range)
    except Exception:
        chain = await _mock_chain(symbol, expiry, range)
    if not chain.get("strikes"):
        chain = await _mock_chain(symbol, expiry, range)
    return chain


@router.get("/fno/chain/{symbol}/expiries")
async def get_chain_expiries(symbol: str) -> dict[str, Any]:
    fetcher = get_option_chain_fetcher()
    try:
        items = await fetcher.get_expiry_dates(symbol)
    except Exception:
        items = []
    if not items:
        base = _nearest_thursday()
        items = [(base + timedelta(days=7 * i)).isoformat() for i in range(4)]
    return {"symbol": symbol.strip().upper(), "expiries": items}


@router.get("/fno/chain/{symbol}/summary")
async def get_chain_summary(
    symbol: str,
    expiry: str | None = Query(default=None),
    range: int = Query(default=20, ge=5, le=100),
) -> dict[str, Any]:
    fetcher = get_option_chain_fetcher()
    analyzer = get_oi_analyzer()
    try:
        chain = await fetcher.get_option_chain(symbol, expiry=expiry, strike_range=range)
    except Exception:
        chain = await _mock_chain(symbol, expiry, range)
    if not chain.get("strikes"):
        chain = await _mock_chain(symbol, expiry, range)

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
