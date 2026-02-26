from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import fetch_stock_snapshot_coalesced, get_db
from backend.auth.deps import get_current_user
from backend.models import User
from backend.services.materialized_store import TABLE_NAME, load_screener_df, upsert_screener_rows
from backend.shared.db import engine
from sqlalchemy import text

from .engine import RunConfig, ScreenerEngine, _load_universe_symbols
from .export import to_csv_bytes, to_pdf_bytes, to_xlsx_bytes
from .fields import list_fields
from .models import compute_many
from .presets import PRESET_SCREENS, get_preset, list_presets
from .screens_crud import (
    create_screen,
    delete_screen,
    fork_screen,
    list_public_screens,
    list_screens,
    publish_screen,
    update_screen,
)

router = APIRouter(prefix="/screener", tags=["screener-revamped"])
_engine = ScreenerEngine()


class ScreenerRunRequest(BaseModel):
    query: str | None = None
    preset_id: str | None = None
    universe: str = "nse_500"
    sort_by: str | None = None
    sort_order: str = "desc"
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)
    columns: list[str] | None = None
    include_sparklines: bool = True
    include_scores: list[str] | None = None


class ScreenSaveRequest(BaseModel):
    name: str
    description: str = ""
    query: str
    columns_config: list[str] = Field(default_factory=list)
    viz_config: dict[str, Any] = Field(default_factory=dict)
    is_public: bool = False


class ScoreRequest(BaseModel):
    ticker: str | None = None
    row: dict[str, Any] | None = None
    models: list[str] = Field(default_factory=lambda: ["piotroski", "altman", "buffett", "greenblatt", "multi_factor"])


class ExportRequest(BaseModel):
    rows: list[dict[str, Any]] = Field(default_factory=list)
    columns: list[str] | None = None
    title: str = "Screener Export"


@router.get("/presets")
def get_presets() -> dict[str, list[dict[str, Any]]]:
    return {"items": list_presets()}


@router.get("/presets/{preset_id}")
def get_preset_by_id(preset_id: str) -> dict[str, Any]:
    preset = get_preset(preset_id)
    if preset is None:
        raise HTTPException(status_code=404, detail="Preset not found")
    return preset


def _run_screen_impl(payload: ScreenerRunRequest) -> dict[str, Any]:
    query = payload.query
    sort_by = payload.sort_by
    sort_order = payload.sort_order
    if payload.preset_id:
        preset = PRESET_SCREENS.get(payload.preset_id)
        if preset is None:
            raise HTTPException(status_code=404, detail="Preset not found")
        query = preset.get("query")
        if sort_by is None and isinstance(preset.get("default_sort"), str):
            parts = str(preset["default_sort"]).split()
            if parts:
                sort_by = parts[0]
            if len(parts) > 1:
                sort_order = parts[1]
    if not query:
        raise HTTPException(status_code=400, detail="query or preset_id is required")

    try:
        result = _engine.run(
            RunConfig(
                query=query,
                universe=payload.universe,
                sort_by=sort_by,
                sort_order=sort_order,
                limit=payload.limit,
                offset=payload.offset,
                include_sparklines=payload.include_sparklines,
                include_scores=payload.include_scores,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if payload.columns:
        trimmed_rows: list[dict[str, Any]] = []
        for row in result["results"]:
            kept = {col: row.get(col) for col in payload.columns}
            if "scores" in row:
                kept["scores"] = row["scores"]
            if "sparkline_price_1y" in row:
                kept["sparkline_price_1y"] = row["sparkline_price_1y"]
            trimmed_rows.append(kept)
        result["results"] = trimmed_rows
    return result


async def _hydrate_missing_universe_rows(universe: str, refresh_cap: int = 60) -> int:
    symbols = _load_universe_symbols(universe)
    if not symbols:
        return 0
    existing = load_screener_df(symbols)
    existing_tickers = (
        set(existing["ticker"].astype(str).str.upper()) if not existing.empty and "ticker" in existing.columns else set()
    )
    missing = [sym for sym in symbols if sym not in existing_tickers][:refresh_cap]
    if not missing:
        return 0

    sem = asyncio.Semaphore(16)

    async def _fetch_row(sym: str) -> dict[str, Any] | None:
        async with sem:
            try:
                snap = await fetch_stock_snapshot_coalesced(sym)
            except Exception:
                return None
            if not snap:
                return None
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
                "ev_ebitda": None,
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

    rows = [row for row in await asyncio.gather(*(_fetch_row(sym) for sym in missing)) if row is not None]
    if rows:
        upsert_screener_rows(rows)
        _engine._cache.clear()
    return len(rows)


@router.post("/run")
async def run_screen(payload: ScreenerRunRequest) -> dict[str, Any]:
    await _hydrate_missing_universe_rows(payload.universe)
    return _run_screen_impl(payload)


@router.get("/run")
async def run_screen_get(
    query: str | None = Query(default=None),
    preset_id: str | None = Query(default=None),
    universe: str = Query(default="nse_500"),
    sort_by: str | None = Query(default=None),
    sort_order: str = Query(default="desc"),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    payload = ScreenerRunRequest(
        query=query,
        preset_id=preset_id,
        universe=universe,
        sort_by=sort_by,
        sort_order=sort_order,
        limit=limit,
        offset=offset,
        include_sparklines=True,
    )
    await _hydrate_missing_universe_rows(payload.universe)
    return _run_screen_impl(
        payload
    )


@router.post("/run-revamped")
async def run_screen_revamped(payload: ScreenerRunRequest) -> dict[str, Any]:
    await _hydrate_missing_universe_rows(payload.universe)
    return _run_screen_impl(payload)


@router.get("/run-revamped")
async def run_screen_revamped_get(
    query: str | None = Query(default=None),
    preset_id: str | None = Query(default=None),
    universe: str = Query(default="nse_500"),
    sort_by: str | None = Query(default=None),
    sort_order: str = Query(default="desc"),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    payload = ScreenerRunRequest(
        query=query,
        preset_id=preset_id,
        universe=universe,
        sort_by=sort_by,
        sort_order=sort_order,
        limit=limit,
        offset=offset,
        include_sparklines=True,
    )
    await _hydrate_missing_universe_rows(payload.universe)
    return _run_screen_impl(
        payload
    )


@router.post("/screens")
def save_screen(
    payload: ScreenSaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return create_screen(db, current_user.id, payload.model_dump())


@router.get("/screens")
def get_saved_screens(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, list[dict[str, Any]]]:
    return {"items": list_screens(db, current_user.id)}


@router.put("/screens/{screen_id}")
def put_screen(
    screen_id: str,
    payload: ScreenSaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    updated = update_screen(db, current_user.id, screen_id, payload.model_dump())
    if updated is None:
        raise HTTPException(status_code=404, detail="Screen not found")
    return updated


@router.delete("/screens/{screen_id}")
def remove_screen(
    screen_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    ok = delete_screen(db, current_user.id, screen_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Screen not found")
    return {"status": "deleted", "id": screen_id}


@router.get("/public")
def get_public_screens(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> dict[str, list[dict[str, Any]]]:
    return {"items": list_public_screens(db, limit=limit, offset=offset)}


@router.post("/screens/{screen_id}/publish")
def post_publish(
    screen_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    published = publish_screen(db, current_user.id, screen_id)
    if published is None:
        raise HTTPException(status_code=404, detail="Screen not found")
    return published


@router.post("/screens/{screen_id}/fork")
def post_fork(
    screen_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    forked = fork_screen(db, current_user.id, screen_id)
    if forked is None:
        raise HTTPException(status_code=404, detail="Public screen not found")
    return forked


@router.post("/score")
def post_score(payload: ScoreRequest) -> dict[str, Any]:
    row = payload.row or {}
    if payload.ticker and not row:
        with engine.begin() as conn:
            fetched = conn.execute(text(f"SELECT * FROM {TABLE_NAME} WHERE ticker=:ticker"), {"ticker": payload.ticker.upper()}).mappings().first()
        if fetched:
            row = dict(fetched)
    return {"scores": compute_many(payload.models, row)}

@router.get("/score")
def get_score_fallback(ticker: str | None = None) -> dict[str, Any]:
    if not ticker:
        return {"scores": {}}
    return post_score(ScoreRequest(ticker=ticker, models=[]))


@router.get("/score/{ticker}")
def get_score(ticker: str) -> dict[str, Any]:
    return post_score(ScoreRequest(ticker=ticker))


@router.get("/viz/{screen_id}")
def get_viz(screen_id: str) -> dict[str, Any]:
    preset = get_preset(screen_id)
    if preset is None:
        raise HTTPException(status_code=404, detail="Preset not found")
    result = _engine.run(RunConfig(query=str(preset["query"]), universe="nse_500", limit=200))
    return {"screen_id": screen_id, "viz_config": preset.get("viz_config", {}), "viz_data": result.get("viz_data", {})}

@router.post("/viz/{screen_id}")
def post_viz(screen_id: str) -> dict[str, Any]:
    return get_viz(screen_id)


@router.get("/fields")
def get_fields() -> dict[str, list[dict[str, str]]]:
    return {"items": list_fields()}


@router.get("/sectors")
def get_sectors() -> dict[str, list[str]]:
    with engine.begin() as conn:
        try:
            rows = conn.execute(text(f"SELECT DISTINCT sector FROM {TABLE_NAME} WHERE sector IS NOT NULL AND sector != '' ORDER BY sector")).fetchall()
        except Exception:
            rows = []
    return {"items": [str(row[0]) for row in rows]}


@router.get("/universes")
def get_universes() -> dict[str, list[dict[str, str]]]:
    return {
        "items": [
            {"id": "nifty_50", "name": "Nifty 50"},
            {"id": "nse_500", "name": "NSE 500"},
            {"id": "all_nse", "name": "All NSE"},
            {"id": "bse_500", "name": "BSE 500"},
        ]
    }


@router.post("/export/csv")
def post_export_csv(payload: ExportRequest) -> Response:
    content = to_csv_bytes(payload.rows, payload.columns)
    return Response(content=content, media_type="text/csv", headers={"Content-Disposition": "attachment; filename=screener.csv"})


@router.post("/export/xlsx")
def post_export_xlsx(payload: ExportRequest) -> Response:
    content = to_xlsx_bytes(payload.rows, payload.columns)
    return Response(content=content, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=screener.xlsx"})


@router.post("/export/pdf")
def post_export_pdf(payload: ExportRequest) -> Response:
    content = to_pdf_bytes(payload.rows, title=payload.title)
    return Response(content=content, media_type="application/pdf", headers={"Content-Disposition": "attachment; filename=screener.pdf"})
