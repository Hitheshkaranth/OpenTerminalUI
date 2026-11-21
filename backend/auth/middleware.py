from __future__ import annotations

import threading
import time
from collections import OrderedDict
from datetime import datetime
from typing import NamedTuple

from fastapi import Request
from sqlalchemy.orm import make_transient_to_detached
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from backend.auth.deps import api_key_auth_path, auth_exempt_path
from backend.auth.jwt import decode_token
from backend.config.security import _DEV_ENV_NAMES, auth_middleware_disabled
from backend.shared.db import SessionLocal
from backend.models.user import User, UserRole


# Development environments where auth can be relaxed (kept for backwards compatibility).
_DEV_ENVS = _DEV_ENV_NAMES


class _CachedUser(NamedTuple):
    id: str
    email: str
    role: UserRole
    is_active: bool
    created_at: datetime | None
    last_login: datetime | None


# SCALE-2: small TTL cache so authenticated requests don't each hit the DB.
_USER_CACHE_TTL_SECONDS = 30.0
_USER_CACHE_MAX_ENTRIES = 4096
# Keyed by (session factory id, user id) so separate databases (tests, tenants) never share rows.
_user_cache: "OrderedDict[tuple[int, str], tuple[float, _CachedUser]]" = OrderedDict()
_user_cache_lock = threading.Lock()


def invalidate_user_cache(user_id: str | None = None) -> None:
    """Drop one user (or every user when ``user_id`` is None) from the auth cache."""
    with _user_cache_lock:
        if user_id is None:
            _user_cache.clear()
        else:
            for key in [k for k in _user_cache if k[1] == str(user_id)]:
                _user_cache.pop(key, None)


def _cache_get(key: tuple[int, str]) -> _CachedUser | None:
    now = time.monotonic()
    with _user_cache_lock:
        hit = _user_cache.get(key)
        if hit is None:
            return None
        expires_at, cached = hit
        if expires_at <= now:
            _user_cache.pop(key, None)
            return None
        _user_cache.move_to_end(key)
        return cached


def _cache_put(key: tuple[int, str], cached: _CachedUser) -> None:
    with _user_cache_lock:
        _user_cache[key] = (time.monotonic() + _USER_CACHE_TTL_SECONDS, cached)
        _user_cache.move_to_end(key)
        while len(_user_cache) > _USER_CACHE_MAX_ENTRIES:
            _user_cache.popitem(last=False)


def _role_value(role: object) -> str:
    return str(getattr(role, "value", role) or "")


def _load_user(session_factory, user_id: str) -> _CachedUser | None:
    db = session_factory()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if user is None:
            return None
        return _CachedUser(
            id=user.id,
            email=user.email,
            role=user.role,
            is_active=bool(getattr(user, "is_active", True)),
            created_at=user.created_at,
            last_login=user.last_login,
        )
    finally:
        db.close()


def _to_user(cached: _CachedUser) -> User:
    # A fresh detached instance per request: callers never share mutable ORM state,
    # and it behaves like the detached row the middleware used to hand out.
    user = User(
        id=cached.id,
        email=cached.email,
        hashed_password="",
        role=cached.role,
        created_at=cached.created_at,
        last_login=cached.last_login,
    )
    make_transient_to_detached(user)
    return user


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # SECURITY: AUTH_MIDDLEWARE_ENABLED=0 is honoured only in development
        # environments (unset OPENTERMINALUI_ENV == production). Non-API and exempt
        # paths (health, login, refresh) always pass through.
        if not path.startswith("/api") or auth_exempt_path(path) or auth_middleware_disabled():
            return await call_next(request)

        # The public API authenticates with X-API-Key, so a bearer token is not
        # expected there. Hand the request to the route's own get_api_key_user
        # dependency, which validates the key. Requests with no key header fall
        # through to the bearer check below, so nothing becomes unauthenticated.
        if api_key_auth_path(path) and request.headers.get("X-API-Key"):
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
        cache_key = (id(session_factory), user_id)
        cached = _cache_get(cache_key)
        token_role = str(payload.get("role") or "")
        if cached is not None and token_role and token_role != _role_value(cached.role):
            # A token minted with a different role than we cached (e.g. after a
            # promotion + re-login) means the cache is stale: reload from the DB.
            cached = None
        if cached is None:
            # Sync SQLAlchemy query: keep it off the event loop.
            cached = await run_in_threadpool(_load_user, session_factory, user_id)
            if cached is None:
                return JSONResponse({"detail": "User not found"}, status_code=401)
            _cache_put(cache_key, cached)
        if not cached.is_active:
            return JSONResponse({"detail": "User is disabled"}, status_code=401)
        request.state.current_user = _to_user(cached)

        return await call_next(request)
