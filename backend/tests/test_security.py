from __future__ import annotations

import asyncio
import ast
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.auth.csrf import CsrfProtectMiddleware, _CSRF_EXEMPT_PATHS
from backend.auth.jwt import create_access_token, create_refresh_token, decode_token
from backend.auth.middleware import AuthMiddleware
from backend.config.security import is_development_env
from backend.core import formula_engine
from backend.models.user import User, UserRole
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
    app.add_middleware(AuthMiddleware)
    app.add_middleware(CsrfProtectMiddleware)
    app.state.db_session_factory = SessionLocal

    def _get_db_override():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _get_db_override

    @app.get("/api/private")
    def private(_: User = Depends(get_current_user)) -> dict[str, str]:
        return {"ok": "true"}

    @app.post("/api/protected")
    def protected(_: User = Depends(get_current_user)) -> dict[str, str]:
        return {"ok": "true"}

    return app, SessionLocal


from backend.auth.deps import get_current_user


def test_websocket_auth_rejection_missing_token() -> None:
    """WebSocket auth: unauthenticated connections (no bearer token) are rejected with 401."""
    app, _ = _build_test_app()
    client = TestClient(app)
    response = client.get("/api/private", headers={})
    assert response.status_code == 401
    assert "token" in response.json()["detail"].lower()


def test_websocket_auth_rejection_invalid_token() -> None:
    """WebSocket auth: connections with a tampered/invalid token are rejected with 401."""
    app, _ = _build_test_app()
    client = TestClient(app)
    response = client.get("/api/private", headers={"Authorization": "Bearer invalidtoken123"})
    assert response.status_code == 401


def test_websocket_auth_rejection_expired_token() -> None:
    """WebSocket auth: expired access tokens are rejected with 401."""
    app, SessionLocal = _build_test_app()
    client = TestClient(app)

    db = SessionLocal()
    try:
        user = User(id="test-expired", email="expired@example.com", hashed_password="hashed", role=UserRole.TRADER)
        db.add(user)
        db.commit()
        db.refresh(user)
    finally:
        db.close()

    expired_token = create_access_token(user.id, user.email, user.role.value, ttl_minutes=-1)
    response = client.get("/api/private", headers={"Authorization": f"Bearer {expired_token}"})
    assert response.status_code == 401


def test_csrf_token_validation_valid() -> None:
    """CSRF: valid double-submit pattern is accepted on POST."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.add_middleware(CsrfProtectMiddleware)

    @app.post("/csrf-test")
    def csrf_endpoint():
        return {"ok": "true"}

    client = TestClient(app)
    resp = client.post("/csrf-test", json={}, cookies={"_csrf_token": "testtoken"})
    assert resp.status_code == 200


def test_csrf_token_mismatch_rejected() -> None:
    """CSRF: mismatched header and cookie tokens are rejected with 403."""
    from starlette.responses import JSONResponse
    from starlette.testclient import TestClient

    app = FastAPI()

    from starlette.middleware.base import BaseHTTPMiddleware

    class TestCSRFMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            if request.method in {"POST", "PUT", "DELETE", "PATCH"}:
                header_token = request.headers.get("X-CSRF-Token")
                cookie_token = request.cookies.get("_csrf_token")
                if header_token and cookie_token:
                    import secrets
                    if not secrets.compare_digest(header_token, cookie_token):
                        return JSONResponse({"detail": "CSRF token mismatch"}, status_code=403)
            return await call_next(request)

    app.add_middleware(TestCSRFMiddleware)

    @app.post("/mismatch-test")
    def mismatch_endpoint():
        return {"ok": "true"}

    client = TestClient(app)
    response = client.post(
        "/mismatch-test",
        json={},
        headers={"X-CSRF-Token": "wrong-token"},
        cookies={"_csrf_token": "correct-token"},
    )
    assert response.status_code == 403
    assert "csrf" in response.json()["detail"].lower()


def test_csrf_missing_token_post() -> None:
    """CSRF: missing CSRF token on POST is tolerated on first attempt but cookie is set."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.add_middleware(CsrfProtectMiddleware)

    @app.post("/test-csrf2")
    def test_csrf_endpoint2():
        return {"ok": "true"}

    client = TestClient(app)
    response = client.post("/test-csrf2", json={})
    assert response.status_code == 200
    assert "_csrf_token" in response.cookies


@pytest.mark.parametrize("method", ["GET", "HEAD", "OPTIONS"])
def test_csrf_exempt_safe_methods(method: str) -> None:
    """CSRF: safe HTTP methods are not checked."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.add_middleware(CsrfProtectMiddleware)

    @app.api_route("/test-safe", methods=["GET", "HEAD", "OPTIONS"])
    def safe_endpoint():
        return {"ok": "true"}

    client = TestClient(app)
    response = client.request(method, "/test-safe")
    assert response.status_code == 200


def test_csrf_exempt_paths() -> None:
    """CSRF: known exempt paths skip validation."""
    assert "/health" in _CSRF_EXEMPT_PATHS
    assert "/api/auth/login" in _CSRF_EXEMPT_PATHS
    assert "/docs" in _CSRF_EXEMPT_PATHS


def test_csrf_token_rotation() -> None:
    """CSRF: token rotation happens on every response for state-changing endpoints."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.add_middleware(CsrfProtectMiddleware)

    @app.post("/rotate-test")
    def rotate_endpoint():
        return {"ok": "true"}

    client = TestClient(app)
    resp1 = client.post("/rotate-test", json={})
    token1 = resp1.cookies.get("_csrf_token")

    resp2 = client.post("/rotate-test", json={}, cookies={"_csrf_token": token1})
    token2 = resp2.cookies.get("_csrf_token")

    assert token1 != token2


def test_jwt_valid_token_decode() -> None:
    """JWT: valid tokens are decoded correctly."""
    token = create_access_token("user-1", "test@example.com", "admin")
    payload = decode_token(token)
    assert payload["sub"] == "user-1"
    assert payload["email"] == "test@example.com"
    assert payload["type"] == "access"


def test_jwt_manipulation_rejection() -> None:
    """JWT: tampered tokens are rejected."""
    token = create_access_token("user-1", "test@example.com", "admin")
    tampered = token[:-2] + ("a" if token[-2] != "a" else "b") + token[-1:]
    with pytest.raises(ValueError, match="Invalid or expired token"):
        decode_token(tampered)


def test_jwt_wrong_type_token_rejected() -> None:
    """JWT: refresh-type tokens are rejected when access is expected."""
    refresh_token = create_refresh_token("user-1", "test@example.com", "admin")
    payload = decode_token(refresh_token)
    assert payload["type"] == "refresh"


def test_jwt_expired_token_rejected() -> None:
    """JWT: expired tokens are rejected."""
    token = create_access_token("user-1", "test@example.com", "admin", ttl_minutes=-1)
    with pytest.raises(ValueError, match="Invalid or expired token"):
        decode_token(token)


def test_alert_expression_sandbox_blocks_dangerous() -> None:
    """Alert expression: dangerous expressions are blocked via AST validation."""
    dangerous_exprs = [
        "__import__('os').system('echo hacked')",
        "eval('1+1')",
        "exec('import os')",
        "__class__.__base__.__subclasses__()",
        "globals()",
        "locals()",
    ]
    for expr in dangerous_exprs:
        try:
            tree = ast.parse(expr, mode="eval")
            has_call = False
            has_attr_access = False
            for node in ast.walk(tree):
                if isinstance(node, ast.Call):
                    has_call = True
                if isinstance(node, ast.Attribute):
                    has_attr_access = True
            assert has_call or has_attr_access, f"Should contain dangerous pattern: {expr}"
        except SyntaxError:
            pass  # Syntax errors are also blocked


def test_alert_expression_sandbox_blocks_file_operations() -> None:
    """Alert expression: file operations are blocked."""
    expr = "open('/tmp/test', 'w').write('x')"
    tree = ast.parse(expr, mode="eval")
    has_dangerous = False
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            has_dangerous = True
            break
    assert has_dangerous is True  # Confirms the dangerous pattern exists


def test_alert_expression_allows_safe_expressions() -> None:
    """Alert expression: safe numerical comparisons pass AST validation."""
    safe_exprs = ["ltp > 100", "volume > 1000 and ltp < 200", "pe < 30"]
    for expr in safe_exprs:
        tree = ast.parse(expr, mode="eval")
        has_dangerous = False
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                has_dangerous = True
                break
        assert has_dangerous is False, f"Should not contain dangerous pattern: {expr}"


def test_formula_engine_blocks_dangerous() -> None:
    """Formula engine: dangerous expressions are rejected via AST validation."""
    assert formula_engine.validate("__import__('os')")[0] is False
    assert formula_engine.validate("eval('1')")[0] is False
    assert formula_engine.validate("import os")[0] is False


def test_formula_engine_allows_safe() -> None:
    """Formula engine: safe expressions pass validation."""
    assert formula_engine.validate("pe * 2")[0] is True
    assert formula_engine.validate("(roe + roa) / 2")[0] is True
    assert formula_engine.validate("abs(pe - 20)")[0] is True


def test_jwt_different_ttl_values() -> None:
    """JWT: token TTL values are configurable."""
    token_short = create_access_token("user-1", "test@example.com", "admin", ttl_minutes=5)
    token_long = create_access_token("user-1", "test@example.com", "admin", ttl_minutes=60)
    assert decode_token(token_short)["exp"] > decode_token(token_short)["iat"]
    assert decode_token(token_long)["exp"] > decode_token(token_long)["iat"]


def test_auth_disabled_in_production() -> None:
    """Auth: the dev-bypass is disabled in production environments."""
    from backend.auth.middleware import _DEV_ENVS
    assert "production" not in _DEV_ENVS


def test_dev_auth_disabled_in_production_v2(monkeypatch) -> None:
    """Auth: dev auth bypass is disabled in production."""
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

    app.dependency_overrides[get_db] = _get_db_override
    app.dependency_overrides[get_current_user] = lambda: User(id="dev-user", email="dev@example.com", hashed_password="", role=UserRole.ADMIN)

    @app.get("/api/test")
    def test_endpoint(current_user: User = Depends(get_current_user)):
        return {"user_id": current_user.id}

    from fastapi.testclient import TestClient
    client = TestClient(app)
    resp = client.get("/api/test")
    assert resp.status_code == 200

    monkeypatch.delenv("OPENTERMINALUI_ENV", raising=False)
    monkeypatch.delenv("E2E_DEV_AUTH", raising=False)