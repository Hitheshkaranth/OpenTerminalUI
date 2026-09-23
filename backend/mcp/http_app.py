"""MCP over HTTP so external clients (Claude Code/Desktop) can reach it over the network.

The stdio server in ``backend/mcp/server.py`` only works for a client that can
spawn the process locally. This module exposes the same tool surface as a
FastAPI router, authenticated per-request via ``X-API-Key`` and scoped to the
caller's user and write permission through ``backend.mcp.session``.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request

from backend.agent.tools.envelope import ensure_envelope, err
from backend.config.settings import get_settings
from backend.mcp.auth import McpAuthError, McpPrincipal, authenticate
from backend.mcp.session import build_session_registry


def _authenticate(x_api_key: str | None) -> McpPrincipal:
    if not x_api_key:
        raise HTTPException(status_code=401, detail="Missing X-API-Key header")
    try:
        return authenticate(x_api_key)
    except McpAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def _jsonable(payload: Any) -> Any:
    """Round-trip through json.dumps(default=str) so datetimes etc. serialise safely."""
    return json.loads(json.dumps(payload, default=str))


def build_mcp_router() -> APIRouter:
    """Build the ``/mcp`` router. The caller wires this into the main app."""
    router = APIRouter(prefix="/mcp", tags=["mcp"])

    @router.get("/manifest")
    async def manifest(x_api_key: str | None = Header(default=None, alias="X-API-Key")) -> dict[str, Any]:
        principal = _authenticate(x_api_key)
        registry = build_session_registry(principal)
        settings = get_settings()
        return {
            "name": "openterminalui",
            "version": settings.app_version,
            "tool_count": len(registry.names()),
            "permissions": principal.permissions,
        }

    @router.get("/tools")
    async def list_tools(x_api_key: str | None = Header(default=None, alias="X-API-Key")) -> dict[str, Any]:
        principal = _authenticate(x_api_key)
        registry = build_session_registry(principal)
        tools = [
            {"name": d.name, "description": d.description, "inputSchema": d.parameters}
            for d in registry.tool_defs()
        ]
        return _jsonable({"tools": tools})

    @router.post("/tools/{name}")
    async def call_tool(
        name: str,
        request: Request,
        x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    ) -> dict[str, Any]:
        principal = _authenticate(x_api_key)
        registry = build_session_registry(principal)
        if name not in registry.names():
            raise HTTPException(status_code=404, detail=f"unknown tool: {name}")

        raw_body = await request.body()
        body = json.loads(raw_body) if raw_body else {}
        arguments = body.get("arguments", {}) if isinstance(body, dict) else {}

        # Tool failures are data the agent reasons over, not transport errors,
        # so a raising handler becomes an ok:false envelope, not a 500.
        try:
            result = await registry.execute(name, arguments)
        except Exception as exc:  # noqa: BLE001 - deliberately broad, see docstring
            result = err(str(exc))
        # Legacy market tools predate the envelope; normalise so every MCP
        # client sees one shape regardless of when the tool was written.
        return _jsonable(ensure_envelope(result))

    return router
