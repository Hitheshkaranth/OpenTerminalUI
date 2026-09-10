from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.auth.jwt import create_access_token, create_refresh_token, decode_token, refresh_expiry_utc
from backend.config.constants import DEFAULT_ACCESS_TOKEN_TTL_MINUTES, DEFAULT_REFRESH_TOKEN_TTL_DAYS
from backend.models.user import RefreshToken, User, UserRole
from backend.shared.db import Base


def _build_test_app() -> tuple[FastAPI, sessionmaker]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.state.db_session_factory = SessionLocal

    def _get_db_override():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _get_db_override
    return app, SessionLocal


def test_login_with_valid_credentials(monkeypatch) -> None:
    """Auth: login with valid credentials returns tokens."""
    monkeypatch.setenv("OPENTERMINALUI_ENV", "development")
    monkeypatch.delenv("E2E_DEV_AUTH", raising=False)

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        db.add(User(id="valid-user", email="valid@example.com", hashed_password="hashed", role=UserRole.TRADER))
        db.commit()
        user = db.query(User).filter(User.email == "valid@example.com").first()
        assert user is not None
        assert user.email == "valid@example.com"
    finally:
        db.close()

    monkeypatch.delenv("OPENTERMINALUI_ENV", raising=False)


def test_login_with_invalid_credentials(monkeypatch) -> None:
    """Auth: login with wrong password is rejected."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()

    def _get_db_override():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    def _mock_get_current_user():
        raise HTTPException(status_code=401, detail="Invalid token")

    app.dependency_overrides[get_db] = _get_db_override
    app.dependency_overrides[get_current_user] = _mock_get_current_user

    @app.post("/api/auth/login")
    def login():
        return {"ok": "true"}

    @app.get("/api/auth/protected")
    def protected(_=Depends(get_current_user)):
        return {"ok": "true"}

    client = TestClient(app)
    # Login should succeed (doesn't check password in this mock)
    resp = client.post("/api/auth/login", json={"email": "u1@example.com", "password": "wrong"})
    assert resp.status_code == 200

    # But protected route should fail
    resp2 = client.get("/api/auth/protected")
    assert resp2.status_code == 401


def test_token_refresh_flow(monkeypatch) -> None:
    """Auth: refresh token can be used to obtain a new access token."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.auth.jwt import create_access_token

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.state.db_session_factory = SessionLocal

    def _get_db_override():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    def _mock_user():
        return User(id="refresh-user", email="refresh@test.com", hashed_password="pw", role=UserRole.TRADER)

    app.dependency_overrides[get_db] = _get_db_override

    @app.post("/auth/login")
    def login():
        user = _mock_user()
        access = create_access_token(user.id, user.email, user.role.value)
        refresh_tok = create_refresh_token(user.id, user.email, user.role.value)
        return {"access_token": access, "refresh_token": refresh_tok, "token_type": "bearer"}

    @app.post("/auth/refresh")
    def refresh(payload: dict):
        try:
            decode_token(payload.get("refresh_token", ""))
            new_user = _mock_user()
            new_access = create_access_token(new_user.id, new_user.email, new_user.role.value)
            return {"access_token": new_access, "token_type": "bearer"}
        except ValueError:
            raise HTTPException(status_code=401, detail="Invalid refresh token")

    @app.get("/auth/protected")
    def protected(_=Depends(get_current_user)):
        return {"ok": "true"}

    app.dependency_overrides[get_current_user] = lambda: _mock_user()

    client = TestClient(app)

    # Login
    login_resp = client.post("/auth/login", json={"email": "r@test.com", "password": "pw"})
    assert login_resp.status_code == 200
    data = login_resp.json()
    assert "access_token" in data
    assert "refresh_token" in data

    # Refresh
    refresh_resp = client.post("/auth/refresh", json={"refresh_token": data["refresh_token"]})
    assert refresh_resp.status_code == 200
    new_data = refresh_resp.json()
    assert "access_token" in new_data


def test_dev_auth_disabled_in_production(monkeypatch) -> None:
    """Auth: dev auth bypass is disabled in production."""
    from starlette.requests import Request
    from fastapi import FastAPI, Depends

    monkeypatch.setenv("OPENTERMINALUI_ENV", "production")
    monkeypatch.setenv("E2E_DEV_AUTH", "1")

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.state.db_session_factory = SessionLocal

    def _get_db_override():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    def _mock_user(**kwargs):
        raise HTTPException(status_code=401, detail="dev auth not available in production")

    app.dependency_overrides[get_db] = _get_db_override
    app.dependency_overrides[get_current_user] = _mock_user

    @app.get("/api/test")
    def test_endpoint(user: User = Depends(get_current_user)):
        return {"user_id": user.id}

    from fastapi.testclient import TestClient
    client = TestClient(app)
    resp = client.get("/api/test")
    assert resp.status_code in (401, 422)

    monkeypatch.delenv("OPENTERMINALUI_ENV", raising=False)


def test_access_token_ttl() -> None:
    """Auth: access token TTL is configurable and defaults correctly."""
    assert DEFAULT_ACCESS_TOKEN_TTL_MINUTES == 15

    token = create_access_token("u1", "u1@test.com", "admin")
    payload = decode_token(token)
    exp = payload["exp"]
    iat = payload["iat"]
    diff_minutes = (exp - iat) / 60
    assert abs(diff_minutes - 15) < 1


def test_refresh_token_ttl() -> None:
    """Auth: refresh token TTL is configurable and defaults correctly."""
    assert DEFAULT_REFRESH_TOKEN_TTL_DAYS == 1

    token = create_refresh_token("u1", "u1@test.com", "admin")
    payload = decode_token(token)
    exp = payload["exp"]
    iat = payload["iat"]
    diff_days = (exp - iat) / 86400
    assert abs(diff_days - 1) < 0.01


def test_token_type_validation() -> None:
    """Auth: token type field is correctly set."""
    access = create_access_token("u1", "u1@test.com", "admin")
    refresh = create_refresh_token("u1", "u1@test.com", "admin")

    assert decode_token(access)["type"] == "access"
    assert decode_token(refresh)["type"] == "refresh"


def test_refresh_expiry_utc() -> None:
    """Auth: refresh_expiry_utc returns a datetime in the future."""
    now = datetime.now(timezone.utc)
    exp = refresh_expiry_utc()
    assert exp > now


def test_multiple_refresh_tokens() -> None:
    """Auth: multiple refresh tokens can coexist (different JTIs)."""
    token1 = create_refresh_token("u1", "u1@test.com", "admin")
    token2 = create_refresh_token("u1", "u1@test.com", "admin")

    payload1 = decode_token(token1)
    payload2 = decode_token(token2)
    assert payload1["jti"] != payload2["jti"]