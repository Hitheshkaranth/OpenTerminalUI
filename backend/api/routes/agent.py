from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.agent.orchestrator import Orchestrator
from backend.agent.debate import DebateOrchestrator
from backend.agent.screener import ScreenerAgentOrchestrator
from backend.agent.strategy_loop import StrategyLoopOrchestrator
from backend.agent.tools.market_tools import build_default_registry, build_strategy_registry
from backend.agent import memory as memory_service
from backend.agent import reflections as reflections_module
from backend.auth.deps import get_current_user
from backend.api.deps import get_db
from backend.shared.db import SessionLocal
from backend.config.settings import get_settings
from backend.services.llm.factory import get_llm_provider
from backend.services.llm.base import LLMMessage, AssistantMessage

from backend.models.agent_memory import AgentThread, AgentMessage, AgentRun, AgentNote

logger = logging.getLogger(__name__)

# Mounted under "/api" in router.py -> resolves to /api/agent.
router = APIRouter(prefix="/agent", tags=["agent"])

# In-process pending-run store (Phase 1; durable persistence is a later phase).
_PENDING: Dict[str, Dict[str, Any]] = {}


# -- Pydantic models --
class NoteCreate(BaseModel):
    symbol: str | None = None
    kind: str = Field(..., pattern="^(note|thesis)$")
    content: str = Field(..., min_length=1)


class ReflectionRunResponse(BaseModel):
    created: int
    skipped: int


class ThreadItem(BaseModel):
    thread_id: str
    title: str
    updated_at: Any
    message_count: int


class ThreadResponse(BaseModel):
    thread_id: str
    messages: list[dict[str, Any]]


class RunResponse(BaseModel):
    run_id: str
    thread_id: str | None
    mode: str
    prompt: str
    final: str | None
    status: str
    created_at: Any


# --- Runs ---
@router.post("/runs")
async def create_run(payload: Dict[str, Any], user=Depends(get_current_user), db: Session = Depends(get_db)) -> Dict[str, str]:
    prompt = (payload.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is required")
    run_id = uuid.uuid4().hex
    thread_id = payload.get("thread_id")
    mode = payload.get("mode") or "standard"
    user_id = getattr(user, "id", None)

    # Create AgentRun row
    try:
        memory_service.create_run(db, user_id or "", run_id, thread_id, mode, prompt)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to create run record")

    _PENDING[run_id] = {
        "prompt": prompt,
        "mode": mode,
        "ticker": payload.get("ticker"),
        "context": payload.get("context") or {},
        "provider": payload.get("provider"),
        "model": payload.get("model"),
        "user_id": user_id,
        "thread_id": thread_id,
    }
    return {"run_id": run_id}


@router.get("/runs/{run_id}")
def get_run(run_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)) -> Dict[str, Any]:
    run = db.query(AgentRun).filter(AgentRun.id == run_id).first()
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    if run.user_id != getattr(user, "id", ""):
        raise HTTPException(status_code=404, detail="run not found")
    return {
        "run_id": run.id,
        "thread_id": run.thread_id,
        "mode": run.mode,
        "prompt": run.prompt,
        "final": run.final,
        "status": run.status,
        "created_at": run.created_at,
    }


# --- Stream ---
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

    user_id = spec.get("user_id") or ""

    run_kwargs: Dict[str, Any] = {}
    if spec["mode"] == "ensemble":
        from backend.agent.ensemble import EnsembleOrchestrator
        try:
            orchestrator = EnsembleOrchestrator(
                provider=provider,
                registry=build_default_registry(user_id=user_id),
                user_id=user_id,
            )
        except TypeError:
            orchestrator = EnsembleOrchestrator(
                provider=provider,
                registry=build_default_registry(),
                user_id=user_id,
            )
        run_args = ((spec.get("ticker") or spec["prompt"]).strip(),)
    elif spec["mode"] == "debate":
        if not settings.agent_debate_enabled:
            raise HTTPException(status_code=403, detail="debate mode disabled")
        subject = (spec.get("ticker") or spec["prompt"]).strip()
        try:
            registry = build_default_registry(user_id=user_id)
        except TypeError:
            registry = build_default_registry()
        # Merge memory tools
        for ms in memory_service.memory_tool_specs(user_id):
            registry.register(ms)
        orchestrator = DebateOrchestrator(
            provider=provider,
            registry=registry,
            analyst_max_steps=settings.agent_debate_analyst_max_steps,
        )
        run_args = (subject,)
    elif spec["mode"] == "strategy":
        if not settings.agent_strategy_loop_enabled:
            raise HTTPException(status_code=403, detail="strategy mode disabled")
        subject = (spec.get("ticker") or spec["prompt"]).strip()
        try:
            registry = build_default_registry(user_id=user_id)
        except TypeError:
            registry = build_default_registry()
        for ms in memory_service.memory_tool_specs(user_id):
            registry.register(ms)
        orchestrator = StrategyLoopOrchestrator(
            provider=provider,
            registry=registry,
            max_rounds=settings.agent_strategy_loop_max_rounds,
        )
        run_args = (subject,)
    elif spec["mode"] == "screener":
        if not settings.agent_screener_enabled:
            raise HTTPException(status_code=403, detail="screener mode disabled")
        subject = (spec.get("ticker") or spec["prompt"]).strip()
        orchestrator = ScreenerAgentOrchestrator(provider=provider)
        run_args = (subject,)
    else:
        # standard or deep
        try:
            registry = build_default_registry(user_id=user_id)
        except TypeError:
            registry = build_default_registry()
        # Merge memory tools
        for ms in memory_service.memory_tool_specs(user_id):
            registry.register(ms)

        # Compute history (thread) + memory directive (symbol) from the DB.
        # Memory is injected whenever the run has a symbol, thread or not.
        history = []
        memory_directive_text = None
        thread_id = spec.get("thread_id")
        symbol = (
            spec.get("ticker")
            or (spec.get("context") or {}).get("active_symbol")
            or (spec.get("context") or {}).get("ticker")
            or ""
        )
        _db = SessionLocal()
        try:
            if thread_id:
                history = memory_service.thread_history(_db, user_id, thread_id)
            if symbol:
                memory_directive_text = memory_service.memory_directive(_db, user_id, str(symbol))
        except Exception:
            logger.exception("Failed to load memory context")
        finally:
            _db.close()
        history_msgs = [LLMMessage(role=h["role"], content=h["content"]) for h in history]

        orchestrator = Orchestrator(
            provider=provider, registry=registry,
            max_steps=settings.agent_deep_max_steps if spec["mode"] == "deep" else settings.agent_max_steps)
        run_args = (spec["prompt"],)
        run_kwargs = {"history": history_msgs or None, "memory_directive": memory_directive_text}

    async def event_stream():
        final_content = None
        error_content = None
        async for event in orchestrator.run(*run_args, screen_context=spec["context"], **run_kwargs):
            if event.get("type") == "final":
                final_content = event.get("content")
            if event.get("type") == "error":
                error_content = event.get("message") or event.get("content")
            yield f"data: {json.dumps(event, default=str)}\n\n"

        # Persist after loop
        if final_content is not None:
            _db = SessionLocal()
            try:
                thread_id = spec.get("thread_id")
                if thread_id:
                    memory_service.append_message(
                        _db, user_id, thread_id, "user", spec.get("prompt", ""), run_id)
                    memory_service.append_message(
                        _db, user_id, thread_id, "assistant", final_content, run_id)
                    _db.commit()
                memory_service.finish_run(_db, run_id, final_content, "done")
                _db.commit()
            except Exception:
                logger.exception("Failed to persist stream result")
            finally:
                _db.close()
        elif error_content is not None:
            _db = SessionLocal()
            try:
                memory_service.finish_run(_db, run_id, error_content, "error")
                _db.commit()
            except Exception:
                logger.exception("Failed to persist error state")
            finally:
                _db.close()

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# --- Threads ---
@router.get("/threads")
def list_threads(user=Depends(get_current_user), db: Session = Depends(get_db)) -> Dict[str, Any]:
    items = memory_service.list_threads(db, getattr(user, "id", ""))
    return {"items": items}


@router.get("/threads/{thread_id}")
def get_thread(thread_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)) -> Dict[str, Any]:
    result = memory_service.get_thread(db, getattr(user, "id", ""), thread_id)
    if result is None:
        raise HTTPException(status_code=404, detail="thread not found")
    return result


@router.delete("/threads/{thread_id}")
def delete_thread(thread_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)) -> Dict[str, str]:
    deleted = memory_service.delete_thread(db, getattr(user, "id", ""), thread_id)
    db.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="thread not found")
    return {"status": "deleted"}


# --- Notes ---
@router.get("/notes")
def list_notes_route(
    symbol: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    items = memory_service.list_notes(db, getattr(user, "id", ""), symbol=symbol, limit=limit)
    return {"items": items}


@router.post("/notes")
def create_note(
    payload: NoteCreate,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    symbol = (payload.symbol or "").strip().upper() or None
    item = memory_service.add_note(
        db, getattr(user, "id", ""), symbol or "", payload.kind, payload.content, "user")
    db.commit()
    return item


@router.delete("/notes/{note_id}")
def delete_note(note_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)) -> Dict[str, str]:
    deleted = memory_service.delete_note(db, getattr(user, "id", ""), note_id)
    db.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="note not found")
    return {"status": "deleted"}


# --- Reflections ---
@router.post("/reflections/run", response_model=ReflectionRunResponse)
async def run_reflections_route(
    benchmark_days: int = Query(0, ge=0),
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReflectionRunResponse:
    settings = get_settings()
    provider = get_llm_provider(provider=None, model=None)
    result = await reflections_module.run_reflections(db, getattr(user, "id", ""), provider)
    return ReflectionRunResponse(created=result["created"], skipped=result["skipped"])