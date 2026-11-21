"""Helpers for per-user ownership scoping of persisted records."""
from __future__ import annotations

from typing import Any


def is_admin(user: Any) -> bool:
    role = getattr(user, "role", None)
    return str(getattr(role, "value", role) or "").lower() == "admin"


def owner_scope(user: Any) -> str | None:
    """Owner id to filter by, or None when the caller (an admin) may see every record."""
    return None if is_admin(user) else str(user.id)


def can_access(user: Any, owner_id: str | None) -> bool:
    return is_admin(user) or (owner_id is not None and str(owner_id) == str(user.id))
