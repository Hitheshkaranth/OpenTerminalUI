from __future__ import annotations

import os

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from backend.auth.deps import auth_exempt_path
from backend.auth.jwt import decode_token
from backend.shared.db import SessionLocal
from backend.models.user import User


# Development environments where auth can be relaxed.
_DEV_ENVS = {"dev", "development", "local", "test", "testing"}


def _runtime_env() -> str:
    return (
        os.getenv("OPENTERMINALUI_ENV")
        or os.getenv("APP_ENV")
        or os.getenv("ENV")
        or "development"
    ).strip().lower()


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        auth_enabled = os.getenv("AUTH_MIDDLEWARE_ENABLED", "1") == "1"

        # SECURITY: The AUTH_MIDDLEWARE_ENABLED toggle only applies in
        # development environments.  In production, auth is always enforced.
        _is_dev = _runtime_env() in _DEV_ENVS
        if not _is_dev and not auth_enabled:
            # In production, ignore the dev toggle and enforce auth.
            pass
        elif not auth_enabled or not path.startswith("/api") or auth_exempt_path(path):
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.lower().startswith("bearer "):
            return JSONResponse({"detail": "Missing bearer token"}, status_code=401)
        token = auth_header.split(" ", 1)[1].strip()
        try:
            payload = decode_token(token)
        except Exception:
            return JSONResponse({"detail": "Invalid token"}, status_code=401)

        if str(payload.get("type") or "") != "access":
            return JSONResponse({"detail": "Invalid token type"}, status_code=401)

        user_id = str(payload.get("sub") or "")
        if not user_id:
            return JSONResponse({"detail": "Invalid token subject"}, status_code=401)

        session_factory = getattr(request.app.state, "db_session_factory", SessionLocal)
        db = session_factory()
        try:
            user = db.query(User).filter(User.id == user_id).first()
            if not user:
                return JSONResponse({"detail": "User not found"}, status_code=401)
            request.state.current_user = user
        finally:
            db.close()

        return await call_next(request)
