from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models.agent_signals import AgentSignal
from backend.agent.ensemble.scorecard import evaluate_signals, list_signals, scorecard

router = APIRouter(prefix="/agent", tags=["agent"])


@router.get("/signals")
def get_signals(
    symbol: str | None = Query(None),
    persona: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
) -> dict[str, Any]:
    items = list_signals(db, current_user.id, symbol=symbol, persona=persona, limit=limit)
    return {"items": items}


@router.post("/signals/evaluate")
async def post_evaluate_signals(
    horizon_days: int = Query(10, ge=1),
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
) -> dict[str, Any]:
    result = await evaluate_signals(db, current_user.id, horizon_days=horizon_days)
    return result


@router.get("/signals/scorecard")
def get_scorecard(
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
) -> dict[str, Any]:
    return scorecard(db, current_user.id)