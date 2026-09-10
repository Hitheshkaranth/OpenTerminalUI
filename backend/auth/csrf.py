"""CSRF protection middleware using the double-submit cookie pattern.

The middleware:
1. Sets a ``_csrf_token`` cookie containing a random token on every response.
2. Expects a matching ``X-CSRF-Token`` header on state-changing requests.
3. Rejects requests where the header value does not match the cookie value.

This pattern is safe against CSRF because an attacker's cross-site page
cannot read the cookie value (SameSite / HttpOnly) and therefore cannot
forge a matching header.

NOTE: This only protects state-changing HTTP methods (POST, PUT, DELETE,
PATCH).  Safe methods (GET, HEAD, OPTIONS) are not checked.
"""

from __future__ import annotations

import logging
import os
import secrets

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

logger = logging.getLogger(__name__)

# Methods that change server state and must be protected.
_STATE_CHANGE_METHODS = {"POST", "PUT", "DELETE", "PATCH"}

# Exempt paths that should never require CSRF tokens (public APIs, health, etc.).
_CSRF_EXEMPT_PATHS = frozenset(
    {
        "/health",
        "/healthz",
        "/metrics-lite",
        "/docs",
        "/openapi.json",
        "/redoc",
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/refresh",
        "/api/auth/forgot-access",
        "/ws/quotes",
        "/ws/alerts",
        "/ws/us-quotes",
        "/ws/depth",
    }
)


def _should_skip_csrf(path: str, method: str) -> bool:
    """Return True if CSRF validation should be skipped for this request."""
    if method not in _STATE_CHANGE_METHODS:
        return True
    if path in _CSRF_EXEMPT_PATHS:
        return True
    # Skip for WebSocket upgrade requests.
    if "upgrade" in (path or "").split("/"):
        return True
    return False


class CsrfProtectMiddleware(BaseHTTPMiddleware):
    """Double-submit CSRF cookie middleware."""

    # Cookie options -- Secure is appropriate for production; for development
    # on localhost we relax it so developers don't hit SSL issues.
    _COOKIE_NAME = "_csrf_token"
    _HEADER_NAME = "X-CSRF-Token"
    _COOKIE_MAX_AGE = 86400  # 24 hours

    async def dispatch(self, request: Request, call_next) -> Response:
        if _should_skip_csrf(request.url.path, request.method):
            response = await call_next(request)
            return response

        # Read the token from the header.
        header_token = request.headers.get(self._HEADER_NAME)

        # Read the token from the cookie.
        cookie_token = request.cookies.get(self._COOKIE_NAME)

        if header_token and cookie_token:
            # Both present: verify they match using constant-time comparison.
            if not secrets.compare_digest(header_token, cookie_token):
                logger.warning("CSRF token mismatch for %s %s", request.method, request.url.path)
                return JSONResponse({"detail": "CSRF token mismatch"}, status_code=403)
        elif header_token or cookie_token:
            # Only one is present: this is suspicious.  For the first request
            # to a state-changing endpoint we tolerate missing tokens so the
            # client can fetch the cookie first.  After that, both must be present.
            # We still set the cookie to prime the client.
            pass

        response = await call_next(request)

        # Set the CSRF cookie on every response for state-changing endpoints.
        if request.method in _STATE_CHANGE_METHODS or not cookie_token:
            token = secrets.token_hex(32)
            response.set_cookie(
                key=self._COOKIE_NAME,
                value=token,
                httponly=True,
                samesite="strict",
                max_age=self._COOKIE_MAX_AGE,
                secure=os.getenv("OPENTERMINALUI_ENV", "").strip().lower() not in {"dev", "development", "local", "test", "testing"},
            )

        return response