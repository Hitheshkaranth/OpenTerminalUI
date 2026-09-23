"""API-key authentication for the network-reachable MCP surface.

The stdio MCP server trusted its local process; an HTTP MCP server is
attacker-reachable like any other route, so this module resolves the same
``otui_`` API keys used by the public REST API (``backend/core/api_key_auth.py``)
into an :class:`McpPrincipal` MCP sessions can build a permission-scoped tool
registry from.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass

from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.models.api_key import APIKeyORM
from backend.shared.db import SessionLocal


class McpAuthError(Exception):
    """Raised when an MCP request's API key is missing, invalid, or inactive."""


@dataclass(frozen=True)
class McpPrincipal:
    user_id: str
    key_id: int
    permissions: str
    name: str

    @property
    def allow_writes(self) -> bool:
        return self.permissions == "read_write"


def authenticate(raw_key: str, db: Session | None = None) -> McpPrincipal:
    """Resolve an ``otui_`` API key to an :class:`McpPrincipal`.

    ``backend.core.api_key_auth.verify_api_key`` compares hashes with ``==``,
    which is fine for a dependency FastAPI only reaches after its own routing,
    but this module backs a standalone network surface, so we recompute the
    sha256 hash the same way and compare it with ``hmac.compare_digest`` to
    avoid leaking a timing signal to a remote caller.
    """
    if not raw_key:
        raise McpAuthError("Missing API key")

    owns_session = db is None
    session = db or SessionLocal()
    try:
        prefix = raw_key[:12]
        record = session.query(APIKeyORM).filter(APIKeyORM.key_prefix == prefix).first()
        if record is None:
            raise McpAuthError("Invalid API key")

        computed_hash = hashlib.sha256(raw_key.encode()).hexdigest()
        if not hmac.compare_digest(computed_hash, record.key_hash):
            raise McpAuthError("Invalid API key")

        if record.is_active != 1:
            raise McpAuthError("API key is inactive")

        record.last_used_at = func.now()
        session.commit()

        return McpPrincipal(
            user_id=record.user_id,
            key_id=record.id,
            permissions=record.permissions,
            name=record.name,
        )
    finally:
        if owns_session:
            session.close()
