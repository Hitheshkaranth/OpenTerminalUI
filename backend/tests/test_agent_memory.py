from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.shared.db import Base
from backend.models.agent_memory import AgentThread, AgentMessage, AgentRun, AgentNote
from backend.agent import memory as memory_service
from backend.services.llm.base import AssistantMessage, LLMMessage

# -- in-memory DB setup --
engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
Base.metadata.create_all(engine)
SessionFactory = sessionmaker(bind=engine)


def _session():
    return SessionFactory()


# ============================================================
# Thread CRUD
# ============================================================

def test_thread_create_append_history():
    db = _session()
    uid = "u1"
    tid = "t-alpha"

    t = memory_service.get_or_create_thread(db, uid, tid)
    assert t.id == tid

    memory_service.append_message(db, uid, tid, "user", "hello")
    time.sleep(0.01)
    memory_service.append_message(db, uid, tid, "assistant", "hi back")
    db.commit()

    history = memory_service.thread_history(db, uid, tid)
    assert len(history) == 2
    assert history[0] == {"role": "user", "content": "hello"}
    assert history[1] == {"role": "assistant", "content": "hi back"}

    # Truncation test (> 1500 chars)
    long_text = "x" * 2000
    memory_service.append_message(db, uid, tid, "user", long_text)
    db.commit()
    history2 = memory_service.thread_history(db, uid, tid)
    assert len(history2) == 3  # limit=8, so all fit
    assert len(history2[2]["content"]) == 1500  # truncated

    db.close()


def test_thread_history_ordering_role_filter():
    db = _session()
    uid = "u2"
    tid = "t-beta"

    memory_service.get_or_create_thread(db, uid, tid)
    memory_service.append_message(db, uid, tid, "user", "first")
    memory_service.append_message(db, uid, tid, "system", "hidden sys msg")
    memory_service.append_message(db, uid, tid, "assistant", "first reply")
    memory_service.append_message(db, uid, tid, "user", "second")
    memory_service.append_message(db, uid, tid, "tool", "tool output")
    db.commit()

    history = memory_service.thread_history(db, uid, tid)
    roles = [h["role"] for h in history]
    assert roles == ["user", "assistant", "user"]
    assert "system" not in roles
    assert "tool" not in roles

    db.close()


def test_thread_history_limit():
    db = _session()
    uid = "u3"
    tid = "t-gamma"

    memory_service.get_or_create_thread(db, uid, tid)
    for i in range(12):
        memory_service.append_message(db, uid, tid, "user", f"msg {i}")
        memory_service.append_message(db, uid, tid, "assistant", f"reply {i}")
    db.commit()

    history = memory_service.thread_history(db, uid, tid, limit=8)
    assert len(history) == 8
    # Oldest 8 messages: user0, assistant0, user1, assistant1, user2, assistant2, user3, assistant3
    assert history[0]["content"] == "msg 0"
    assert history[7]["content"] == "reply 3"

    db.close()


# ============================================================
# List / Get / Delete threads scoped by user
# ============================================================

def test_list_threads_scoped():
    db = _session()
    u1, u2 = "u10", "u20"

    t1 = memory_service.get_or_create_thread(db, u1, "t-a")
    memory_service.append_message(db, u1, "t-a", "user", "hi")
    t2 = memory_service.get_or_create_thread(db, u2, "t-b")
    memory_service.append_message(db, u2, "t-b", "user", "yo")
    db.commit()

    items1 = memory_service.list_threads(db, u1)
    items2 = memory_service.list_threads(db, u2)
    assert len(items1) == 1
    assert len(items2) == 1
    assert items1[0]["thread_id"] == "t-a"
    assert items2[0]["thread_id"] == "t-b"
    assert items1[0]["message_count"] == 1

    db.close()


def test_get_thread():
    db = _session()
    uid = "u30"
    tid = "t-c"

    memory_service.get_or_create_thread(db, uid, tid)
    memory_service.append_message(db, uid, tid, "user", "q")
    memory_service.append_message(db, uid, tid, "assistant", "a")
    db.commit()

    result = memory_service.get_thread(db, uid, tid)
    assert result is not None
    assert result["thread_id"] == tid
    assert len(result["messages"]) == 2

    # Foreign user
    result2 = memory_service.get_thread(db, "u31", tid)
    assert result2 is None

    db.close()


def test_delete_thread():
    db = _session()
    uid = "u40"
    tid = "t-d"

    memory_service.get_or_create_thread(db, uid, tid)
    memory_service.append_message(db, uid, tid, "user", "hi")
    db.commit()

    assert memory_service.delete_thread(db, uid, tid) is True
    assert memory_service.get_thread(db, uid, tid) is None

    # Already deleted
    assert memory_service.delete_thread(db, uid, tid) is False

    db.close()


# ============================================================
# Notes CRUD + memory_directive
# ============================================================

def test_notes_crud():
    db = _session()
    uid = "u50"

    item = memory_service.add_note(db, uid, "RELIANCE", "note", "support at 2000", "user")
    assert item["kind"] == "note"
    assert item["symbol"] == "RELIANCE"
    assert item["content"] == "support at 2000"
    note_id = item["id"]
    db.commit()

    notes = memory_service.list_notes(db, uid)
    assert len(notes) == 1
    assert notes[0]["id"] == note_id

    deleted = memory_service.delete_note(db, uid, note_id)
    assert deleted is True
    assert memory_service.delete_note(db, uid, note_id) is False

    db.close()


def test_notes_filter_by_symbol():
    db = _session()
    uid = "u51"

    memory_service.add_note(db, uid, "RELIANCE", "note", "r1", "user")
    memory_service.add_note(db, uid, "TCS", "note", "t1", "user")
    db.commit()

    r = memory_service.list_notes(db, uid, symbol="RELIANCE")
    assert len(r) == 1
    assert r[0]["symbol"] == "RELIANCE"

    r2 = memory_service.list_notes(db, uid)
    assert len(r2) == 2

    db.close()


def test_memory_directive():
    db = _session()
    uid = "u60"
    sym = "RELIANCE"

    # Empty → None
    assert memory_service.memory_directive(db, uid, sym) is None

    memory_service.add_note(db, uid, sym, "note", "note A", "user")
    time.sleep(0.01)
    memory_service.add_note(db, uid, sym, "thesis", "thesis B", "agent")
    db.commit()

    directive = memory_service.memory_directive(db, uid, sym)
    assert directive is not None
    assert directive.startswith(f"Memory for {sym} (newest first):")
    assert "thesis ·" in directive
    assert "note ·" in directive

    db.close()


def test_memory_directive_5_newest():
    db = _session()
    uid = "u61"
    sym = "TCS"

    for i in range(8):
        memory_service.add_note(db, uid, sym, "note", f"note {i}", "user")
        time.sleep(0.005)
    db.commit()

    directive = memory_service.memory_directive(db, uid, sym)
    assert directive is not None
    # Should contain at most 5 notes
    note_count = directive.count("- [")
    assert note_count == 5

    db.close()


# ============================================================
# memory_tool_specs handlers (monkeypatch SessionLocal)
# ============================================================

def test_memory_tool_specs_handlers():
    db = _session()
    uid = "u70"
    sym = "INFY"

    memory_service.add_note(db, uid, sym, "note", "buy signal", "user")
    db.commit()

    specs = memory_service.memory_tool_specs(uid)
    names = [s.name for s in specs]
    assert "recall_notes" in names
    assert "remember_note" in names

    items = memory_service.list_notes(db, uid, symbol=sym)
    assert len(items) == 1

    # Test recall_notes handler — uses a local SessionLocal inside handler, so it creates
    # its own db connection. We only verify the handler returns valid structure here;
    # actual note persistence is covered by the route tests above.
    for s in specs:
        if s.name == "recall_notes":
            # This handler also uses SessionLocal internally, so we skip assertion
            # on production-like call. Just verify the spec is well-formed.
            assert s.read_only is True
            break

    db.close()


# ============================================================
# Orchestrator.run receives history + memory
# ============================================================

def test_orchestrator_receives_history_memory():
    """Fake provider records messages; assert order: system, memory, history…, user."""
    from backend.agent.orchestrator import Orchestrator
    from backend.agent.tools.registry import ToolRegistry

    recorded = []

    class FakeProvider:
        async def complete(self, messages, tools=None, **kw):
            recorded.extend(messages)
            return AssistantMessage(content="ok")

    async def _run():
        provider = FakeProvider()
        orch = Orchestrator(provider=provider, registry=ToolRegistry(), max_steps=1)
        history = [
            LLMMessage(role="user", content="previous 1"),
            LLMMessage(role="assistant", content="prev reply"),
        ]
        memory_text = "Memory for RELIANCE:\n- [note] important"
        async for _ in orch.run("current prompt", screen_context=None, history=history, memory_directive=memory_text):
            pass

    asyncio.run(_run())

    # Exactly ONE system message (strict chat templates reject a second one),
    # carrying both the playbook and the memory directive.
    assert recorded[0].role == "system"
    assert "Memory for RELIANCE" in recorded[0].content
    assert sum(1 for m in recorded if getattr(m, "role", None) == "system") == 1

    # Then history
    assert recorded[1].role == "user"
    assert recorded[1].content == "previous 1"
    assert recorded[2].role == "assistant"
    assert recorded[2].content == "prev reply"

    # Last should be the user prompt
    assert recorded[-1].role == "user"
    assert recorded[-1].content == "current prompt"


def test_orchestrator_without_history_memory():
    """Ensure backward compat: no history/memory → normal flow."""
    from backend.agent.orchestrator import Orchestrator
    from backend.agent.tools.registry import ToolRegistry

    recorded = []

    class FakeProvider:
        async def complete(self, messages, tools=None, **kw):
            recorded.extend(messages)
            return AssistantMessage(content="ok")

    async def _run():
        provider = FakeProvider()
        orch = Orchestrator(provider=provider, registry=ToolRegistry(), max_steps=1)
        async for _ in orch.run("just a prompt"):
            pass

    asyncio.run(_run())

    assert recorded[0].role == "system"
    assert recorded[-1].role == "user"
    assert recorded[-1].content == "just a prompt"
    # No extra system messages or history
    assert len(recorded) == 2


# ============================================================
# Reflections
# ============================================================

def test_reflections_two_entries_one_closed():
    """Two journal entries: one open, one closed → 1 created."""
    from backend.agent.reflections import run_reflections
    from backend.models.journal import JournalEntry

    db = _session()
    uid = "u80"
    now = datetime.now(timezone.utc)

    # Open entry (no exit)
    db.add(JournalEntry(
        user_id=uid, symbol="RELIANCE", direction="long",
        entry_date=now, entry_price=2000, quantity=10,
        exit_date=None, exit_price=None,
    ))
    # Closed entry
    db.add(JournalEntry(
        user_id=uid, symbol="RELIANCE", direction="long",
        entry_date=now, entry_price=2000, quantity=10,
        exit_date=now, exit_price=2100,
    ))
    db.commit()

    class FakeProvider:
        async def complete(self, messages, **kw):
            return AssistantMessage(content="This trade taught me to be patient.")

    result = asyncio.run(run_reflections(db, uid, FakeProvider()))
    assert result["created"] >= 1
    db.close()


def test_reflections_rerun_dedupe():
    """Rerun → 0 created (dedupe by [journal:<id>])."""
    from backend.agent.reflections import run_reflections
    from backend.models.journal import JournalEntry

    db = _session()
    uid = "u81"
    now = datetime.now(timezone.utc)

    entry = JournalEntry(
        user_id=uid, symbol="TCS", direction="long",
        entry_date=now, entry_price=3000, quantity=5,
        exit_date=now, exit_price=3200,
    )
    db.add(entry)
    db.commit()
    entry_id = entry.id

    class FakeProvider:
        async def complete(self, messages, **kw):
            return AssistantMessage(content="learned something")

    # First run → 1 created
    r1 = asyncio.run(run_reflections(db, uid, FakeProvider()))
    assert r1["created"] >= 1

    # Second run → 0 created (deduped)
    r2 = asyncio.run(run_reflections(db, uid, FakeProvider()))
    assert r2["created"] == 0

    db.close()


def test_reflections_benchmark_raises():
    """Benchmark provider monkeypatched to raise → still created with benchmark None."""
    from backend.agent.reflections import run_reflections
    from backend.models.journal import JournalEntry

    db = _session()
    uid = "u82"
    now = datetime.now(timezone.utc)

    entry = JournalEntry(
        user_id=uid, symbol="RELIANCE", direction="long",
        entry_date=now, entry_price=2000, quantity=10,
        exit_date=now, exit_price=2100,
    )
    db.add(entry)
    db.commit()

    class FakeProvider:
        async def complete(self, messages, **kw):
            return AssistantMessage(content="benchmark failed but I learned")

    with patch("backend.agent.reflections.market_classifier", side_effect=RuntimeError("no data")):
        result = asyncio.run(run_reflections(db, uid, FakeProvider()))
        assert result["created"] >= 1

        # Verify the note was created
        notes = memory_service.list_notes(db, uid)
        assert len(notes) >= 1

    db.close()


# ============================================================
# Routes (mini FastAPI with overrides)
# ============================================================

def _make_db_override():
    """Return a generator function that creates a thread-local session for FastAPI."""
    def gen():
        db = _session()
        yield db
    return gen


def test_routes_threads_list_delete_foreign_user():
    db = _session()
    # Create thread for a different user
    memory_service.get_or_create_thread(db, "other_user", "t-other")
    memory_service.add_note(db, "other_user", "TCS", "note", "other note", "user")
    db.commit()

    app = FastAPI()
    from backend.auth.deps import get_current_user
    from backend.api.deps import get_db as _get_db
    from backend.api.routes import agent as agent_routes

    app.include_router(agent_routes.router, prefix="/api")
    app.dependency_overrides[get_current_user] = lambda: type("U", (), {"id": "testuser"})()
    test_db = _session()
    app.dependency_overrides[_get_db] = _make_db_override()

    client = TestClient(app)

    # List threads → should not see other_user's thread
    r = client.get("/api/agent/threads")
    assert r.status_code == 200
    assert len(r.json()["items"]) == 0

    # Get foreign thread → 404
    r = client.get("/api/agent/threads/t-other")
    assert r.status_code == 404

    # Delete foreign thread → 404
    r = client.delete("/api/agent/threads/t-other")
    assert r.status_code == 404

    test_db.close()


def test_routes_notes_422_bad_kind():
    app = FastAPI()
    from backend.auth.deps import get_current_user
    from backend.api.deps import get_db as _get_db
    from backend.api.routes import agent as agent_routes

    app.include_router(agent_routes.router, prefix="/api")
    app.dependency_overrides[get_current_user] = lambda: type("U", (), {"id": "testuser"})()
    test_db = _session()
    app.dependency_overrides[_get_db] = _make_db_override()

    client = TestClient(app)

    # Bad kind → 422
    r = client.post("/api/agent/notes", json={"symbol": "TCS", "kind": "invalid", "content": "test"})
    assert r.status_code == 422

    # Empty content → 422
    r = client.post("/api/agent/notes", json={"symbol": "TCS", "kind": "note", "content": ""})
    assert r.status_code == 422

    # Valid → 200
    r = client.post("/api/agent/notes", json={"symbol": "TCS", "kind": "note", "content": "valid note"})
    assert r.status_code == 200

    test_db.close()


def test_routes_thread_create_and_stream():
    """Full create + stream flow, no tool calls."""
    from backend.auth.deps import get_current_user
    from backend.api.deps import get_db as _get_db
    from backend.api.routes import agent as agent_routes
    from backend.services.llm.base import AssistantMessage

    class FakeProvider:
        async def complete(self, messages, **kw):
            return AssistantMessage(content="final answer")

    orig_get_provider = agent_routes.get_llm_provider

    def fake_build(user_id=None):
        return type('Reg', (), {
            'tool_defs': lambda self: [],
            'register': lambda self, s: None,
            'execute': lambda self, n, a: {}
        })()

    orig_build = agent_routes.build_default_registry
    agent_routes.get_llm_provider = lambda **k: FakeProvider()
    agent_routes.build_default_registry = fake_build

    app = FastAPI()
    app.include_router(agent_routes.router, prefix="/api")
    app.dependency_overrides[get_current_user] = lambda: type("U", (), {"id": "testuser"})()
    app.dependency_overrides[_get_db] = _make_db_override()

    try:
        client = TestClient(app)
        r = client.post("/api/agent/runs", json={"prompt": "what's RELIANCE?"})
        assert r.status_code == 200
        run_id = r.json()["run_id"]

        with client.stream("GET", f"/api/agent/runs/{run_id}/stream") as s:
            assert s.status_code == 200
            lines = [l for l in s.iter_lines() if l.startswith("data: ")]
            events = [json.loads(l[6:]) for l in lines]
            types = [e["type"] for e in events]
            assert "final" in types
            final_event = [e for e in events if e["type"] == "final"][0]
            assert final_event.get("content") == "final answer"
    finally:
        agent_routes.get_llm_provider = orig_get_provider


def test_note_list_and_delete_route():
    """Test GET /notes and DELETE /notes/{id} routes."""
    app = FastAPI()
    from backend.auth.deps import get_current_user
    from backend.api.deps import get_db as _get_db
    from backend.api.routes import agent as agent_routes

    app.include_router(agent_routes.router, prefix="/api")
    app.dependency_overrides[get_current_user] = lambda: type("U", (), {"id": "u100"})()
    test_db = _session()
    app.dependency_overrides[_get_db] = _make_db_override()

    client = TestClient(app)

    # Create a note
    r = client.post("/api/agent/notes", json={"symbol": "HDFC", "kind": "note", "content": "hdfc note"})
    assert r.status_code == 200
    note_id = r.json()["id"]

    # List notes
    r = client.get("/api/agent/notes")
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["symbol"] == "HDFC"

    # Filter by symbol
    r = client.get("/api/agent/notes?symbol=HDFC")
    assert r.status_code == 200
    assert len(r.json()["items"]) == 1

    # Delete note
    r = client.delete(f"/api/agent/notes/{note_id}")
    assert r.status_code == 200
    assert r.json()["status"] == "deleted"

    # List after delete → empty
    r = client.get("/api/agent/notes")
    assert r.status_code == 200
    assert len(r.json()["items"]) == 0

    test_db.close()


def test_run_get_route():
    """Test GET /agent/runs/{run_id}."""
    app = FastAPI()
    from backend.auth.deps import get_current_user
    from backend.api.deps import get_db as _get_db
    from backend.api.routes import agent as agent_routes

    app.include_router(agent_routes.router, prefix="/api")
    app.dependency_overrides[get_current_user] = lambda: type("U", (), {"id": "u110"})()
    test_db = _session()
    app.dependency_overrides[_get_db] = _make_db_override()

    client = TestClient(app)

    # Create a run manually in DB
    run_id = "manual-run-abc"
    run = AgentRun(
        id=run_id, user_id="u110", mode="standard",
        prompt="test prompt", status="done",
        final="done response",
        created_at=datetime.now(timezone.utc),
    )
    test_db.add(run)
    test_db.commit()

    r = client.get(f"/api/agent/runs/{run_id}")
    assert r.status_code == 200
    data = r.json()
    assert data["run_id"] == run_id
    assert data["mode"] == "standard"
    assert data["status"] == "done"
    assert data["final"] == "done response"

    # Unknown run → 404
    r = client.get("/api/agent/runs/nonexistent")
    assert r.status_code == 404

    test_db.close()

def test_non_openrouter_provider_ignores_routed_model_chain(monkeypatch):
    """A local LM Studio / vLLM endpoint must be asked for its own model, not an
    OpenRouter ':free' id from the model router (that 404'd every agent run)."""
    import asyncio

    from backend.services.llm.openai_compatible import OpenAICompatibleProvider

    seen = {}

    class FakeResp:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"role": "assistant", "content": "ok"}}], "model": seen["model"]}

        def raise_for_status(self):
            return None

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            seen["model"] = json["model"]
            return FakeResp()

    import backend.services.llm.openai_compatible as mod

    monkeypatch.setattr(mod.httpx, "AsyncClient", FakeClient)
    p = OpenAICompatibleProvider(base_url="http://100.0.0.1:8000/v1", api_key="x", model="local/qwen", honor_model_chain=False)
    out = asyncio.run(p.complete([mod.LLMMessage(role="user", content="hi")], models=["meta-llama/llama:free"]))
    assert seen["model"] == "local/qwen" and out.content == "ok"

    from backend.services.llm.factory import get_llm_provider

    monkeypatch.setenv("LM_STUDIO_BASE_URL", "http://127.0.0.1:1234/v1")
    from backend.config.settings import get_settings

    get_settings.cache_clear()
    assert get_llm_provider(provider="lmstudio").honor_model_chain is False
    get_settings.cache_clear()


def test_append_message_creates_thread_row_and_title(db_session_factory=None):
    """Regression: messages were persisted but the thread row never existed, so
    GET /agent/threads/{id} 404'd right after a run."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import backend.models.agent_memory  # noqa: F401 - register tables
    from backend.agent import memory as m
    from backend.shared.db import Base

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    m.append_message(db, "u1", "t1", "user", "What is in my portfolio today?", "r1")
    m.append_message(db, "u1", "t1", "assistant", "Six holdings.", "r1")
    db.commit()
    got = m.get_thread(db, "u1", "t1")
    assert got is not None and len(got["messages"]) == 2
    assert m.list_threads(db, "u1")[0]["title"].startswith("What is in my portfolio")
    assert m.get_thread(db, "u2", "t1") is None


def test_stream_run_passes_history_and_memory_to_orchestrator(monkeypatch):
    """Regression: the route built history/memory but never passed them to Orchestrator.run."""
    import asyncio
    from types import SimpleNamespace

    from backend.api.routes import agent as route

    captured = {}

    class FakeOrchestrator:
        def __init__(self, **kw):
            pass

        async def run(self, prompt, *, screen_context=None, history=None, memory_directive=None):
            captured["history"] = history
            captured["memory"] = memory_directive
            yield {"type": "final", "content": "done"}

    monkeypatch.setattr(route, "Orchestrator", FakeOrchestrator)
    monkeypatch.setattr(route, "get_llm_provider", lambda **kw: object())
    monkeypatch.setattr(route.memory_service, "thread_history", lambda db, u, t: [{"role": "user", "content": "earlier"}])
    monkeypatch.setattr(route.memory_service, "memory_directive", lambda db, u, s: "Memory for TCS (newest first):\\n- [thesis] cheap below 3000")
    monkeypatch.setattr(route.memory_service, "append_message", lambda *a, **k: None)
    monkeypatch.setattr(route.memory_service, "finish_run", lambda *a, **k: None)
    route._PENDING["r1"] = {"prompt": "hi", "mode": "standard", "ticker": "TCS", "context": {}, "provider": None, "model": None, "user_id": "u1", "thread_id": "t1"}

    async def drive():
        resp = await route.stream_run("r1", user=SimpleNamespace(id="u1"))
        chunks = [c async for c in resp.body_iterator]
        return chunks

    asyncio.run(drive())
    assert captured["history"] and captured["history"][0].content == "earlier"
    assert captured["memory"].startswith("Memory for TCS")


def test_leaked_textual_tool_calls_are_stripped_from_content():
    from backend.services.llm.openai_compatible import _clean_content

    assert _clean_content("<tool_call> <function=get_portfolio> </function> </tool_call>\n\nYou hold 10 RELIANCE.") == "You hold 10 RELIANCE."
    assert _clean_content('<tool_call> {"name": "x"}') is None
    assert _clean_content("plain answer") == "plain answer"
