from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt

ALGORITHM = "HS256"
ACCESS_TOKEN_TTL_MINUTES = 15
REFRESH_TOKEN_TTL_DAYS = 7


def _secret() -> str:
    return os.getenv("JWT_SECRET_KEY", "dev-insecure-secret-key")


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


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, _secret(), algorithms=[ALGORITHM])
    except JWTError as exc:
        raise ValueError("Invalid or expired token") from exc


def refresh_expiry_utc() -> datetime:
    return _now_utc() + timedelta(days=REFRESH_TOKEN_TTL_DAYS)
