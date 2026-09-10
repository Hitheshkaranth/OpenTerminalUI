from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Generic, TypeVar, Optional, Any

T = TypeVar('T')


class ApiResponse(BaseModel, Generic[T]):
    success: bool
    data: Optional[T] = None
    error: Optional[str] = None
    meta: Optional[dict[str, Any]] = None

    @classmethod
    def ok(cls, data: T, meta: Optional[dict[str, Any]] = None) -> "ApiResponse[T]":
        return cls(success=True, data=data, error=None, meta=meta)

    @classmethod
    def err(cls, error: str, meta: Optional[dict[str, Any]] = None) -> "ApiResponse[None]":
        return cls(success=False, data=None, error=error, meta=meta)