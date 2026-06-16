from __future__ import annotations

import json
import uuid
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from backend.agent.orchestrator import Orchestrator
from backend.agent.tools.market_tools import build_default_registry
from backend.auth.deps import get_current_user
from backend.config.settings import get_settings
from backend.services.llm.factory import get_llm_provider

# Mounted under "/api" in router.py -> resolves to /api/agent.
router = APIRouter(prefix="/agent", tags=["agent"])

# In-process pending-run store (Phase 1; durable persistence is a later phase).
_PENDING: Dict[str, Dict[str, Any]] = {}


@router.post("/runs")
async def create_run(payload: Dict[str, Any], user=Depends(get_current_user)) -> Dict[str, str]:
    prompt = (payload.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is required")
    run_id = uuid.uuid4().hex
    _PENDING[run_id] = {
        "prompt": prompt,
        "context": payload.get("context") or {},
        "provider": payload.get("provider"),
        "model": payload.get("model"),
        "user_id": getattr(user, "id", None),
    }
    return {"run_id": run_id}


@router.get("/runs/{run_id}/stream")
async def stream_run(run_id: str, user=Depends(get_current_user)) -> StreamingResponse:
    spec = _PENDING.pop(run_id, None)
    if spec is None:
        raise HTTPException(status_code=404, detail="run not found")

    if spec.get("user_id") != getattr(user, "id", None):
        _PENDING[run_id] = spec  # restore; this caller doesn't own the run
        raise HTTPException(status_code=403, detail="forbidden")

    settings = get_settings()
    provider = get_llm_provider(provider=spec["provider"], model=spec["model"])
    registry = build_default_registry()
    orchestrator = Orchestrator(
        provider=provider, registry=registry, max_steps=settings.agent_max_steps)

    async def event_stream():
        async for event in orchestrator.run(
            spec["prompt"], screen_context=spec["context"]):
            yield f"data: {json.dumps(event, default=str)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
