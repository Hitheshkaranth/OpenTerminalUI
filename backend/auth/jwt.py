from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from jwt import PyJWTError as JWTError

from backend.config.constants import DEFAULT_ACCESS_TOKEN_TTL_MINUTES, DEFAULT_REFRESH_TOKEN_TTL_DAYS
from backend.config.security import get_jwt_secret

ALGORITHM = "HS256"
ACCESS_TOKEN_TTL_MINUTES = DEFAULT_ACCESS_TOKEN_TTL_MINUTES
REFRESH_TOKEN_TTL_DAYS = DEFAULT_REFRESH_TOKEN_TTL_DAYS  # SECURITY: reduced from 7 to 1 day to limit the window for stolen refresh tokens.
PASSWORD_RESET_TTL_MINUTES = 30
PASSWORD_RESET_PURPOSE = "pwd_reset"


def _secret() -> str:
    return get_jwt_secret()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(subject: str, email: str, role: str, ttl_minutes: int = ACCESS_TOKEN_TTL_MINUTES) -> str:
    now = _now_utc()
    payload: dict[str, Any] = {
        "sub": subject,
        "email": email,
        "role": role,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ttl_minutes)).timestamp()),
    }
    return jwt.encode(payload, _secret(), algorithm=ALGORITHM)


def create_refresh_token(subject: str, email: str, role: str, jti: str | None = None, ttl_days: int = REFRESH_TOKEN_TTL_DAYS) -> str:
    now = _now_utc()
    payload: dict[str, Any] = {
        "sub": subject,
        "email": email,
        "role": role,
        "type": "refresh",
        "jti": jti or secrets.token_hex(16),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=ttl_days)).timestamp()),
    }
    return jwt.encode(payload, _secret(), algorithm=ALGORITHM)


def password_hash_fingerprint(hashed_password: str | None) -> str:
    """First 16 hex chars of sha256(stored password hash).

    Embedded in reset tokens so a token stops working as soon as the password changes
    (bcrypt re-salts on every hash), which makes it single-use without a token table.
    """
    return hashlib.sha256((hashed_password or "").encode("utf-8")).hexdigest()[:16]


def create_password_reset_token(
    subject: str, hashed_password: str | None, ttl_minutes: int = PASSWORD_RESET_TTL_MINUTES
) -> str:
    now = _now_utc()
    payload: dict[str, Any] = {
        "sub": subject,
        "type": PASSWORD_RESET_PURPOSE,
        "purpose": PASSWORD_RESET_PURPOSE,
        "pwh": password_hash_fingerprint(hashed_password),
        "jti": secrets.token_hex(8),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ttl_minutes)).timestamp()),
    }
    return jwt.encode(payload, _secret(), algorithm=ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, _secret(), algorithms=[ALGORITHM], options={"require": ["exp", "sub", "type"]})
    except JWTError as exc:
        raise ValueError("Invalid or expired token") from exc


def refresh_expiry_utc() -> datetime:
    return _now_utc() + timedelta(days=REFRESH_TOKEN_TTL_DAYS)
