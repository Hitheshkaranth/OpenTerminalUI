from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.jwt import create_access_token, create_refresh_token, decode_token, refresh_expiry_utc
from backend.models.user import RefreshToken, User, UserRole

router = APIRouter(prefix="/api/auth", tags=["auth"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

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
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> UserResponse:
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
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenPairResponse:
    email = _normalize_email(payload.email)
    user = db.query(User).filter(User.email == email).first()
    if not user or not pwd_context.verify(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    user.last_login = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()

    return _build_token_pair(db, user)


@router.post("/refresh", response_model=TokenPairResponse)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)) -> TokenPairResponse:
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
        raise HTTPException(status_code=401, detail="Refresh token already used")
    if row.expires_at < datetime.now(timezone.utc).replace(tzinfo=None):
        raise HTTPException(status_code=401, detail="Refresh token expired")

    row.revoked_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()

    return _build_token_pair(db, user)


@router.post("/forgot-access", status_code=204)
def forgot_access(payload: ForgotAccessRequest, db: Session = Depends(get_db)) -> None:
    email = _normalize_email(payload.email)
    _validate_email(email)
    _validate_password(payload.new_password)

    user = db.query(User).filter(User.email == email).first()
    if not user:
        # Keep response generic to avoid leaking whether an account exists.
        return None

    user.hashed_password = pwd_context.hash(payload.new_password)
    db.query(RefreshToken).filter(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)).update(
        {RefreshToken.revoked_at: datetime.now(timezone.utc).replace(tzinfo=None)},
        synchronize_session=False,
    )
    db.commit()
    return None
