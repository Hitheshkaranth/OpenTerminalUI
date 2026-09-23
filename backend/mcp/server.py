"""Expose the agent tool registry, resources and prompts through MCP.

The server is built per-principal: an MCP session carries the identity of the
API key that opened it, so the registry it sees includes the user's portfolio
and proposal tools and excludes write tools when the key is read-only.
Building it without a principal yields the anonymous, read-only market tools.
"""

from __future__ import annotations

import json
from typing import Any

import mcp.types as types
from mcp.server import Server

from backend.agent.tools.market_tools import build_default_registry
from backend.agent.tools.envelope import ensure_envelope
from backend.agent.tools.registry import ToolRegistry
from backend.mcp import prompts as prompt_lib
from backend.mcp import resources as resource_lib

SERVER_NAME = "openterminalui"

# Resources and prompts are user-scoped; an anonymous stdio session has no user
# rows to read, so it advertises tools only.
ANONYMOUS_USER = ""


def list_tools_for(registry: ToolRegistry) -> list[types.Tool]:
    """Map the registry's ToolDefs to MCP Tool descriptors."""
    return [
        types.Tool(name=definition.name, description=definition.description, inputSchema=definition.parameters)
        for definition in registry.tool_defs()
    ]


async def call_tool_for(
    registry: ToolRegistry, name: str, arguments: dict[str, Any] | None
) -> list[types.TextContent]:
    """Execute a tool and return a JSON response without raising to the client."""
    try:
        result = await registry.execute(name, arguments or {})
    except KeyError:
        result = {"error": f"unknown tool: {name}"}
    except Exception as exc:  # tool failures are returned to the MCP client
        result = {"error": str(exc)}
    return [types.TextContent(type="text", text=json.dumps(ensure_envelope(result), default=str))]


def build_mcp_server(
    registry: ToolRegistry | None = None,
    *,
    user_id: str = ANONYMOUS_USER,
) -> Server:
    """Build an MCP server backed by the agent tool registry."""
    reg = registry or build_default_registry(user_id or None)
    server = Server(SERVER_NAME)

    @server.list_tools()
    async def _list() -> list[types.Tool]:
        return list_tools_for(reg)

    @server.call_tool()
    async def _call(name: str, arguments: dict[str, Any] | None) -> list[types.TextContent]:
        return await call_tool_for(reg, name, arguments)

    @server.list_resources()
    async def _list_resources() -> list[types.Resource]:
        if not user_id:
            return []
        return [
            types.Resource(
                uri=item["uri"],
                name=item["name"],
                description=item.get("description"),
                mimeType=item.get("mimeType", "application/json"),
            )
            for item in resource_lib.list_resources(user_id)
        ]

    @server.read_resource()
    async def _read_resource(uri: Any) -> str:
        if not user_id:
            return json.dumps({"ok": False, "error": {"code": "no_principal"}})
        return json.dumps(resource_lib.read_resource(str(uri), user_id), default=str)

    @server.list_prompts()
    async def _list_prompts() -> list[types.Prompt]:
        return [
            types.Prompt(
                name=item["name"],
                description=item.get("description"),
                arguments=[
                    types.PromptArgument(
                        name=arg["name"],
                        description=arg.get("description"),
                        required=bool(arg.get("required")),
                    )
                    for arg in item.get("arguments", [])
                ],
            )
            for item in prompt_lib.list_prompts()
        ]

    @server.get_prompt()
    async def _get_prompt(name: str, arguments: dict[str, str] | None) -> types.GetPromptResult:
        spec = prompt_lib.get_prompt(name, arguments or {})
        return types.GetPromptResult(
            description=spec.get("description"),
            messages=[
                types.PromptMessage(
                    role=msg["role"],
                    content=types.TextContent(type="text", text=msg["content"]["text"]),
                )
                for msg in spec["messages"]
            ],
        )

    return server


async def run_stdio() -> None:
    """Run the default registry adapter over MCP stdio."""
    from mcp.server.stdio import stdio_server

    server = build_mcp_server()
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())
