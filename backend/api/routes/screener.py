from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, List, Optional

import pandas as pd
from fastapi import APIRouter

from backend.api.deps import fetch_stock_snapshot_coalesced
from backend.core.models import ScreenerRunRequest, ScreenerRunResponse
from backend.core.screener import ScreenerEngine, Rule
from backend.services.materialized_store import load_screener_df, upsert_screener_rows

router = APIRouter()
DATA_DIR = Path(__file__).resolve().parents[3] / "data"

def _load_universe(universe: str) -> List[str]:
    path = DATA_DIR / ("nse_equity_symbols_eq.txt" if universe == "nse_eq" else "sample_tickers.txt")
    if not path.exists():
        return ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "ITC"]
    try:
        content = path.read_text(encoding="utf-8")
        rows = [x.strip().upper() for x in content.splitlines() if x.strip()]
        return rows[:300]
    except Exception:
        return ["RELIANCE"]

@router.post("/screener/run", response_model=ScreenerRunResponse)
async def run_screener(request: ScreenerRunRequest) -> ScreenerRunResponse:
    all_tickers = _load_universe(request.universe)
    sample_size = min(len(all_tickers), max(50, min(300, request.limit * 8)))
    tickers = all_tickers[:sample_size]
    
    warnings = []
    skipped = 0
    
    if sample_size < len(all_tickers):
        warnings.append({
            "code": "screener_sampled_universe",
            "message": f"Screened first {sample_size} symbols from {len(all_tickers)} universe."
        })

    df = load_screener_df(tickers)
    
    stored_tickers = set(df["ticker"].astype(str).str.upper()) if not df.empty else set()
    missing = [t for t in tickers if t not in stored_tickers]
    
    if missing:
        refresh_batch = missing[:30] 
        if len(missing) > len(refresh_batch):
             warnings.append({
                "code": "screener_partial_refresh",
                "message": f"Refreshing {len(refresh_batch)} of {len(missing)} missing symbols."
            })
            
        sem = asyncio.Semaphore(16)
        
        async def _fetch_row(sym: str) -> Optional[dict]:
            async with sem:
                try:
                    snap = await fetch_stock_snapshot_coalesced(sym)
                    if not snap: return None
                    return {
                        "ticker": sym,
                        "company_name": snap.get("company_name"),
                        "sector": snap.get("sector"),
                        "industry": snap.get("industry"),
                        "current_price": snap.get("current_price"),
                        "market_cap": snap.get("market_cap"),
                        "pe": snap.get("pe"),
                        "pb_calc": None,
                        "ps_calc": None,
                        "ev_ebitda": None, # Ideally fetch these
                        "roe_pct": None,
                        "roa_pct": None,
                        "op_margin_pct": None,
                        "net_margin_pct": None,
                        "rev_growth_pct": None,
                        "eps_growth_pct": None,
                        "beta": snap.get("beta"),
                        "piotroski_f_score": None,
                        "altman_z_score": None,
                    }
                except Exception:
                    return None

        fetched = await asyncio.gather(*(_fetch_row(t) for t in refresh_batch))
        rows = [r for r in fetched if r is not None]
        skipped += len(refresh_batch) - len(rows)
        
        if rows:
            upsert_screener_rows(rows)
            df = load_screener_df(tickers)
            
    if df.empty:
        return ScreenerRunResponse(count=0, rows=[], meta={"warnings": warnings + [{"code": "screener_empty", "message": "No data available."}]})

    engine = ScreenerEngine(df)
    try:
        # Pydantic models usually fields are accessed as attributes, but if using dict fallback...
        # request.rules is likely List[ScreenerRuleRequest]
        # Rule expects (field, op, value)
        rules = [Rule(field=r.field, op=r.op, value=r.value) for r in request.rules]
        filtered = engine.apply_rules(rules)
        ranked = engine.rank(
            filtered, 
            by=request.sort_by, 
            ascending=(request.sort_order.lower() == "asc"), 
            top_n=request.limit
        )
        
        # Convert to list of dicts, handle NaN
        out_rows = ranked.where(pd.notnull(ranked), None).to_dict(orient="records")
        return ScreenerRunResponse(
            count=len(ranked),
            rows=out_rows,
            meta={"warnings": warnings}
        )
    except Exception as e:
        warnings.append({"code": "screener_error", "message": str(e)})
        return ScreenerRunResponse(count=0, rows=[], meta={"warnings": warnings})
