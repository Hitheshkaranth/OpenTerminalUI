from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.agent.tools.registry import ToolSpec, ToolHandler
from backend.models.agent_memory import AgentThread, AgentMessage, AgentRun, AgentNote

logger = logging.getLogger(__name__)

_TRUNC = 1500


def _upsert_thread(db: Session, user_id: str, thread_id: str | None, title: str = "") -> AgentThread:
    if thread_id is None:
        thread = AgentThread(id=str(thread_id), user_id=user_id, title=title) if thread_id else None  # noqa
        if thread is None:
            # auto-generate a thread_id for standalone runs
            thread = AgentThread(user_id=user_id, title=title)
            db.add(thread)
            db.flush()
            return thread
    else:
        t = db.query(AgentThread).filter(
            AgentThread.id == thread_id,
            AgentThread.user_id == user_id,
        ).first()
        if t is None:
            t = AgentThread(id=thread_id, user_id=user_id, title=title)
            db.add(t)
            db.flush()
        else:
            t.updated_at = datetime.now(timezone.utc)
            if title and not t.title:
                t.title = title
            db.flush()
        return t
    return thread


def get_or_create_thread(db: Session, user_id: str, thread_id: str) -> AgentThread:
    t = db.query(AgentThread).filter(
        AgentThread.id == thread_id,
        AgentThread.user_id == user_id,
    ).first()
    if t is None:
        t = AgentThread(id=thread_id, user_id=user_id)
        db.add(t)
        db.flush()
    else:
        t.updated_at = datetime.now(timezone.utc)
    return t


def append_message(db: Session, user_id: str, thread_id: str, role: str, content: str, run_id: str | None = None) -> AgentMessage:
    # Ensure the thread row exists (and bump updated_at); the first user turn also names it.
    thread = get_or_create_thread(db, user_id, thread_id)
    if role == "user" and not (thread.title or "").strip():
        thread.title = (content or "")[:60]
    msg = AgentMessage(
        thread_id=thread_id,
        user_id=user_id,
        role=role,
        content=(content or "")[:_TRUNC],
        run_id=run_id,
    )
    db.add(msg)
    db.flush()
    return msg


def thread_history(db: Session, user_id: str, thread_id: str, limit: int = 8) -> list[dict[str, Any]]:
    rows = (
        db.query(AgentMessage)
        .filter(
            AgentMessage.thread_id == thread_id,
            AgentMessage.user_id == user_id,
            AgentMessage.role.in_(["user", "assistant"]),
        )
        .order_by(AgentMessage.created_at.asc())
        .limit(limit)
        .all()
    )
    return [{"role": r.role, "content": (r.content or "")[:_TRUNC]} for r in rows]


def list_threads(db: Session, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
    rows = (
        db.query(AgentThread)
        .filter(AgentThread.user_id == user_id)
        .order_by(AgentThread.updated_at.desc())
        .limit(limit)
        .all()
    )
    msg_counts = (
        db.query(AgentMessage.thread_id, func.count(AgentMessage.id).label("cnt"))
        .filter(
            AgentMessage.thread_id.in_([t.id for t in rows]),
            AgentMessage.user_id == user_id,
        )
        .group_by(AgentMessage.thread_id)
        .all()
    )
    count_map = {r.thread_id: r.cnt for r in msg_counts}
    return [
        {
            "thread_id": t.id,
            "title": (t.title or "")[:60],
            "updated_at": t.updated_at,
            "message_count": count_map.get(t.id, 0),
        }
        for t in rows
    ]


def get_thread(db: Session, user_id: str, thread_id: str) -> dict[str, Any] | None:
    t = db.query(AgentThread).filter(
        AgentThread.id == thread_id,
        AgentThread.user_id == user_id,
    ).first()
    if t is None:
        return None
    msgs = (
        db.query(AgentMessage)
        .filter(
            AgentMessage.thread_id == thread_id,
            AgentMessage.user_id == user_id,
            AgentMessage.role.in_(["user", "assistant"]),
        )
        .order_by(AgentMessage.created_at.asc())
        .all()
    )
    return {
        "thread_id": t.id,
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content[:_TRUNC] if m.content else "",
                "run_id": m.run_id,
                "created_at": m.created_at,
            }
            for m in msgs
        ],
    }


def delete_thread(db: Session, user_id: str, thread_id: str) -> bool:
    db.query(AgentMessage).filter(
        AgentMessage.thread_id == thread_id,
        AgentMessage.user_id == user_id,
    ).delete(synchronize_session="fetch")
    result = db.query(AgentThread).filter(
        AgentThread.id == thread_id,
        AgentThread.user_id == user_id,
    ).delete(synchronize_session="fetch")
    db.flush()
    return bool(result)


def create_run(db: Session, user_id: str, run_id: str, thread_id: str | None, mode: str, prompt: str) -> AgentRun:
    run = AgentRun(
        id=run_id,
        user_id=user_id,
        thread_id=thread_id,
        mode=mode,
        prompt=prompt,
        status="running",
    )
    db.add(run)
    db.flush()
    return run


def finish_run(db: Session, run_id: str, final: str | None, status: str) -> None:
    run = db.query(AgentRun).filter(AgentRun.id == run_id).first()
    if run:
        run.final = final
        run.status = status
        run.finished_at = datetime.now(timezone.utc)
        db.flush()


def list_notes(db: Session, user_id: str, symbol: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    q = db.query(AgentNote).filter(
        AgentNote.user_id == user_id,
    )
    if symbol:
        q = q.filter(AgentNote.symbol == symbol.upper())
    rows = q.order_by(AgentNote.created_at.desc()).limit(limit).all()
    return [
        {
            "id": r.id,
            "symbol": r.symbol,
            "kind": r.kind,
            "content": r.content,
            "source": r.source,
            "created_at": r.created_at,
        }
        for r in rows
    ]


def add_note(db: Session, user_id: str, symbol: str, kind: str, content: str, source: str) -> dict[str, Any]:
    note = AgentNote(
        user_id=user_id,
        symbol=symbol.upper() if symbol else None,
        kind=kind,
        content=content,
        source=source,
    )
    db.add(note)
    db.flush()
    return {
        "id": note.id,
        "symbol": note.symbol,
        "kind": note.kind,
        "content": note.content,
        "source": note.source,
        "created_at": note.created_at,
    }


def delete_note(db: Session, user_id: str, note_id: str) -> bool:
    result = db.query(AgentNote).filter(
        AgentNote.id == note_id,
        AgentNote.user_id == user_id,
    ).delete(synchronize_session="fetch")
    db.flush()
    return bool(result)


def memory_directive(db: Session, user_id: str, symbol: str) -> str | None:
    rows = (
        db.query(AgentNote)
        .filter(
            AgentNote.user_id == user_id,
            AgentNote.symbol == symbol.upper(),
        )
        .order_by(AgentNote.created_at.desc())
        .limit(5)
        .all()
    )
    if not rows:
        return None
    lines = []
    for r in rows:
        lines.append(f"- [{r.kind} · {r.created_at.isoformat()}] {r.content}")
    return f"Memory for {symbol} (newest first):\n" + "\n".join(lines)


# -- Handlers (open/close their own SessionLocal) --
_session_local_ref = None


def _get_session_local():
    global _session_local_ref
    if _session_local_ref is None:
        from backend.shared.db import SessionLocal
        _session_local_ref = SessionLocal
    return _session_local_ref


def _recall_notes_handler(args: dict[str, Any]) -> dict[str, Any]:
    from backend.shared.db import SessionLocal
    db = SessionLocal()
    try:
        user_id = args.get("_user_id", "")
        symbol = args.get("symbol")
        limit = max(1, min(50, int(args.get("limit", 20))))
        items = list_notes(db, user_id, symbol=symbol, limit=limit)
        return {"items": items}
    finally:
        db.close()


def _remember_note_handler(args: dict[str, Any]) -> dict[str, Any]:
    from backend.shared.db import SessionLocal
    db = SessionLocal()
    try:
        user_id = args.get("_user_id", "")
        symbol = str(args.get("symbol") or "").strip().upper() or None
        kind = str(args.get("kind", "note"))
        content = str(args.get("content", ""))
        item = add_note(db, user_id, symbol or "", kind, content, "user")
        return item
    finally:
        db.close()


def memory_tool_specs(user_id: str) -> list[ToolSpec]:
    return [
        ToolSpec(
            name="recall_notes",
            description="Recall memory notes for a symbol. Returns the 5 newest notes.",
            parameters={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Symbol to filter (optional)"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 20},
                },
            },
            handler=_recall_notes_handler,
            read_only=True,
        ),
        ToolSpec(
            name="remember_note",
            description="Remember a note for a symbol. Notes persist across runs.",
            parameters={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "kind": {"type": "string", "enum": ["note", "thesis"], "default": "note"},
                    "content": {"type": "string", "description": "The note content"},
                },
                "required": ["content"],
            },
            handler=_remember_note_handler,
            read_only=False,
            write_class="soft",
        ),
    ]