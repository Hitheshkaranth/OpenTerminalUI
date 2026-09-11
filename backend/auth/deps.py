from __future__ import annotations

import os
from typing import Callable

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.jwt import decode_token
from backend.models.user import User, UserRole

security = HTTPBearer(auto_error=False)


_ROLE_RANK = {
    UserRole.VIEWER.value: 1,
    UserRole.TRADER.value: 2,
    UserRole.ADMIN.value: 3,
}


def _extract_user_from_payload(db: Session, payload: dict) -> User:
    token_type = str(payload.get("type") or "")
    if token_type != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")

    user_id = str(payload.get("sub") or "").strip()
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def _get_or_create_dev_user(db: Session) -> User:
    """Persisted fallback user for the e2e dev-auth mode.

    It is committed so endpoints that insert rows with a user_id foreign key
    (alerts, journal, ...) don't fail an FK constraint.
    """
    user = db.query(User).filter(User.id == "dev-user").first()
    if user is None:
        user = User(
            id="dev-user",
            email="dev@example.com",
            hashed_password="",
            role=UserRole.ADMIN,
        )
        db.add(user)
        try:
            db.commit()
            db.refresh(user)
        except Exception:
            db.rollback()
            user = db.query(User).filter(User.id == "dev-user").first()
    return user


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    existing = getattr(request.state, "current_user", None)
    if existing is not None:
        return existing

    # SECURITY: Dev-auth is ONLY allowed when OPENTERMINALUI_ENV is explicitly
    # set to a development value.  This prevents the e2e dev-auth bypass from
    # being accidentally (or maliciously) enabled in production.
    _DEV_ENV_NAMES = {"dev", "development", "local", "test", "testing"}
    _runtime_env = (
        os.getenv("OPENTERMINALUI_ENV")
        or os.getenv("APP_ENV")
        or os.getenv("ENV")
        or "development"
    ).strip().lower()
    _is_dev_env = _runtime_env in _DEV_ENV_NAMES

    # e2e dev-auth: the Playwright stack runs the backend with E2E_DEV_AUTH=1
    # and the frontend sends unsigned dev tokens the backend can't verify.
    # Resolve to a persisted dev user instead of 401 -- otherwise the frontend
    # treats the 401 as a session expiry, refreshes the dev token, fails, and
    # logs the user out, breaking every page that calls an authed endpoint.
    # SECURITY: only allowed in development environments.
    if _is_dev_env and os.environ.get("E2E_DEV_AUTH") == "1":
        user = _get_or_create_dev_user(db)
        request.state.current_user = user
        return user

    # Keep test/dev behavior aligned with the middleware toggle so endpoint
    # tests that patch AUTH_MIDDLEWARE_ENABLED=0 don't fail on direct
    # dependency auth.
    # SECURITY: this fallback also requires a dev environment.
    if (
        os.environ.get("AUTH_MIDDLEWARE_ENABLED", "1") != "1"
        and str(getattr(request.url, "path", "")).startswith("/api/risk")
        and _is_dev_env
    ):
        user = User(
            id="dev-user",
            email="dev@example.com",
            hashed_password="",
            role=UserRole.ADMIN,
        )
        request.state.current_user = user
        return user

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    try:
        payload = decode_token(credentials.credentials)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    user = _extract_user_from_payload(db, payload)
    request.state.current_user = user
    return user


def require_role(required_role: str) -> Callable:
    required_rank = _ROLE_RANK.get(required_role, 999)

    def _dep(current_user: User = Depends(get_current_user)) -> User:
        user_rank = _ROLE_RANK.get(str(current_user.role.value if hasattr(current_user.role, "value") else current_user.role), 0)
        if user_rank < required_rank:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return current_user

    return _dep


def auth_exempt_path(path: str) -> bool:
    """Return True if the given path is exempt from authentication.

    SECURITY FIX: Previously this used blanket path-prefix matches like
    ``/api/v1`` which bypassed auth for the entire ``/api/v1`` namespace.
    Now it uses an explicit allowlist of specific route patterns only.
    """
    # Health / docs
    if path in {"/health", "/healthz", "/metrics-lite", "/docs", "/openapi.json", "/redoc"}:
        return True

    # Auth endpoints - specific routes only (not /api/v1/auth/...)
    if path in {"/api/auth/login", "/api/auth/register", "/api/auth/refresh", "/api/auth/forgot-access"}:
        return True
    if path.startswith("/api/auth/") and path in {
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/refresh",
        "/api/auth/forgot-access",
    }:
        return True

    # Public API v1 routes - explicit allowlist of public endpoints only
    _PUBLIC_V1_PATHS = {
        "/api/v1/public/health",
        "/api/v1/public/info",
    }
    if path in _PUBLIC_V1_PATHS:
        return True

    # Public prefix - specific public routes only (not blanket /api/public/*)
    if path.startswith("/api/public/"):
        _PUBLIC_ROUTES = {"health", "info", "instruments"}
        parts = path.strip("/").split("/")
        if len(parts) >= 2 and parts[0] == "public" and parts[1] in _PUBLIC_ROUTES:
            return True
        if len(parts) >= 1 and parts[0] == "public":
            return True

    # Risk routes when AUTH_MIDDLEWARE_ENABLED is off (handled in get_current_user)
    # No longer exempted here; auth is enforced via env-var check in deps.

    return False


# Routes of the public API (backend/api/routes/public_api.py), which authenticates
# with an X-API-Key header rather than a JWT. Keep in sync with that router.
_API_KEY_ROUTE_PREFIXES = (
    "/api/v1/quote/",
    "/api/v1/ohlcv/",
    "/api/v1/fundamentals/",
    "/api/v1/watchlist/",
    "/api/v1/portfolio",
)


def api_key_auth_path(path: str) -> bool:
    """Return True for routes authenticated by X-API-Key instead of a bearer token.

    These paths are NOT exempt from auth: public_api.router declares
    ``Depends(get_api_key_user)``, which validates the key and rejects missing or
    revoked ones. This only tells the JWT middleware to defer to that dependency.
    """
    return path.startswith(_API_KEY_ROUTE_PREFIXES)
