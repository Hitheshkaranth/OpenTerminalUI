import json

import mcp.types as types
import pytest
from mcp.server import Server

from backend.agent.tools.registry import ToolRegistry, ToolSpec
from backend.mcp.server import SERVER_NAME, build_mcp_server, call_tool_for, list_tools_for


def make_registry() -> ToolRegistry:
    async def echo(arguments: dict[str, object]) -> dict[str, object]:
        return {"received": arguments, "status": "ok"}

    registry = ToolRegistry()
    registry.register(ToolSpec(
        name="echo",
        description="Return supplied arguments.",
        parameters={
            "type": "object",
            "properties": {"message": {"type": "string"}},
            "required": ["message"],
        },
        handler=echo,
        read_only=True,
    ))
    return registry


def test_list_tools_maps_registry_definitions() -> None:
    tools = list_tools_for(make_registry())

    assert len(tools) == 1
    assert isinstance(tools[0], types.Tool)
    assert tools[0].name == "echo"
    assert tools[0].description == "Return supplied arguments."
    assert tools[0].inputSchema == {
        "type": "object",
        "properties": {"message": {"type": "string"}},
        "required": ["message"],
    }


@pytest.mark.asyncio
async def test_call_tool_returns_json_result() -> None:
    content = await call_tool_for(make_registry(), "echo", {"message": "hello"})

    assert len(content) == 1
    assert isinstance(content[0], types.TextContent)
    # The MCP boundary normalises every result into an envelope so external
    # clients see one shape across legacy and newer tools.
    payload = json.loads(content[0].text)
    assert payload["ok"] is True
    assert payload["data"] == {"received": {"message": "hello"}, "status": "ok"}
    assert payload["provenance"]["quality"] == "delayed"


@pytest.mark.asyncio
async def test_call_unknown_tool_returns_error_payload() -> None:
    content = await call_tool_for(make_registry(), "nope", {})

    payload = json.loads(content[0].text)
    assert payload["ok"] is False
    assert payload["error"]["message"] == "unknown tool: nope"


@pytest.mark.asyncio
async def test_call_failing_tool_returns_error_payload() -> None:
    async def fail(_arguments: dict[str, object]) -> None:
        raise RuntimeError("boom")

    registry = ToolRegistry()
    registry.register(ToolSpec("fail", "Always fails.", {"type": "object"}, fail, read_only=True))

    content = await call_tool_for(registry, "fail", {})

    payload = json.loads(content[0].text)
    assert payload["ok"] is False
    assert payload["error"]["message"] == "boom"


def test_build_mcp_server_uses_expected_name() -> None:
    server = build_mcp_server(make_registry())

    assert isinstance(server, Server)
    assert server.name == SERVER_NAME
