from __future__ import annotations

import re
from typing import Callable

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.jwt import decode_token
from backend.config.security import auth_middleware_disabled, dev_auth_bypass_enabled, is_development_env
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

    # e2e dev-auth: the Playwright stack runs the backend with E2E_DEV_AUTH=1
    # and the frontend sends unsigned dev tokens the backend can't verify.
    # Resolve to a persisted dev user instead of 401 -- otherwise the frontend
    # treats the 401 as a session expiry, refreshes the dev token, fails, and
    # logs the user out, breaking every page that calls an authed endpoint.
    # SECURITY: honoured only when OPENTERMINALUI_ENV is explicitly a development
    # value (unset == production); see backend.config.security.
    if dev_auth_bypass_enabled():
        user = _get_or_create_dev_user(db)
        request.state.current_user = user
        return user

    # Keep test/dev behavior aligned with the middleware toggle so endpoint
    # tests that patch AUTH_MIDDLEWARE_ENABLED=0 don't fail on direct
    # dependency auth.
    # SECURITY: this fallback also requires a dev environment.
    if str(getattr(request.url, "path", "")).startswith("/api/risk") and auth_middleware_disabled():
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


_AUTH_EXEMPT_PATHS = frozenset(
    {
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/refresh",
        "/api/auth/forgot-access",
        "/api/auth/reset-password",
    }
)


def auth_exempt_path(path: str) -> bool:
    """Return True if the given path is exempt from authentication.

    SECURITY FIX: Previously this used blanket path-prefix matches like
    ``/api/v1`` which bypassed auth for the entire ``/api/v1`` namespace.
    Now it uses an explicit allowlist of specific route patterns only.
    """
    # Health
    if path in {"/health", "/healthz", "/metrics-lite"}:
        return True
    # Interactive API docs leak the full route surface; only exempt them in development.
    if path in {"/docs", "/openapi.json", "/redoc"}:
        return is_development_env()

    # Auth endpoints - exact routes only (not /api/v1/auth/..., not /api/auth/admin/...)
    if path in _AUTH_EXEMPT_PATHS:
        return True

    # An unguessable token grants read-only access to one frozen research snapshot.
    # Exact shape only: never exempt the dossier collection, mutations, or nested paths.
    if re.fullmatch(r"/api/research/dossiers/shared/[A-Za-z0-9_-]{43}", path):
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
    # MCP over HTTP (backend/mcp/http_app.py) authenticates with X-API-Key and
    # resolves the key to a user, so the JWT middleware defers to it.
    "/api/mcp/",
)


def api_key_auth_path(path: str) -> bool:
    """Return True for routes authenticated by X-API-Key instead of a bearer token.

    These paths are NOT exempt from auth: public_api.router declares
    ``Depends(get_api_key_user)``, which validates the key and rejects missing or
    revoked ones. This only tells the JWT middleware to defer to that dependency.
    """
    return path.startswith(_API_KEY_ROUTE_PREFIXES)
