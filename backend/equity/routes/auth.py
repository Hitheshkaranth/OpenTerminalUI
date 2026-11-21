from __future__ import annotations

import logging
import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.deps import require_role
from backend.auth.jwt import (
    PASSWORD_RESET_PURPOSE,
    create_access_token,
    create_password_reset_token,
    create_refresh_token,
    decode_token,
    password_hash_fingerprint,
    refresh_expiry_utc,
)
from backend.auth.middleware import invalidate_user_cache
from backend.config.security import is_development_env
from backend.models.user import RefreshToken, User, UserRole

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _client_ip_key(request: Request) -> str:
    """Rate-limit key: the client IP.

    X-Forwarded-For is trusted only when TRUST_PROXY_HEADERS=1 (i.e. the app sits
    behind a reverse proxy that sets it). We take the right-most entry -- the address
    the trusted proxy itself observed -- because left-most entries are client-supplied.
    """
    if os.getenv("TRUST_PROXY_HEADERS", "0").strip() == "1":
        forwarded = request.headers.get("X-Forwarded-For", "")
        hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
        if hops:
            return hops[-1]
    return get_remote_address(request)


# Rate limiter (contract C7). Shared Redis storage when REDIS_URL is set so limits
# hold across workers/replicas; in-process memory otherwise.
# Set RATE_LIMIT_ENABLED=0 to switch it off (the test suite does this, since it
# logs in far more often than a real client would).
_RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "1").strip().lower() not in {"0", "false", "no"}
_RATE_LIMIT_STORAGE_URI = os.getenv("REDIS_URL", "").strip() or "memory://"
limiter = Limiter(
    key_func=_client_ip_key,
    enabled=_RATE_LIMIT_ENABLED,
    storage_uri=_RATE_LIMIT_STORAGE_URI,
    in_memory_fallback_enabled=_RATE_LIMIT_STORAGE_URI != "memory://",
)

# Per-account login lockout (SEC-13): 10 failures within 15 minutes locks the
# account for 15 minutes (HTTP 423). Process-local; keyed by normalised email so
# it applies whether or not the account exists.
_LOCKOUT_MAX_FAILURES = 10
_LOCKOUT_WINDOW_SECONDS = 15 * 60
_LOCKOUT_DURATION_SECONDS = 15 * 60
_LOCKOUT_MAX_TRACKED = 10_000
_login_failures: dict[str, list[float]] = {}
_login_locked_until: dict[str, float] = {}
_lockout_lock = threading.Lock()


def _reset_login_lockouts() -> None:
    """Clear all lockout state (used by tests)."""
    with _lockout_lock:
        _login_failures.clear()
        _login_locked_until.clear()


def _is_locked(email: str) -> bool:
    now = time.monotonic()
    with _lockout_lock:
        until = _login_locked_until.get(email)
        if until is None:
            return False
        if until <= now:
            _login_locked_until.pop(email, None)
            return False
        return True


def _record_login_failure(email: str) -> None:
    now = time.monotonic()
    with _lockout_lock:
        if len(_login_failures) > _LOCKOUT_MAX_TRACKED:
            cutoff = now - _LOCKOUT_WINDOW_SECONDS
            for key in [k for k, v in _login_failures.items() if not v or v[-1] < cutoff]:
                _login_failures.pop(key, None)
            for key in [k for k, v in _login_locked_until.items() if v <= now]:
                _login_locked_until.pop(key, None)
        recent = [t for t in _login_failures.get(email, []) if t > now - _LOCKOUT_WINDOW_SECONDS]
        recent.append(now)
        if len(recent) >= _LOCKOUT_MAX_FAILURES:
            _login_locked_until[email] = now + _LOCKOUT_DURATION_SECONDS
            _login_failures.pop(email, None)
            logger.warning("Login locked for %s after %d failed attempts", email, len(recent))
        else:
            _login_failures[email] = recent


def _clear_login_failures(email: str) -> None:
    """Forget failures and any active lock (successful login or password reset)."""
    with _lockout_lock:
        _login_failures.pop(email, None)
        _login_locked_until.pop(email, None)


def _registration_enabled() -> bool:
    default = "1" if is_development_env() else "0"
    return os.getenv("REGISTRATION_ENABLED", default).strip().lower() in {"1", "true", "yes", "on"}


def _naive_utc_now() -> datetime:
    # DB columns are naive; store UTC without tzinfo.
    return datetime.now(timezone.utc).replace(tzinfo=None)

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RegisterRequest(BaseModel):
    email: str
    password: str
    # NOTE: role is intentionally NOT accepted from the registration payload.
    # All accounts start as VIEWER. Role elevation must be done by an admin.


class LoginRequest(BaseModel):
    email: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class ForgotAccessRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class AdminResetPasswordRequest(BaseModel):
    email: str
    new_password: str


class UserResponse(BaseModel):
    id: str
    email: str
    role: UserRole
    created_at: datetime
    last_login: datetime | None = None


class TokenPairResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _validate_email(email: str) -> None:
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Invalid email format")


def _validate_password(password: str) -> None:
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    # bcrypt only supports up to 72 bytes of input.
    if len(password.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail="Password must be at most 72 bytes")


def _build_token_pair(db: Session, user: User) -> TokenPairResponse:
    jti = secrets.token_hex(16)
    access = create_access_token(subject=user.id, email=user.email, role=user.role.value)
    refresh = create_refresh_token(subject=user.id, email=user.email, role=user.role.value, jti=jti)

    db.add(
        RefreshToken(
            user_id=user.id,
            jti=jti,
            expires_at=refresh_expiry_utc(),
            revoked_at=None,
        )
    )
    db.commit()
    return TokenPairResponse(access_token=access, refresh_token=refresh)


@router.post("/register", response_model=UserResponse)
@limiter.limit("5/hour")
def register(request: Request, payload: RegisterRequest, db: Session = Depends(get_db)) -> UserResponse:
    # SEC-14: self-registration is off outside development unless REGISTRATION_ENABLED=1.
    # Bootstrap exception: the very first account may always be created.
    if not _registration_enabled() and db.query(User.id).first() is not None:
        raise HTTPException(status_code=403, detail="Registration is disabled")

    email = _normalize_email(payload.email)
    _validate_email(email)
    _validate_password(payload.password)

    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        email=email,
        hashed_password=pwd_context.hash(payload.password),
        role=UserRole.VIEWER,  # Always start as VIEWER; role escalation is admin-only
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserResponse(
        id=user.id,
        email=user.email,
        role=user.role,
        created_at=user.created_at,
        last_login=user.last_login,
    )


@router.post("/login", response_model=TokenPairResponse)
@limiter.limit("5/minute")
def login(request: Request, payload: LoginRequest, db: Session = Depends(get_db)) -> TokenPairResponse:
    email = _normalize_email(payload.email)
    if _is_locked(email):
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail="Account temporarily locked after repeated failed logins. Try again later.",
        )
    user = db.query(User).filter(User.email == email).first()
    if not user or not user.hashed_password or not pwd_context.verify(payload.password, user.hashed_password):
        _record_login_failure(email)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    _clear_login_failures(email)
    user.last_login = _naive_utc_now()
    db.commit()

    return _build_token_pair(db, user)


@router.post("/refresh", response_model=TokenPairResponse)
@limiter.limit("30/minute")
def refresh(request: Request, payload: RefreshRequest, db: Session = Depends(get_db)) -> TokenPairResponse:
    try:
        decoded = decode_token(payload.refresh_token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid refresh token") from exc

    if str(decoded.get("type") or "") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token type")

    user_id = str(decoded.get("sub") or "").strip()
    jti = str(decoded.get("jti") or "").strip()
    if not user_id or not jti:
        raise HTTPException(status_code=401, detail="Malformed refresh token")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    row = db.query(RefreshToken).filter(RefreshToken.jti == jti, RefreshToken.user_id == user_id).first()
    if not row:
        raise HTTPException(status_code=401, detail="Refresh token not recognized")
    if row.revoked_at is not None:
        # SEC-17: a rotated-out token being replayed means it may have been stolen.
        # Revoke the whole family so neither party keeps a working session.
        _revoke_all_refresh_tokens(db, user.id)
        db.commit()
        logger.warning("Refresh token reuse detected for user %s; all sessions revoked", user.id)
        raise HTTPException(status_code=401, detail="Refresh token already used")
    if row.expires_at < _naive_utc_now():
        raise HTTPException(status_code=401, detail="Refresh token expired")

    row.revoked_at = _naive_utc_now()
    db.commit()

    return _build_token_pair(db, user)


def _revoke_all_refresh_tokens(db: Session, user_id: str) -> None:
    db.query(RefreshToken).filter(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None)).update(
        {RefreshToken.revoked_at: _naive_utc_now()},
        synchronize_session=False,
    )


def _set_password(db: Session, user: User, new_password: str) -> None:
    user.hashed_password = pwd_context.hash(new_password)
    _revoke_all_refresh_tokens(db, user.id)
    db.commit()
    invalidate_user_cache(user.id)


@router.post("/forgot-access", status_code=204, response_class=Response)
@limiter.limit("5/hour")
def forgot_access(request: Request, payload: ForgotAccessRequest, db: Session = Depends(get_db)) -> Response:
    """Request a password reset. Always 204 so account existence is not revealed.

    The single-use reset token is NEVER returned to the caller. There is no email
    infrastructure, so it is written to the server log for operator delivery.
    """
    email = _normalize_email(payload.email)
    if _EMAIL_RE.match(email):
        user = db.query(User).filter(User.email == email).first()
        if user is not None:
            token = create_password_reset_token(user.id, user.hashed_password)
            logger.warning(
                "Password reset requested for %s (user %s). Deliver this single-use token "
                "(valid 30 minutes) to the account owner out of band: %s",
                email,
                user.id,
                token,
            )
    return Response(status_code=204)


@router.post("/reset-password", status_code=204, response_class=Response)
@limiter.limit("5/hour")
def reset_password(request: Request, payload: ResetPasswordRequest, db: Session = Depends(get_db)) -> Response:
    invalid = HTTPException(status_code=400, detail="Invalid or expired reset token")
    try:
        decoded = decode_token(payload.token.strip())
    except ValueError as exc:
        raise invalid from exc
    if decoded.get("purpose") != PASSWORD_RESET_PURPOSE or decoded.get("type") != PASSWORD_RESET_PURPOSE:
        raise invalid
    user_id = str(decoded.get("sub") or "").strip()
    user = db.query(User).filter(User.id == user_id).first() if user_id else None
    if user is None:
        raise invalid
    # Bound to the password hash at issue time: once used (or the password changes
    # any other way) the fingerprint no longer matches, making the token single-use.
    if not secrets.compare_digest(str(decoded.get("pwh") or ""), password_hash_fingerprint(user.hashed_password)):
        raise invalid

    _validate_password(payload.new_password)
    _set_password(db, user, payload.new_password)
    _clear_login_failures(user.email)
    return Response(status_code=204)


@router.post("/admin/reset-password", status_code=204, response_class=Response)
def admin_reset_password(
    payload: AdminResetPasswordRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_role("admin")),
) -> Response:
    email = _normalize_email(payload.email)
    _validate_email(email)
    _validate_password(payload.new_password)
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    _set_password(db, user, payload.new_password)
    _clear_login_failures(email)
    logger.warning("Admin %s reset the password for user %s", admin.id, user.id)
    return Response(status_code=204)
