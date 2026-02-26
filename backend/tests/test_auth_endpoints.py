from __future__ import annotations


from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.auth.deps import get_current_user, require_role
from backend.auth.jwt import create_access_token
from backend.auth.middleware import AuthMiddleware
from backend.shared.db import Base
from backend.equity.routes.auth import router as auth_router
from backend.models.user import RefreshToken, User, UserRole


def _build_test_app() -> tuple[FastAPI, sessionmaker]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
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
    def private(_: User = Depends(get_current_user)) -> dict[str, str]:
        return {"ok": "true"}

    @app.get("/api/admin-only")
    def admin_only(_: User = Depends(require_role("admin"))) -> dict[str, str]:
        return {"ok": "true"}

    return app, TestingSessionLocal


def _register_and_login(client: TestClient, email: str = "user@example.com", password: str = "password123") -> dict:
    r1 = client.post("/api/auth/register", json={"email": email, "password": password, "role": "viewer"})
    assert r1.status_code == 200
    r2 = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r2.status_code == 200
    return r2.json()


def test_register_login_and_protected_route() -> None:
    app, _ = _build_test_app()
    client = TestClient(app)
    tokens = _register_and_login(client)

    private = client.get("/api/private", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert private.status_code == 200


def test_invalid_credentials() -> None:
    app, _ = _build_test_app()
    client = TestClient(app)
    client.post("/api/auth/register", json={"email": "u1@example.com", "password": "password123", "role": "viewer"})
    bad = client.post("/api/auth/login", json={"email": "u1@example.com", "password": "wrongpass"})
    assert bad.status_code == 401


def test_expired_access_token_rejected() -> None:
    app, SessionLocal = _build_test_app()
    client = TestClient(app)
    _register_and_login(client, email="u2@example.com")

    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.email == "u2@example.com").first()
        assert user is not None
        expired = create_access_token(user.id, user.email, user.role.value, ttl_minutes=-1)
    finally:
        db.close()

    res = client.get("/api/private", headers={"Authorization": f"Bearer {expired}"})
    assert res.status_code == 401


def test_refresh_flow_invalidates_old_token() -> None:
    app, _ = _build_test_app()
    client = TestClient(app)
    tokens = _register_and_login(client, email="u3@example.com")

    first = client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert first.status_code == 200
    second = client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert second.status_code == 401


def test_role_authorization() -> None:
    app, SessionLocal = _build_test_app()
    client = TestClient(app)
    tokens = _register_and_login(client, email="u4@example.com")

    denied = client.get("/api/admin-only", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert denied.status_code == 403

    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.email == "u4@example.com").first()
        assert user is not None
        user.role = UserRole.ADMIN
        db.commit()
        db.refresh(user)
        admin_access = create_access_token(user.id, user.email, user.role.value)
    finally:
        db.close()

    allowed = client.get("/api/admin-only", headers={"Authorization": f"Bearer {admin_access}"})
    assert allowed.status_code == 200


def test_forgot_access_resets_password_and_revokes_refresh_tokens() -> None:
    app, SessionLocal = _build_test_app()
    client = TestClient(app)
    email = "u5@example.com"
    old_password = "password123"
    new_password = "newpassword123"
    tokens = _register_and_login(client, email=email, password=old_password)

    reset = client.post("/api/auth/forgot-access", json={"email": email, "new_password": new_password})
    assert reset.status_code == 204

    old_login = client.post("/api/auth/login", json={"email": email, "password": old_password})
    assert old_login.status_code == 401

    new_login = client.post("/api/auth/login", json={"email": email, "password": new_password})
    assert new_login.status_code == 200

    refresh_with_old = client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refresh_with_old.status_code == 401

    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        assert user is not None
        active_tokens = (
            db.query(RefreshToken)
            .filter(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
            .count()
        )
        assert active_tokens == 1
    finally:
        db.close()
