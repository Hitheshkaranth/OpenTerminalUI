from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.filings_watch import service
from backend.filings_watch.models import FilingsWatchEventORM, FilingsWatchSettingsORM

router = APIRouter(prefix="/api/filings-watch", tags=["filings-watch"])

NotifyKind = Literal["new_document", "adverse_regulatory", "guidance_cut", "stance_change"]
SymbolSource = Literal["watchlists", "custom"]


class FilingsWatchSettings(BaseModel):
    enabled: bool = False
    symbols_source: SymbolSource = "watchlists"
    custom_symbols: list[str] = Field(default_factory=list)
    run_hour_utc: int = 13
    notify_on: list[NotifyKind] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=lambda: ["sec", "nse"])
    import_limit: int = 5


def _resolve_user_id(request: Request) -> str:
    current_user = getattr(request.state, "current_user", None)
    user_id = getattr(current_user, "id", None)
    return str(user_id or "1")


def _clamp_hour(value: Any) -> int:
    try:
        hour = int(value)
    except (TypeError, ValueError):
        return 13
    return ((hour % 24) + 24) % 24


def _clamp_limit(value: Any) -> int:
    try:
        limit = int(value)
    except (TypeError, ValueError):
        return 5
    return max(1, min(10, limit))


def _settings_response(row: FilingsWatchSettingsORM) -> dict[str, Any]:
    raw = row.settings or {}
    notify = [k for k in (raw.get("notify_on") or []) if k in service.ALL_KINDS]
    return {
        "enabled": bool(raw.get("enabled", False)),
        "symbols_source": "custom" if str(raw.get("symbols_source") or "") == "custom" else "watchlists",
        "custom_symbols": [str(s).strip().upper() for s in (raw.get("custom_symbols") or []) if str(s).strip()],
        "run_hour_utc": _clamp_hour(raw.get("run_hour_utc")),
        "notify_on": notify or list(service._DEFAULT_NOTIFY_ON),
        "sources": [str(s).strip().lower() for s in (raw.get("sources") or ["sec", "nse"]) if str(s).strip()],
        "import_limit": _clamp_limit(raw.get("import_limit")),
    }


@router.get("/settings")
def get_settings(
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> dict[str, Any]:
    user_id = str(current_user.id)
    row = db.query(FilingsWatchSettingsORM).filter(FilingsWatchSettingsORM.user_id == user_id).first()
    if row is None:
        row = FilingsWatchSettingsORM(user_id=user_id, settings=dict(service.normalise_settings(None)))
        try:
            db.add(row)
            db.commit()
            db.refresh(row)
        except Exception:
            db.rollback()
    return _settings_response(row)


@router.put("/settings")
def update_settings(
    payload: FilingsWatchSettings,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> dict[str, Any]:
    user_id = str(current_user.id)
    stored = {
        "enabled": bool(payload.enabled),
        "symbols_source": "custom" if payload.symbols_source == "custom" else "watchlists",
        "custom_symbols": [str(s).strip().upper() for s in payload.custom_symbols if str(s).strip()],
        "run_hour_utc": _clamp_hour(payload.run_hour_utc),
        "notify_on": [k for k in payload.notify_on if k in service.ALL_KINDS],
        "sources": [str(s).strip().lower() for s in payload.sources if str(s).strip()],
        "import_limit": _clamp_limit(payload.import_limit),
    }
    row = db.query(FilingsWatchSettingsORM).filter(FilingsWatchSettingsORM.user_id == user_id).first()
    if row is None:
        row = FilingsWatchSettingsORM(user_id=user_id, settings=stored)
        db.add(row)
    else:
        row.settings = stored
    try:
        db.commit()
        db.refresh(row)
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to store settings")
    return _settings_response(row)


@router.post("/run")
async def run_now(request: Request, db: Session = Depends(get_db)) -> dict[str, bool]:
    await service.trigger_run()
    return {"started": True}


@router.get("/events")
def list_events(
    request: Request,
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> dict[str, list[dict[str, Any]]]:
    user_id = str(current_user.id)
    rows = (
        db.query(FilingsWatchEventORM)
        .filter(FilingsWatchEventORM.user_id == user_id)
        .order_by(FilingsWatchEventORM.at.desc(), FilingsWatchEventORM.id.desc())
        .limit(limit)
        .all()
    )
    items: list[dict[str, Any]] = []
    for row in rows:
        at = row.at
        iso = at.isoformat() if isinstance(at, datetime) else str(at)
        items.append(
            {
                "at": iso,
                "symbol": row.symbol,
                "kind": row.kind,
                "title": row.title,
                "detail": row.detail,
                "action_url": row.action_url,
            }
        )
    return {"items": items}