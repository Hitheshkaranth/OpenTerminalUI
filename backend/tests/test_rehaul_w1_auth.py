from __future__ import annotations

import logging

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.auth import middleware as auth_middleware
from backend.auth.deps import auth_exempt_path, get_current_user
from backend.auth.jwt import create_access_token, create_password_reset_token, decode_token
from backend.auth.middleware import AuthMiddleware
from backend.config import security as security_module
from backend.equity.routes import auth as auth_routes
from backend.equity.routes.auth import router as auth_router
from backend.models.user import RefreshToken, User, UserRole
from backend.shared.db import Base

AUTH_LOGGER = "backend.equity.routes.auth"


def _build_app() -> tuple[FastAPI, sessionmaker]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.add_middleware(AuthMiddleware)
    app.include_router(auth_router)
    app.state.db_session_factory = TestingSessionLocal

    def _get_db_override():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _get_db_override

    @app.get("/api/private")
    def private(user: User = Depends(get_current_user)) -> dict[str, str]:
        return {"id": user.id, "role": user.role.value}

    return app, TestingSessionLocal


def _register(client: TestClient, email: str, password: str = "password123") -> None:
    assert client.post("/api/auth/register", json={"email": email, "password": password}).status_code == 200


def _login(client: TestClient, email: str, password: str = "password123"):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def _request_reset_token(client: TestClient, caplog, email: str):
    caplog.clear()
    with caplog.at_level(logging.WARNING, logger=AUTH_LOGGER):
        resp = client.post("/api/auth/forgot-access", json={"email": email})
    tokens = [r.args[-1] for r in caplog.records if "Password reset requested" in r.getMessage()]
    return resp, tokens


def test_old_forgot_access_payload_no_longer_changes_password(caplog) -> None:
    app, _ = _build_app()
    client = TestClient(app)
    _register(client, "victim@example.com")

    resp = client.post(
        "/api/auth/forgot-access", json={"email": "victim@example.com", "new_password": "attacker-pass-1"}
    )
    assert resp.status_code == 204
    assert _login(client, "victim@example.com", "attacker-pass-1").status_code == 401
    assert _login(client, "victim@example.com").status_code == 200


def test_forgot_access_is_generic_and_token_not_in_response(caplog) -> None:
    app, _ = _build_app()
    client = TestClient(app)
    _register(client, "known@example.com")

    known, known_tokens = _request_reset_token(client, caplog, "known@example.com")
    unknown, unknown_tokens = _request_reset_token(client, caplog, "nobody@example.com")

    assert known.status_code == unknown.status_code == 204
    assert known.content == unknown.content == b""
    assert len(known_tokens) == 1 and unknown_tokens == []
    assert known_tokens[0] not in known.text
    assert known_tokens[0] not in str(dict(known.headers))
    claims = decode_token(known_tokens[0])
    assert claims["purpose"] == "pwd_reset"
    assert claims["exp"] - claims["iat"] == 30 * 60


def test_reset_token_works_once_then_fails(caplog) -> None:
    app, SessionLocal = _build_app()
    client = TestClient(app)
    _register(client, "reset@example.com")
    tokens = _login(client, "reset@example.com").json()

    _, issued = _request_reset_token(client, caplog, "reset@example.com")
    token = issued[0]

    ok = client.post("/api/auth/reset-password", json={"token": token, "new_password": "brand-new-pass"})
    assert ok.status_code == 204
    assert _login(client, "reset@example.com", "brand-new-pass").status_code == 200
    assert _login(client, "reset@example.com").status_code == 401

    again = client.post("/api/auth/reset-password", json={"token": token, "new_password": "third-pass-123"})
    assert again.status_code == 400
    assert _login(client, "reset@example.com", "brand-new-pass").status_code == 200

    # Refresh tokens issued before the reset are revoked.
    assert client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 401


def test_reset_password_rejects_access_token_and_garbage() -> None:
    app, SessionLocal = _build_app()
    client = TestClient(app)
    _register(client, "x@example.com")
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.email == "x@example.com").one()
        access = create_access_token(user.id, user.email, user.role.value)
        expired = create_password_reset_token(user.id, user.hashed_password, ttl_minutes=-1)
    finally:
        db.close()

    for bad in (access, expired, "not-a-jwt"):
        resp = client.post("/api/auth/reset-password", json={"token": bad, "new_password": "whatever-123"})
        assert resp.status_code == 400
    assert _login(client, "x@example.com").status_code == 200


def test_admin_reset_password_requires_admin() -> None:
    app, SessionLocal = _build_app()
    client = TestClient(app)
    _register(client, "admin@example.com")
    _register(client, "user@example.com")
    db: Session = SessionLocal()
    try:
        admin = db.query(User).filter(User.email == "admin@example.com").one()
        admin.role = UserRole.ADMIN
        db.commit()
        admin_token = create_access_token(admin.id, admin.email, "admin")
    finally:
        db.close()
    viewer_token = _login(client, "user@example.com").json()["access_token"]

    body = {"email": "user@example.com", "new_password": "admin-set-pass"}
    assert client.post("/api/auth/admin/reset-password", json=body).status_code == 401
    denied = client.post(
        "/api/auth/admin/reset-password", json=body, headers={"Authorization": f"Bearer {viewer_token}"}
    )
    assert denied.status_code == 403
    ok = client.post("/api/auth/admin/reset-password", json=body, headers={"Authorization": f"Bearer {admin_token}"})
    assert ok.status_code == 204
    assert _login(client, "user@example.com", "admin-set-pass").status_code == 200


def test_unset_env_is_production_and_refuses_dev_bypass(monkeypatch) -> None:
    monkeypatch.delenv("OPENTERMINALUI_ENV", raising=False)
    monkeypatch.setenv("E2E_DEV_AUTH", "1")
    monkeypatch.setenv("AUTH_MIDDLEWARE_ENABLED", "0")

    assert security_module.get_app_env() == "production"
    assert security_module.is_development_env() is False
    assert security_module.dev_auth_bypass_enabled() is False
    assert security_module.auth_middleware_disabled() is False
    assert auth_exempt_path("/docs") is False
    assert auth_exempt_path("/openapi.json") is False

    app, _ = _build_app()
    client = TestClient(app)
    assert client.get("/api/private").status_code == 401

    monkeypatch.delenv("JWT_SECRET_KEY", raising=False)
    security_module._ephemeral_secrets.clear()
    with pytest.raises(RuntimeError, match="JWT_SECRET_KEY"):
        security_module.validate_runtime_secrets()
    security_module._ephemeral_secrets.clear()


def test_dev_env_names(monkeypatch) -> None:
    for name in ("development", "dev", "local", "test"):
        monkeypatch.setenv("OPENTERMINALUI_ENV", name)
        assert security_module.is_development_env() is True
    for name in ("", "production", "staging", "testing"):
        monkeypatch.setenv("OPENTERMINALUI_ENV", name)
        assert security_module.is_development_env() is False
    monkeypatch.setenv("OPENTERMINALUI_ENV", "development")
    assert auth_exempt_path("/docs") is True


def test_registration_disabled_in_production_except_bootstrap(monkeypatch) -> None:
    monkeypatch.setenv("OPENTERMINALUI_ENV", "production")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 64)
    monkeypatch.delenv("REGISTRATION_ENABLED", raising=False)
    app, _ = _build_app()
    client = TestClient(app)

    # Empty users table: the first (bootstrap) account may register.
    assert client.post("/api/auth/register", json={"email": "first@example.com", "password": "password123"}).status_code == 200
    blocked = client.post("/api/auth/register", json={"email": "second@example.com", "password": "password123"})
    assert blocked.status_code == 403

    monkeypatch.setenv("REGISTRATION_ENABLED", "1")
    assert client.post("/api/auth/register", json={"email": "second@example.com", "password": "password123"}).status_code == 200


def test_refresh_token_reuse_revokes_all_sessions() -> None:
    app, SessionLocal = _build_app()
    client = TestClient(app)
    _register(client, "reuse@example.com")
    first = _login(client, "reuse@example.com").json()
    other_session = _login(client, "reuse@example.com").json()

    rotated = client.post("/api/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert rotated.status_code == 200

    replay = client.post("/api/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert replay.status_code == 401

    for tok in (rotated.json()["refresh_token"], other_session["refresh_token"]):
        assert client.post("/api/auth/refresh", json={"refresh_token": tok}).status_code == 401
    db: Session = SessionLocal()
    try:
        assert db.query(RefreshToken).filter(RefreshToken.revoked_at.is_(None)).count() == 0
    finally:
        db.close()


def test_login_lockout_after_ten_failures() -> None:
    app, _ = _build_app()
    client = TestClient(app)
    _register(client, "lock@example.com")

    for _ in range(10):
        assert _login(client, "lock@example.com", "wrong-password").status_code == 401
    # Locked: even the right password is refused with 423.
    assert _login(client, "lock@example.com").status_code == 423
    # Other accounts are unaffected.
    _register(client, "free@example.com")
    assert _login(client, "free@example.com").status_code == 200

    auth_routes._reset_login_lockouts()
    assert _login(client, "lock@example.com").status_code == 200


def test_successful_login_resets_failure_counter() -> None:
    app, _ = _build_app()
    client = TestClient(app)
    _register(client, "mixed@example.com")
    for _ in range(9):
        assert _login(client, "mixed@example.com", "wrong-password").status_code == 401
    assert _login(client, "mixed@example.com").status_code == 200
    for _ in range(9):
        assert _login(client, "mixed@example.com", "wrong-password").status_code == 401
    assert _login(client, "mixed@example.com").status_code == 200


def test_middleware_user_cache_hits_and_invalidates(monkeypatch) -> None:
    # Several legacy test modules set AUTH_MIDDLEWARE_ENABLED=0 at import time and
    # never restore it; pin it here so this test always exercises the middleware.
    monkeypatch.setenv("AUTH_MIDDLEWARE_ENABLED", "1")
    auth_middleware.invalidate_user_cache()
    app, _ = _build_app()
    client = TestClient(app)
    _register(client, "cache@example.com")
    access = _login(client, "cache@example.com").json()["access_token"]
    headers = {"Authorization": f"Bearer {access}"}

    calls = {"n": 0}
    real_load = auth_middleware._load_user

    def _counting_load(factory, user_id):
        calls["n"] += 1
        return real_load(factory, user_id)

    monkeypatch.setattr(auth_middleware, "_load_user", _counting_load)
    assert client.get("/api/private", headers=headers).status_code == 200
    assert client.get("/api/private", headers=headers).status_code == 200
    assert calls["n"] == 1

    auth_middleware.invalidate_user_cache()
    assert client.get("/api/private", headers=headers).status_code == 200
    assert calls["n"] == 2


def test_rate_limit_key_respects_proxy_header_only_when_trusted(monkeypatch) -> None:
    from starlette.requests import Request

    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(b"x-forwarded-for", b"6.6.6.6, 10.0.0.9")],
        "client": ("127.0.0.1", 1234),
    }
    monkeypatch.delenv("TRUST_PROXY_HEADERS", raising=False)
    assert auth_routes._client_ip_key(Request(scope)) == "127.0.0.1"
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    assert auth_routes._client_ip_key(Request(scope)) == "10.0.0.9"
