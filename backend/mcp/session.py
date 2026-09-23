"""Per-user, permission-scoped tool registries for MCP sessions.

Before this module, ``backend/mcp/server.py`` called ``build_default_registry()``
with no ``user_id``, so every MCP session silently lost portfolio and proposal
tools (those only register when a user is known) and any caller could reach
write tools regardless of their API key's permissions. ``build_session_registry``
fixes both: it supplies the authenticated user and then filters by the key's
write permission.
"""

from __future__ import annotations

from backend.agent.tools.market_tools import build_default_registry
from backend.agent.tools.registry import ToolRegistry
from backend.mcp.auth import McpPrincipal

# Building the full registry re-imports and re-registers every tool spec, which
# is wasted work on every MCP call for the same user. A plain dict is enough:
# sessions are per-process and there's no eviction need at this scale.
_registry_cache: dict[tuple[str, bool], ToolRegistry] = {}


def build_session_registry(principal: McpPrincipal) -> ToolRegistry:
    """Return the tool registry a given principal is allowed to see, cached."""
    cache_key = (principal.user_id, principal.allow_writes)
    cached = _registry_cache.get(cache_key)
    if cached is not None:
        return cached

    full = build_default_registry(user_id=principal.user_id)
    view = full.filtered(allow_writes=principal.allow_writes)
    _registry_cache[cache_key] = view
    return view
