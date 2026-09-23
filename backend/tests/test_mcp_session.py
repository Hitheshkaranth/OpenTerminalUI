from __future__ import annotations

from backend.mcp.auth import McpPrincipal
from backend.mcp.session import _registry_cache, build_session_registry


def _principal(user_id: str = "user-1", permissions: str = "read") -> McpPrincipal:
    return McpPrincipal(user_id=user_id, key_id=1, permissions=permissions, name="test")


def test_read_only_registry_excludes_every_write_tool():
    _registry_cache.clear()
    registry = build_session_registry(_principal(user_id="ro-user", permissions="read"))

    names = registry.names()
    assert "propose_paper_order" not in names
    assert "propose_alert" not in names
    assert "propose_watchlist_add" not in names
    for name in names:
        assert registry.get(name).write_class == "none"


def test_read_only_registry_still_includes_portfolio_tools():
    _registry_cache.clear()
    registry = build_session_registry(_principal(user_id="ro-user-2", permissions="read"))

    # Before the MCP session fix, build_default_registry() was called with no
    # user_id and these tools never registered at all.
    assert "get_portfolio" in registry.names()
    assert "get_watchlists" in registry.names()


def test_read_write_registry_includes_write_tools():
    _registry_cache.clear()
    registry = build_session_registry(_principal(user_id="rw-user", permissions="read_write"))

    names = registry.names()
    assert "propose_paper_order" in names
    assert "propose_alert" in names
    assert "propose_watchlist_add" in names


def test_registry_is_cached_across_calls_for_same_principal():
    _registry_cache.clear()
    principal = _principal(user_id="cache-user", permissions="read")

    first = build_session_registry(principal)
    second = build_session_registry(principal)

    assert first is second


def test_registry_cache_keyed_by_permission_too():
    _registry_cache.clear()
    read_registry = build_session_registry(_principal(user_id="same-user", permissions="read"))
    write_registry = build_session_registry(_principal(user_id="same-user", permissions="read_write"))

    assert read_registry is not write_registry
