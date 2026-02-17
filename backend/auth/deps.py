from __future__ import annotations

from datetime import datetime
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


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    existing = getattr(request.state, "current_user", None)
    if existing is not None:
        return existing

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
    if path in {"/health", "/healthz", "/docs", "/openapi.json", "/redoc"}:
        return True
    if path.startswith("/api/auth"):
        return True
    return False
