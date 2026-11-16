"""Server-owned historical research cutoffs and thread isolation."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from backend.filings_rag.availability import cutoff_utc


def validate_historical_as_of(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("historical_as_of must be YYYY-MM-DD")
    if cutoff_utc(value).date() > datetime.now(timezone.utc).date():
        raise ValueError("historical_as_of cannot be a future UTC date")
    return value


def historical_context(db, user_id: str, thread_id: str | None, context: dict, requested: Any = None) -> dict:
    """Persist a thread's cutoff; historical and current research never mix."""
    from backend.models.agent_memory import AgentMessage, AgentRun, AgentRunExecution

    context = dict(context)
    supplied = requested if requested is not None else context.get("historical_as_of")
    if requested is not None and context.get("historical_as_of") not in (None, requested):
        raise ValueError("Conflicting historical_as_of cutoffs")
    cutoff = validate_historical_as_of(supplied) if supplied is not None else None
    previous = []
    if thread_id:
        previous = db.query(AgentRun).filter(AgentRun.user_id == user_id, AgentRun.thread_id == thread_id).order_by(AgentRun.created_at, AgentRun.id).all()
    inherited_context = {}
    prior_cutoffs = set()
    if thread_id and not previous and db.query(AgentMessage).filter(
        AgentMessage.user_id == user_id, AgentMessage.thread_id == thread_id
    ).first() is not None:
        # Legacy messages without durable request metadata cannot be certified
        # as belonging to a historical thread.
        prior_cutoffs.add(None)
    for run in previous:
        execution = db.get(AgentRunExecution, run.id)
        try:
            spec = json.loads(execution.spec_json) if execution else {}
            old_context = spec.get("context") or {}
            old = old_context.get("historical_as_of")
            prior_cutoffs.add(validate_historical_as_of(old) if old is not None else None)
            if old is not None:
                inherited_context = old_context
        except (TypeError, ValueError, AttributeError):
            raise ValueError("Thread contains invalid historical context; start a new thread")
    if len(prior_cutoffs) > 1:
        raise ValueError("Thread mixes historical and current research; start a new thread")
    if prior_cutoffs:
        previous_cutoff = next(iter(prior_cutoffs))
        if cutoff is None:
            cutoff = previous_cutoff
        elif cutoff != previous_cutoff:
            raise ValueError("Historical cutoff cannot change within a thread; start a new thread")
    if cutoff is not None:
        # A live screen's metrics, dossiers, and notes cannot become historical evidence.
        context = {key: context.get(key) or inherited_context.get(key) for key in ("symbol", "market")
                   if context.get(key) or inherited_context.get(key)}
        context["historical_as_of"] = cutoff
    return context


def validate_historical_mode(mode: str, context: dict) -> None:
    if context.get("historical_as_of") is not None:
        validate_historical_as_of(context["historical_as_of"])
        if mode not in {"standard", "deep"}:
            raise ValueError("Historical research supports standard/deep only; debate, ensemble, screener and strategy are unsupported")


def historical_prompt(cutoff: str) -> str:
    return (
        f"You are a historical evidence research assistant. The server-enforced availability cutoff is {cutoff}, inclusive end of UTC day. "
        "Use only the provided historical tools and their source-dated evidence. Availability means public release/publication, never fiscal period. "
        "Fetch evidence before answering; cite release/publication dates, sources and exact values. "
        "Do not substitute current valuations, market prices, portfolio state, fiscal period dates, or facts remembered from model training. "
        "If source-dated evidence is missing, state unavailable. Do not infer historical ratios from current snapshots. "
        "No orders or modifications are available. Saved memories and prior assistant evidence are deliberately excluded; refetch for follow-ups. "
        "The tool boundary restricts fetched evidence but cannot erase knowledge from model training; do not claim this is a leakage-free model backtest."
    )
