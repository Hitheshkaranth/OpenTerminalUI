from __future__ import annotations

import json
from uuid import uuid4
from datetime import timedelta

import pytest

from backend.agent import execution
from backend.agent.run_context import active_run_id
from backend.agent.tools.registry import ToolRegistry, ToolSpec
from backend.agent.context_budget import tool_context, tool_failed
from backend.models.agent_memory import AgentRun, AgentRunExecution
from backend.shared.db import SessionLocal


def _request():
    run_id = uuid4().hex
    with SessionLocal() as db:
        db.add(AgentRun(id=run_id, user_id="test", prompt="research"))
        db.add(AgentRunExecution(run_id=run_id, user_id="test", spec_json='{}', state="pending"))
        db.commit()
    return run_id


def test_atomic_claim_and_stale_lease():
    run_id = _request()
    assert execution.claim(run_id)
    assert not execution.claim(run_id)
    assert not execution.interrupted(execution.get_execution(run_id))
    with SessionLocal() as db:
        db.get(AgentRunExecution, run_id).heartbeat_at = execution.now() - timedelta(seconds=100)
        db.commit()
    assert execution.interrupted(execution.get_execution(run_id))


def test_events_replay_after_cursor_and_export_full_result():
    run_id = _request()
    first = execution.append_event(run_id, {"type": "status", "message": "start"})
    last = execution.append_event(run_id, {"type": "final", "content": "complete"})
    assert execution.events_after(run_id, first) == [{"id": last, "event": {"type": "final", "content": "complete"}}]
    assert len(execution.export_run(run_id)["events"]) == 2


@pytest.mark.asyncio
async def test_recovery_reuses_completed_write_without_duplicate_action():
    run_id = _request()
    calls = []
    async def handler(args):
        calls.append(args)
        return {"proposal_id": "one"}
    registry = ToolRegistry()
    registry.register(ToolSpec("propose", "", {}, handler, False, "soft"))
    token = active_run_id.set(run_id)
    try:
        result = await registry.execute("propose", {"symbol": "TCS"})
        # Simulate a new worker with the same durable run identifier.
        registry2 = ToolRegistry()
        registry2.register(ToolSpec("propose", "", {}, handler, False, "soft"))
        assert await registry2.execute("propose", {"symbol": "TCS"}) == result
        assert len(calls) == 1
    finally:
        active_run_id.reset(token)


@pytest.mark.asyncio
async def test_uncertain_write_never_repeats_after_interruption():
    run_id = _request()
    calls = []
    async def handler(args):
        calls.append(args)
        raise RuntimeError("connection lost after commit")
    registry = ToolRegistry()
    registry.register(ToolSpec("write", "", {}, handler, False, "soft"))
    token = active_run_id.set(run_id)
    try:
        with pytest.raises(RuntimeError, match="connection lost"):
            await registry.execute("write", {})
        with pytest.raises(RuntimeError, match="uncertain outcome"):
            await registry.execute("write", {})
        assert len(calls) == 1
    finally:
        active_run_id.reset(token)


def test_context_budget_keeps_valid_json_and_provenance():
    result = {"provenance": {"source": "test", "as_of": "2026-01-01"},
              "rows": [{"symbol": str(i), "text": "x" * 1500} for i in range(100)]}
    text = tool_context(result, reference="tool:one")
    assert len(text) <= 8000
    bounded = json.loads(text)
    assert bounded["partial"] is True
    assert bounded["full_result_ref"] == "tool:one"
    assert bounded["result"]["provenance"] == result["provenance"]
    assert tool_failed({"ok": False, "error": {"message": "unavailable"}})
    assert not tool_failed({"ok": True, "data": []})


def test_api_replays_without_rerunning_provider_and_exports(monkeypatch):
    from backend.tests.test_agent_api import _build_client
    client = _build_client(monkeypatch)
    run_id = client.post("/api/agent/runs", json={"prompt": "find cheap stocks"}).json()["run_id"]
    first = client.get(f"/api/agent/runs/{run_id}/stream")
    assert first.status_code == 200
    ids = [int(line[4:]) for line in first.text.splitlines() if line.startswith("id: ")]
    assert ids == sorted(set(ids))
    monkeypatch.setattr("backend.api.routes.agent.get_llm_provider", lambda **kwargs: (_ for _ in ()).throw(AssertionError("must not run again")))
    replay = client.get(f"/api/agent/runs/{run_id}/stream")
    assert replay.text == first.text
    assert client.get(f"/api/agent/runs/{run_id}/stream?after={ids[-1]}").text == ""
    export = client.get(f"/api/agent/runs/{run_id}/export").json()
    assert export["schema_version"] == 1
    assert export["status"] == "done"
    assert export["tools"][0]["tool"] == "screen_stocks"


def test_cancel_pending_and_resume_durable_request(monkeypatch):
    from backend.tests.test_agent_api import _build_client
    client = _build_client(monkeypatch)
    run_id = client.post("/api/agent/runs", json={"prompt": "find cheap stocks"}).json()["run_id"]
    assert client.post(f"/api/agent/runs/{run_id}/cancel").json()["status"] == "cancelled"
    assert client.get(f"/api/agent/runs/{run_id}").json()["status"] == "cancelled"
    assert client.post(f"/api/agent/runs/{run_id}/resume").json()["status"] == "pending"
    assert client.get(f"/api/agent/runs/{run_id}/stream").status_code == 200
    assert client.get(f"/api/agent/runs/{run_id}").json()["status"] == "done"


def test_replaced_worker_cannot_heartbeat_or_finish_new_lease():
    run_id = _request()
    old = execution.claim(run_id)
    execution.set_state(run_id, "interrupted")
    execution.set_state(run_id, "pending")
    new = execution.claim(run_id)
    assert new != old
    assert not execution.heartbeat(run_id, old)
    execution.set_state(run_id, "done", old)
    assert execution.get_execution(run_id)["state"] == "running"
    execution.set_state(run_id, "done", new)
    assert execution.get_execution(run_id)["state"] == "done"


def test_provider_failure_does_not_mark_run_successful(monkeypatch):
    from backend.tests.test_agent_api import _build_client
    from backend.services.llm.base import LLMError
    client = _build_client(monkeypatch)
    class FailingProvider:
        async def complete(self, *args, **kwargs):
            raise LLMError("provider unavailable")
    monkeypatch.setattr("backend.api.routes.agent.get_llm_provider", lambda **kw: FailingProvider())
    run_id = client.post("/api/agent/runs", json={"prompt": "hello"}).json()["run_id"]
    assert client.get(f"/api/agent/runs/{run_id}/stream").status_code == 200
    assert client.get(f"/api/agent/runs/{run_id}").json()["status"] == "error"
