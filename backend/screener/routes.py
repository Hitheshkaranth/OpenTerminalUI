from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import get_db, get_unified_fetcher
from backend.auth.deps import get_current_user
from backend.models import ScanPresetORM, User
from backend.scanner_engine.runner import ScannerRunner
from backend.scanner_engine.schemas import (
    ScanPresetCreate,
    ScanPresetOut,
    ScanPresetUpdate,
    ScanResultOut,
    ScanRunOut,
    ScreenerRunRequestV1,
)
from . import persistence

router = APIRouter()


class ScannerRuleCreateRequest(BaseModel):
    preset_id: str | None = None
    symbol: str
    setup_type: str
    trigger_level: float
    invalidation_level: float | None = None
    near_trigger_pct: float = Field(default=0.003, ge=0.0, le=0.1)
    dedupe_minutes: int = Field(default=15, ge=1, le=240)
    enabled: bool = True
    meta_json: dict[str, Any] = Field(default_factory=dict)


@router.get("/v1/screener/presets")
def get_presets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, list[ScanPresetOut]]:
    items = persistence.list_presets(db, current_user.id)
    return {"items": items}


@router.post("/v1/screener/presets")
def post_preset(
    payload: ScanPresetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ScanPresetOut:
    return persistence.create_preset(db, current_user.id, payload)


@router.put("/v1/screener/presets/{preset_id}")
def put_preset(
    preset_id: str,
    payload: ScanPresetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ScanPresetOut:
    out = persistence.update_preset(db, current_user.id, preset_id, payload)
    if out is None:
        raise HTTPException(status_code=404, detail="Preset not found")
    return out


@router.delete("/v1/screener/presets/{preset_id}")
def remove_preset(
    preset_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    ok = persistence.delete_preset(db, current_user.id, preset_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Preset not found")
    return {"status": "deleted", "id": preset_id}


@router.post("/v1/screener/run")
async def run_screener_v1(
    payload: ScreenerRunRequestV1,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    if payload.preset_id is None and payload.inline_preset is None:
        raise HTTPException(status_code=400, detail="preset_id or inline_preset is required")
    preset: ScanPresetCreate
    if payload.inline_preset is not None:
        preset = payload.inline_preset
        preset_id: str | None = None
    else:
        row = db.query(ScanPresetORM).filter(ScanPresetORM.id == payload.preset_id, ScanPresetORM.user_id == current_user.id).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Preset not found")
        preset_id = row.id
        preset = ScanPresetCreate(
            name=row.name,
            universe=row.universe,
            timeframe=row.timeframe,
            liquidity_gate=row.liquidity_gate_json,
            rules=row.rules_json,
            ranking=row.ranking_json,
        )

    run = persistence.create_run(db, current_user.id, preset_id, status="running")
    try:
        fetcher = await get_unified_fetcher()
        runner = ScannerRunner(fetcher)
        bundle = await runner.run(preset)
        all_rows = bundle.results
        persistence.save_results(db, run.id, all_rows)
        persistence.finalize_run(db, run.id, "completed", bundle.summary)
    except Exception as exc:
        persistence.finalize_run(db, run.id, "failed", {"error": str(exc)})
        raise HTTPException(status_code=500, detail=f"Scan failed: {exc}") from exc

    page_rows = all_rows[payload.offset : payload.offset + payload.limit]
    return {"run_id": run.id, "count": len(all_rows), "rows": page_rows, "summary": bundle.summary}


@router.get("/v1/screener/runs")
def get_runs(
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, list[ScanRunOut]]:
    rows = persistence.list_runs(db, current_user.id, limit=limit, offset=offset)
    items = [
        ScanRunOut(
            id=row.id,
            preset_id=row.preset_id,
            started_at=row.started_at,
            finished_at=row.finished_at,
            status=row.status,
            summary=row.summary_json if isinstance(row.summary_json, dict) else {},
        )
        for row in rows
    ]
    return {"items": items}


@router.get("/v1/screener/results")
def get_results(
    run_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    rows = persistence.list_results(db, current_user.id, run_id, limit=limit, offset=offset)
    items = [
        ScanResultOut(
            run_id=row.run_id,
            symbol=row.symbol,
            setup_type=row.setup_type,
            score=row.score,
            signal_ts=row.signal_ts,
            levels=row.levels_json if isinstance(row.levels_json, dict) else {},
            features=row.features_json if isinstance(row.features_json, dict) else {},
            explain=row.explain_json if isinstance(row.explain_json, dict) else {},
        )
        for row in rows
    ]
    return {"items": items}


@router.post("/v1/alerts/scanner-rules")
def create_scanner_rule(
    payload: ScannerRuleCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = persistence.create_scanner_alert_rule(db, current_user.id, payload.model_dump())
    return {"status": "created", "id": row.id}


@router.get("/v1/alerts/scanner-rules")
def list_scanner_rules(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    rows = persistence.list_scanner_alert_rules(db, current_user.id)
    return {
        "items": [
            {
                "id": row.id,
                "preset_id": row.preset_id,
                "symbol": row.symbol,
                "setup_type": row.setup_type,
                "trigger_level": row.trigger_level,
                "invalidation_level": row.invalidation_level,
                "near_trigger_pct": row.near_trigger_pct,
                "dedupe_minutes": row.dedupe_minutes,
                "enabled": row.enabled,
                "updated_at": row.updated_at.isoformat(),
            }
            for row in rows
        ]
    }
