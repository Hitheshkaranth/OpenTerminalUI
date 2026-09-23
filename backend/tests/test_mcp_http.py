from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.agent.tools.registry import ToolRegistry, ToolSpec
from backend.core.api_key_auth import generate_api_key
from backend.mcp import http_app as http_app_module
from backend.mcp.session import _registry_cache
from backend.models.api_key import APIKeyORM
from backend.models.user import User, UserRole
from backend.shared.db import Base, SessionLocal, engine, init_db


def _init_fresh_db() -> None:
    Base.metadata.drop_all(bind=engine)
    init_db()
    _registry_cache.clear()


def _make_key(permissions: str = "read") -> str:
    db = SessionLocal()
    try:
        user = User(email=f"mcp-http-{permissions}@example.com", hashed_password="x", role=UserRole.TRADER)
        db.add(user)
        db.commit()
        db.refresh(user)

        full_key, prefix, key_hash = generate_api_key()
        record = APIKeyORM(
            user_id=user.id,
            name="mcp http key",
            key_prefix=prefix,
            key_hash=key_hash,
            permissions=permissions,
        )
        db.add(record)
        db.commit()
        return full_key
    finally:
        db.close()


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(http_app_module.build_mcp_router())
    return TestClient(app)


def test_tools_endpoint_rejects_missing_api_key():
    _init_fresh_db()
    res = _client().get("/mcp/tools")
    assert res.status_code == 401


def test_tools_endpoint_rejects_bad_api_key():
    _init_fresh_db()
    res = _client().get("/mcp/tools", headers={"X-API-Key": "otui_not-a-real-key"})
    assert res.status_code == 401


def test_list_tools_with_valid_key_excludes_write_tools_for_read_key():
    _init_fresh_db()
    key = _make_key("read")

    res = _client().get("/mcp/tools", headers={"X-API-Key": key})

    assert res.status_code == 200
    body = res.json()
    names = {t["name"] for t in body["tools"]}
    assert "get_portfolio" in names
    assert "propose_paper_order" not in names
    for tool in body["tools"]:
        assert set(tool) == {"name", "description", "inputSchema"}


def test_call_tool_executes_and_returns_result():
    _init_fresh_db()
    key = _make_key("read")

    res = _client().post("/mcp/tools/get_portfolio", json={"arguments": {}}, headers={"X-API-Key": key})

    assert res.status_code == 200
    body = res.json()
    assert isinstance(body, dict)
    # Normalised envelope: get_portfolio is a legacy-shaped tool, so the MCP
    # boundary wraps it rather than leaking two different result shapes.
    assert body["ok"] is True
    assert "items" in body["data"]


def test_call_unknown_tool_returns_404():
    _init_fresh_db()
    key = _make_key("read")

    res = _client().post("/mcp/tools/not_a_real_tool", json={"arguments": {}}, headers={"X-API-Key": key})

    assert res.status_code == 404


def test_raising_handler_returns_ok_false_not_500(monkeypatch):
    _init_fresh_db()
    key = _make_key("read")

    async def _boom(args: dict) -> dict:
        raise RuntimeError("kaboom")

    fake_registry = ToolRegistry()
    fake_registry.register(
        ToolSpec(
            name="boom",
            description="always raises",
            parameters={"type": "object", "properties": {}},
            handler=_boom,
            read_only=True,
            write_class="none",
        )
    )
    monkeypatch.setattr(http_app_module, "build_session_registry", lambda principal: fake_registry)

    res = _client().post("/mcp/tools/boom", json={"arguments": {}}, headers={"X-API-Key": key})

    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is False
    assert body["error"]["message"] == "kaboom"


def test_manifest_reports_tool_count_and_permissions():
    _init_fresh_db()
    key = _make_key("read_write")

    res = _client().get("/mcp/manifest", headers={"X-API-Key": key})

    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "openterminalui"
    assert body["permissions"] == "read_write"
    assert body["tool_count"] > 0
