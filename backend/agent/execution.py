"""Durable agent requests, evidence and tool checkpoints.

Completed tools are reused on explicit recovery. An uncertain write is never repeated:
its original result must be inspected before starting a new request.
"""
from __future__ import annotations

import hashlib
import json
from uuid import uuid4
from datetime import datetime, timezone, timedelta
from typing import Any

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from backend.shared.db import SessionLocal
from backend.models.agent_memory import AgentRun, AgentRunExecution, AgentRunEvent, AgentToolCheckpoint

LEASE_SECONDS = 90
TERMINAL = {"done", "error", "cancelled", "interrupted"}


def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def get_execution(run_id: str) -> dict | None:
    with SessionLocal() as db:
        row = db.get(AgentRunExecution, run_id)
        if row is None:
            return None
        return {"run_id": row.run_id, "user_id": row.user_id, "state": row.state,
                "spec": json.loads(row.spec_json), "heartbeat_at": row.heartbeat_at, "lease_id": row.lease_id}


def append_event(run_id: str, payload: dict) -> int:
    with SessionLocal() as db:
        event = AgentRunEvent(run_id=run_id, payload_json=json.dumps(payload, default=str))
        db.add(event)
        db.commit()
        return event.id


def events_after(run_id: str, after: int = 0) -> list[dict]:
    with SessionLocal() as db:
        rows = db.query(AgentRunEvent).filter(AgentRunEvent.run_id == run_id, AgentRunEvent.id > after).order_by(AgentRunEvent.id).all()
        return [{"id": r.id, "event": json.loads(r.payload_json)} for r in rows]


def claim(run_id: str) -> str | None:
    lease_id = uuid4().hex
    with SessionLocal() as db:
        changed = db.execute(update(AgentRunExecution).where(
            AgentRunExecution.run_id == run_id, AgentRunExecution.state == "pending"
        ).values(state="running", heartbeat_at=now(), lease_id=lease_id)).rowcount
        if changed:
            db.execute(update(AgentRun).where(AgentRun.id == run_id).values(status="running"))
        db.commit()
        return lease_id if changed else None


def heartbeat(run_id: str, lease_id: str | None = None) -> bool:
    with SessionLocal() as db:
        changed = db.execute(update(AgentRunExecution).where(
            AgentRunExecution.run_id == run_id, AgentRunExecution.state == "running",
            *([AgentRunExecution.lease_id == lease_id] if lease_id else [])
        ).values(heartbeat_at=now())).rowcount
        db.commit()
        return bool(changed)


def interrupted(row: dict) -> bool:
    return row["state"] == "running" and (row["heartbeat_at"] is None or
                row["heartbeat_at"] < now() - timedelta(seconds=LEASE_SECONDS))


def set_state(run_id: str, state: str, lease_id: str | None = None) -> None:
    with SessionLocal() as db:
        row = db.get(AgentRunExecution, run_id)
        if row and (lease_id is None or row.lease_id == lease_id) and (row.state != "cancelled" or state == "pending"):
            row.state = state
            if state == "pending":
                row.lease_id = None
            row.heartbeat_at = now()
            run = db.get(AgentRun, run_id)
            if run:
                run.status = state
                if state in TERMINAL:
                    run.finished_at = now()
            db.commit()


def checkpoint_start(run_id: str, name: str, args: dict, *, read_only: bool) -> tuple[str, Any, bool]:
    canonical = json.dumps(args, sort_keys=True, default=str, separators=(",", ":"))
    key = run_id + ":" + hashlib.sha256((name + canonical).encode()).hexdigest()
    with SessionLocal() as db:
        row = db.get(AgentToolCheckpoint, key)
        if row and row.state == "done":
            return key, json.loads(row.result_json or "null"), True
        if row and row.state == "started" and not read_only:
            raise RuntimeError("A previous attempt of this write has an uncertain outcome. Inspect its proposals/notes before issuing a new run; it will not be repeated.")
        if row is None:
            db.add(AgentToolCheckpoint(id=key, run_id=run_id, tool_name=name, args_json=canonical))
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                raise RuntimeError("This tool call is already in progress; retry after its result is available.")
        else:
            row.state = "started"
            db.commit()
    return key, None, False


def checkpoint_finish(key: str, result: Any, *, failed: bool = False) -> None:
    with SessionLocal() as db:
        row = db.get(AgentToolCheckpoint, key)
        if row:
            row.state = "failed" if failed else "done"
            row.result_json = json.dumps(result, default=str)
            db.commit()


def export_run(run_id: str) -> dict:
    row = get_execution(run_id)
    with SessionLocal() as db:
        checkpoints = db.query(AgentToolCheckpoint).filter(AgentToolCheckpoint.run_id == run_id).all()
        return {"schema_version": 1, "run_id": run_id, "request": row["spec"] if row else {},
                "status": row["state"] if row else "unknown", "events": events_after(run_id),
                "tools": [{"tool": c.tool_name, "arguments": json.loads(c.args_json), "state": c.state,
                           "result": json.loads(c.result_json) if c.result_json else None} for c in checkpoints],
                "replay_note": "Recorded evidence replay. Resume reuses completed tools; a new run fetches current data. Model text may differ on resume."}
