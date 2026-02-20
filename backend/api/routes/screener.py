from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, List, Optional

import pandas as pd
from fastapi import APIRouter
from pydantic import BaseModel, Field

from backend.api.deps import fetch_stock_snapshot_coalesced
from backend.core.models import ScreenerRunRequest, ScreenerRunResponse
from backend.core.screener import ScreenerEngine, Rule
from backend.equity.screener_v2 import FactorEngine, FactorSpec
from backend.services.materialized_store import load_screener_df, upsert_screener_rows

router = APIRouter()
DATA_DIR = Path(__file__).resolve().parents[3] / "data"


class FactorConfigRequest(BaseModel):
    field: str
    weight: float = Field(default=1.0, ge=0.0, le=10.0)
    higher_is_better: bool = True


class ScreenerV2RunRequest(BaseModel):
    rules: list[Any] = Field(default_factory=list)
    factors: list[FactorConfigRequest] = Field(default_factory=list)
    sort_order: str = "desc"
    limit: int = 50
    universe: str = "nse_eq"
    sector_neutral: bool = False

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


@router.post("/screener/run-v2")
async def run_screener_v2(request: ScreenerV2RunRequest) -> dict[str, Any]:
    all_tickers = _load_universe(request.universe)
    sample_size = min(len(all_tickers), max(50, min(400, request.limit * 10)))
    tickers = all_tickers[:sample_size]
    warnings: list[dict[str, str]] = []

    if sample_size < len(all_tickers):
        warnings.append(
            {
                "code": "screener_sampled_universe",
                "message": f"Screened first {sample_size} symbols from {len(all_tickers)} universe.",
            }
        )

    df = load_screener_df(tickers)
    if df.empty:
        return {"count": 0, "rows": [], "meta": {"warnings": warnings}}

    if request.rules:
        rules = []
        for raw in request.rules:
            if not isinstance(raw, dict):
                continue
            field = str(raw.get("field") or "").strip()
            op = str(raw.get("op") or "").strip()
            value = raw.get("value")
            if not field or not op:
                continue
            rules.append(Rule(field=field, op=op, value=value))
        if rules:
            df = ScreenerEngine(df).apply_rules(rules)

    if df.empty:
        return {"count": 0, "rows": [], "meta": {"warnings": warnings}}

    factors = [
        FactorSpec(name=f.field, weight=float(f.weight), higher_is_better=bool(f.higher_is_better))
        for f in request.factors
    ]
    if not factors:
        factors = [
            FactorSpec("roe_pct", weight=0.35, higher_is_better=True),
            FactorSpec("rev_growth_pct", weight=0.25, higher_is_better=True),
            FactorSpec("eps_growth_pct", weight=0.20, higher_is_better=True),
            FactorSpec("pe", weight=0.20, higher_is_better=False),
        ]

    scored = FactorEngine(df).score(factors, sector_neutral=request.sector_neutral)
    ranked = scored.sort_values(
        "composite_score", ascending=(request.sort_order.lower() == "asc")
    ).head(max(1, min(request.limit, 200)))

    factor_columns = [f"factor_{f.name}_z" for f in factors]
    heatmap = FactorEngine.heatmap_matrix(ranked, factor_columns=factor_columns, top_n=25)
    out_rows = ranked.where(pd.notnull(ranked), None).to_dict(orient="records")
    return {
        "count": len(out_rows),
        "rows": out_rows,
        "meta": {
            "warnings": warnings,
            "factors": [f.__dict__ for f in factors],
            "sector_neutral": request.sector_neutral,
            "heatmap": heatmap,
        },
    }
