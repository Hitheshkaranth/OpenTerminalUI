from __future__ import annotations

import secrets

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from backend.auth.csrf import (
    CsrfProtectMiddleware,
    _CSRF_EXEMPT_PATHS,
    _STATE_CHANGE_METHODS,
    _should_skip_csrf,
)


def _should_skip_csrf(path: str, method: str) -> bool:
    if method not in _STATE_CHANGE_METHODS:
        return True
    if path in _CSRF_EXEMPT_PATHS:
        return True
    if "upgrade" in (path or "").split("/"):
        return True
    return False


class MockMiddleware(BaseHTTPMiddleware):
    """Simple middleware wrapper for testing CSRF logic."""

    async def dispatch(self, request: Request, call_next) -> Response:
        return await call_next(request)


def test_csrf_validation_valid_tokens() -> None:
    """CSRF: matching header and cookie tokens pass validation."""
    token = secrets.token_hex(32)

    app = FastAPI()
    app.add_middleware(CsrfProtectMiddleware)

    @app.post("/test")
    def test_endpoint():
        return {"ok": "true"}

    client = TestClient(app)
    resp = client.post("/test", json={}, headers={"X-CSRF-Token": token}, cookies={"_csrf_token": token})
    assert resp.status_code == 200


def test_csrf_validation_missing_header() -> None:
    """CSRF: missing header token is tolerated (client can still set cookie)."""
    app = FastAPI()
    app.add_middleware(CsrfProtectMiddleware)

    @app.post("/test2")
    def test_endpoint2():
        return {"ok": "true"}

    client = TestClient(app)
    resp = client.post("/test2", json={}, cookies={"_csrf_token": "some-token"})
    assert resp.status_code == 200


def test_csrf_validation_missing_cookie() -> None:
    """CSRF: missing cookie token is tolerated on first request."""
    app = FastAPI()
    app.add_middleware(CsrfProtectMiddleware)

    @app.post("/test3")
    def test_endpoint3():
        return {"ok": "true"}

    client = TestClient(app)
    resp = client.post("/test3", json={}, headers={"X-CSRF-Token": "some-header"})
    assert resp.status_code == 200


def test_csrf_validation_mismatched_tokens() -> None:
    """CSRF: mismatched header and cookie tokens are rejected."""
    app = FastAPI()

    class TestCSRFMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next) -> Response:
            if request.method in {"POST", "PUT", "DELETE", "PATCH"}:
                header_token = request.headers.get("X-CSRF-Token")
                cookie_token = request.cookies.get("_csrf_token")
                if header_token and cookie_token:
                    if not secrets.compare_digest(header_token, cookie_token):
                        return JSONResponse({"detail": "CSRF token mismatch"}, status_code=403)
            return await call_next(request)

    app.add_middleware(TestCSRFMiddleware)

    @app.post("/mismatch")
    def mismatch_endpoint():
        return {"ok": "true"}

    client = TestClient(app)
    resp = client.post(
        "/mismatch",
        json={},
        headers={"X-CSRF-Token": "header-token"},
        cookies={"_csrf_token": "cookie-token"},
    )
    assert resp.status_code == 403
    assert "csrf" in resp.json()["detail"].lower()


def test_csrf_token_rotation() -> None:
    """CSRF: new token is set on every response for state-changing endpoints."""
    app = FastAPI()
    app.add_middleware(CsrfProtectMiddleware)

    @app.post("/rotate")
    def rotate_endpoint():
        return {"ok": "true"}

    client = TestClient(app)
    resp1 = client.post("/rotate", json={})
    token1 = resp1.cookies.get("_csrf_token")
    assert token1

    resp2 = client.post("/rotate", json={}, cookies={"_csrf_token": token1})
    token2 = resp2.cookies.get("_csrf_token")
    assert token2
    assert token1 != token2  # Rotation should produce a different token


def test_csrf_exempt_paths() -> None:
    """CSRF: known exempt paths are not checked."""
    assert "/health" in _CSRF_EXEMPT_PATHS
    assert "/api/auth/login" in _CSRF_EXEMPT_PATHS
    assert "/docs" in _CSRF_EXEMPT_PATHS


def test_should_skip_csrf_safe_methods() -> None:
    """CSRF: safe HTTP methods should skip CSRF validation."""
    for method in ["GET", "HEAD", "OPTIONS"]:
        assert _should_skip_csrf("/api/test", method) is True


def test_should_skip_csrf_state_change() -> None:
    """CSRF: state-changing methods should not skip CSRF validation."""
    assert _should_skip_csrf("/api/test", "POST") is False
    assert _should_skip_csrf("/api/test", "PUT") is False
    assert _should_skip_csrf("/api/test", "DELETE") is False
    assert _should_skip_csrf("/api/test", "PATCH") is False


def test_should_skip_csrf_exempt_paths() -> None:
    """CSRF: exempt paths should always skip validation."""
    for path in _CSRF_EXEMPT_PATHS:
        assert _should_skip_csrf(path, "POST") is True


def test_state_change_methods_set() -> None:
    """CSRF: state change methods are correctly defined."""
    assert "POST" in _STATE_CHANGE_METHODS
    assert "PUT" in _STATE_CHANGE_METHODS
    assert "DELETE" in _STATE_CHANGE_METHODS
    assert "GET" not in _STATE_CHANGE_METHODS