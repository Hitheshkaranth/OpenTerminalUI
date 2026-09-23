from __future__ import annotations

import pytest

from backend.core.api_key_auth import generate_api_key
from backend.mcp.auth import McpAuthError, authenticate
from backend.models.api_key import APIKeyORM
from backend.models.user import User, UserRole
from backend.shared.db import Base, SessionLocal, engine, init_db


def _init_fresh_db() -> None:
    Base.metadata.drop_all(bind=engine)
    init_db()


def _create_user_and_key(permissions: str = "read", is_active: int = 1):
    db = SessionLocal()
    try:
        user = User(
            email=f"mcp-auth-{permissions}-{is_active}@example.com",
            hashed_password="x",
            role=UserRole.TRADER,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        full_key, prefix, key_hash = generate_api_key()
        record = APIKeyORM(
            user_id=user.id,
            name="mcp test key",
            key_prefix=prefix,
            key_hash=key_hash,
            permissions=permissions,
            is_active=is_active,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        # Detach-proof: hand back plain values, not ORM instances bound to
        # this closed session.
        return user.id, full_key, record.id
    finally:
        db.close()


def test_valid_key_returns_principal_with_user_and_permissions():
    _init_fresh_db()
    user_id, full_key, key_id = _create_user_and_key("read_write")

    principal = authenticate(full_key)

    assert principal.user_id == user_id
    assert principal.key_id == key_id
    assert principal.permissions == "read_write"
    assert principal.name == "mcp test key"


def test_bad_key_raises_mcp_auth_error():
    _init_fresh_db()
    _create_user_and_key("read")

    with pytest.raises(McpAuthError):
        authenticate("otui_this-key-does-not-exist")


def test_inactive_key_raises_mcp_auth_error():
    _init_fresh_db()
    _, full_key, _ = _create_user_and_key("read", is_active=0)

    with pytest.raises(McpAuthError):
        authenticate(full_key)


def test_read_key_does_not_allow_writes():
    _init_fresh_db()
    _, full_key, _ = _create_user_and_key("read")

    principal = authenticate(full_key)

    assert principal.allow_writes is False


def test_read_write_key_allows_writes():
    _init_fresh_db()
    _, full_key, _ = _create_user_and_key("read_write")

    principal = authenticate(full_key)

    assert principal.allow_writes is True


def test_missing_key_raises_mcp_auth_error():
    _init_fresh_db()

    with pytest.raises(McpAuthError):
        authenticate("")


def test_authenticate_bumps_last_used_at():
    _init_fresh_db()
    _, full_key, key_id = _create_user_and_key("read")

    authenticate(full_key)

    db = SessionLocal()
    try:
        refreshed = db.query(APIKeyORM).filter(APIKeyORM.id == key_id).first()
        assert refreshed.last_used_at is not None
    finally:
        db.close()
