from __future__ import annotations

import json
import asyncio
import logging
import uuid
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query, Header
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.agent.grounding import ground_stream
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

from backend.models.agent_memory import AgentThread, AgentMessage, AgentRun, AgentNote, AgentRunExecution
from backend.agent import execution
from backend.agent.run_context import active_run_id, active_lease_id

logger = logging.getLogger(__name__)

# Mounted under "/api" in router.py -> resolves to /api/agent.
router = APIRouter(prefix="/agent", tags=["agent"])

# Worker tasks are ephemeral; requests, leases, events and checkpoints are durable.
_TASKS: dict[str, asyncio.Task] = {}


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
    if not isinstance(payload.get("prompt", ""), str):
        raise HTTPException(status_code=422, detail="prompt must be text")
    prompt = (payload.get("prompt") or "").strip()
    if len(prompt) > 50000:
        raise HTTPException(status_code=422, detail="prompt exceeds 50000 characters")
    for key in ("thread_id", "ticker", "provider", "model", "mode"):
        if payload.get(key) is not None and not isinstance(payload[key], str):
            raise HTTPException(status_code=422, detail=f"{key} must be text")
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is required")
    run_id = uuid.uuid4().hex
    thread_id = payload.get("thread_id")
    mode = payload.get("mode") or "standard"
    user_id = getattr(user, "id", None)
    if thread_id:
        thread = db.get(AgentThread, thread_id)
        if thread and thread.user_id != user_id:
            raise HTTPException(status_code=404, detail="thread not found")

    if mode not in {"standard", "deep", "ensemble", "debate", "strategy", "screener"}:
        raise HTTPException(status_code=422, detail="Unsupported agent mode")
    spec = {
        "prompt": prompt,
        "mode": mode,
        "ticker": payload.get("ticker"),
        "context": payload.get("context") or {},
        "provider": payload.get("provider"),
        "model": payload.get("model"),
        "user_id": user_id,
        "thread_id": thread_id,
    }
    if not isinstance(spec["context"], dict):
        raise HTTPException(status_code=422, detail="context must be an object")
    if spec["context"].get("dossier_id"):
        from backend.research_dossiers import service as dossier_service
        dossier = dossier_service.owned(db, user_id, str(spec["context"]["dossier_id"]))
        spec["context"]["symbol"] = dossier.symbol
    settings = get_settings()
    spec["provider"] = spec["provider"] or settings.agent_provider
    spec["model"] = spec["model"] or (settings.lm_studio_model if spec["provider"] == "lmstudio" else settings.agent_model)
    # Do not accept provider secrets in a durable request.
    run = memory_service.create_run(db, user_id or "", run_id, thread_id, mode, prompt)
    run.status = "pending"
    db.add(AgentRunExecution(run_id=run_id, user_id=user_id or "", spec_json=json.dumps(spec), state="pending"))
    db.commit()
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
        "request": (execution.get_execution(run_id) or {}).get("spec", {}),
        "context": (execution.get_execution(run_id) or {}).get("spec", {}).get("context", {}),
    }


# Modes whose final answer is written by the model (strategy/ensemble finals are generated from tool
# output by code, so a contradiction there would be a checker error, not something a rewrite fixes).
_MODEL_WRITTEN_FINALS = {"standard", "deep", "debate", "screener"}


def _repairer(provider: Any, settings: Any):
    """One corrective revision of a final answer whose figures/statements contradict their sources."""
    async def repair(text: str, report: Dict[str, Any], ledger: Any):
        from backend.agent.grounding import ground_text
        from backend.agent.repair import repair_answer
        from backend.services.llm.model_router import TaskProfile, select_chain

        return await repair_answer(
            provider, text, report, regrade=lambda revised: ground_text(revised, ledger),
            models=select_chain(TaskProfile(phase="synthesis"), settings),
            max_tokens=settings.agent_max_tokens, timeout_s=120,
        )
    return repair


def _owned_execution(run_id: str, user: Any) -> dict:
    row = execution.get_execution(run_id)
    if row is None:
        raise HTTPException(status_code=404, detail="run not found")
    if row["user_id"] != getattr(user, "id", None):
        raise HTTPException(status_code=403, detail="forbidden")
    return row


@router.post("/runs/{run_id}/cancel")
def cancel_run(run_id: str, user=Depends(get_current_user)):
    row = _owned_execution(run_id, user)
    if row["state"] not in execution.TERMINAL:
        execution.set_state(run_id, "cancelled")
        execution.append_event(run_id, {"type": "status", "text": "Run cancelled"})
        task = _TASKS.get(run_id)
        if task:
            task.get_loop().call_soon_threadsafe(task.cancel)
    return {"run_id": run_id, "status": (execution.get_execution(run_id) or row)["state"]}


@router.post("/runs/{run_id}/resume")
def resume_run(run_id: str, user=Depends(get_current_user)):
    row = _owned_execution(run_id, user)
    if row["state"] == "done":
        return {"run_id": run_id, "status": "done"}
    task = _TASKS.get(run_id)
    if task and not task.done():
        raise HTTPException(status_code=409, detail="Previous worker is still stopping; retry shortly")
    if row["state"] == "running" and not execution.interrupted(row):
        raise HTTPException(status_code=409, detail="Run is still active")
    execution.set_state(run_id, "pending")
    execution.append_event(run_id, {"type": "status", "text": "Resuming with recorded tool evidence; uncertain writes will not be repeated."})
    return {"run_id": run_id, "status": "pending"}


@router.get("/runs/{run_id}/events")
def run_events(run_id: str, after: int = Query(0, ge=0), user=Depends(get_current_user)):
    _owned_execution(run_id, user)
    return {"items": execution.events_after(run_id, after)}


@router.get("/runs/{run_id}/export")
def run_export(run_id: str, user=Depends(get_current_user)):
    _owned_execution(run_id, user)
    return execution.export_run(run_id)


# --- Stream ---
@router.get("/runs/{run_id}/stream")
async def stream_run(run_id: str, after: int = Query(0, ge=0),
                     last_event_id: str | None = Header(None), user=Depends(get_current_user)) -> StreamingResponse:
    row = _owned_execution(run_id, user)
    if execution.interrupted(row):
        execution.set_state(run_id, "interrupted")
        execution.append_event(run_id, {"type": "error", "message": "Worker interrupted. Resume this run to reuse its recorded evidence."})
    if last_event_id:
        try:
            after = max(after, int(last_event_id))
        except ValueError:
            raise HTTPException(status_code=422, detail="Last-Event-ID must be an integer")
    lease_id = execution.claim(run_id)
    if lease_id:
        task = asyncio.create_task(_run_durable(run_id, row["spec"], lease_id))
        _TASKS[run_id] = task
        def release(done):
            if _TASKS.get(run_id) is done:
                _TASKS.pop(run_id, None)
        task.add_done_callback(release)

    async def subscribe():
        cursor = after
        while True:
            for item in execution.events_after(run_id, cursor):
                cursor = item["id"]
                yield f"id: {cursor}\ndata: {json.dumps(item['event'], default=str)}\n\n"
            current = execution.get_execution(run_id)
            if current is None or current["state"] in execution.TERMINAL:
                # Final event can commit between the first read and the status read.
                for item in execution.events_after(run_id, cursor):
                    yield f"id: {item['id']}\ndata: {json.dumps(item['event'], default=str)}\n\n"
                break
            if execution.interrupted(current):
                execution.set_state(run_id, "interrupted")
                execution.append_event(run_id, {"type": "error", "message": "Worker interrupted; resume this run."})
                continue
            await asyncio.sleep(0.1)
    return StreamingResponse(subscribe(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


async def _run_durable(run_id: str, spec: dict, lease_id: str):
    token = active_run_id.set(run_id)
    lease_token = active_lease_id.set(lease_id)
    async def keepalive():
        while True:
            await asyncio.sleep(10)
            if not execution.heartbeat(run_id, lease_id):
                task = _TASKS.get(run_id)
                if task:
                    task.cancel()
                return
    heartbeat_task = asyncio.create_task(keepalive())
    had_error = False
    try:
        async for event in _generate_run(run_id, spec):
            had_error = had_error or event.get("type") == "error"
            current = execution.get_execution(run_id)
            if current and (current["state"] == "cancelled" or current["lease_id"] != lease_id):
                break
            execution.append_event(run_id, event)
        current = execution.get_execution(run_id)
        if current and current["state"] == "running":
            execution.set_state(run_id, "error" if had_error else "done", lease_id)
    except asyncio.CancelledError:
        execution.set_state(run_id, "interrupted", lease_id)
        raise
    except Exception as exc:
        logger.exception("Agent run failed")
        execution.append_event(run_id, {"type": "error", "message": str(exc)})
        execution.set_state(run_id, "error", lease_id)
    finally:
        heartbeat_task.cancel()
        active_run_id.reset(token)
        active_lease_id.reset(lease_token)


async def _generate_run(run_id: str, spec: dict):
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
            or (spec.get("context") or {}).get("symbol")
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
        final_grounding = None
        error_content = None
        # Every figure in a final/role message is checked against the tool results the run collected.
        stream = ground_stream(
            orchestrator.run(*run_args, screen_context=spec["context"], **run_kwargs),
            prompt=spec.get("prompt"),
            repair=_repairer(provider, settings) if spec["mode"] in _MODEL_WRITTEN_FINALS else None,
        )
        async for event in stream:
            if event.get("type") == "final":
                final_content = event.get("content")
            if event.get("type") == "grounding" and event.get("target") == "final":
                final_grounding = {k: v for k, v in event.items() if k not in ("type", "target")}
            if event.get("type") == "error":
                error_content = event.get("message") or event.get("content")
            yield event

        # A replaced/cancelled worker cannot overwrite the new run's history.
        lease_id = active_lease_id.get()
        if lease_id:
            current = execution.get_execution(run_id)
            if not current or current["lease_id"] != lease_id or current["state"] != "running":
                return
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
                memory_service.finish_run(_db, run_id, final_content, "error" if error_content else "done", final_grounding)
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

    async for event in event_stream():
        yield event


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