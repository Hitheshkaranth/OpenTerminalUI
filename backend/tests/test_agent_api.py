import json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import backend.api.routes.agent as agent_route
from backend.auth.deps import get_current_user
from backend.services.llm.base import AssistantMessage, ToolCall


def _build_client(monkeypatch) -> TestClient:
    class ScriptedProvider:
        def __init__(self):
            self.calls = 0
        async def complete(self, messages, tools=None, *, temperature=0.1, max_tokens=1024):
            self.calls += 1
            if self.calls == 1:
                return AssistantMessage(content=None, tool_calls=[
                    ToolCall(id="c1", name="screen_stocks", arguments={"query": "pe<20"})])
            return AssistantMessage(content="AAPL is the top pick.", tool_calls=[])

    async def fake_screen(args):
        return {"rows": [{"ticker": "AAPL", "pe_ratio": 18}]}

    from backend.agent.tools.registry import ToolRegistry, ToolSpec
    def fake_registry():
        reg = ToolRegistry()
        reg.register(ToolSpec("screen_stocks", "d", {"type": "object"},
                              handler=fake_screen, read_only=True))
        return reg

    monkeypatch.setattr(agent_route, "get_llm_provider", lambda **k: ScriptedProvider())
    monkeypatch.setattr(agent_route, "build_default_registry", fake_registry)

    app = FastAPI()
    app.include_router(agent_route.router, prefix="/api")
    app.dependency_overrides[get_current_user] = lambda: type("U", (), {"id": "u_test"})()
    return TestClient(app)


def test_create_and_stream_run(monkeypatch):
    client = _build_client(monkeypatch)
    resp = client.post("/api/agent/runs", json={"prompt": "find cheap stocks"})
    assert resp.status_code == 200
    run_id = resp.json()["run_id"]

    with client.stream("GET", f"/api/agent/runs/{run_id}/stream") as s:
        assert s.status_code == 200
        payloads = []
        for line in s.iter_lines():
            if line.startswith("data: "):
                payloads.append(json.loads(line[len("data: "):]))
    kinds = [p["type"] for p in payloads]
    assert "tool_call" in kinds and "tool_result" in kinds
    assert kinds[-1] == "final"
    assert payloads[-1]["content"] == "AAPL is the top pick."


def test_stream_unknown_run_404(monkeypatch):
    client = _build_client(monkeypatch)
    r = client.get("/api/agent/runs/does-not-exist/stream")
    assert r.status_code == 404


def test_stream_rejects_other_user(monkeypatch):
    from fastapi import FastAPI
    import backend.api.routes.agent as ar
    from backend.auth.deps import get_current_user as gcu

    client = _build_client(monkeypatch)
    run_id = client.post("/api/agent/runs", json={"prompt": "hi"}).json()["run_id"]

    # Re-point the SAME app's auth override to a different user, then stream.
    app = client.app
    app.dependency_overrides[gcu] = lambda: type("U", (), {"id": "someone_else"})()
    r = client.get(f"/api/agent/runs/{run_id}/stream")
    assert r.status_code == 403
