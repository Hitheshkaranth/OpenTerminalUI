from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


class OpenScriptCompileRequest(BaseModel):
    source: str = Field(min_length=1, max_length=20000)


class OpenScriptRunRequest(BaseModel):
    ohlcv: list[dict[str, Any]] = Field(default_factory=list)


class UserScriptCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="")
    source: str = Field(min_length=1, max_length=20000)
    is_public: bool = False


class UserScriptUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    source: str | None = Field(default=None, min_length=1, max_length=20000)
    is_public: bool | None = None


class OpenScriptOutput(BaseModel):
    kind: str
    series: list[Any] = Field(default_factory=list)
    title: str | None = None
    color: str | None = None
    linewidth: int | None = None
    message: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class OpenScriptRunResponse(BaseModel):
    script_id: str
    script_name: str
    outputs: list[OpenScriptOutput] = Field(default_factory=list)
    row_count: int = 0


class UserScript(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    name: str
    description: str = ""
    source: str
    compiled_ast: dict[str, Any] = Field(default_factory=dict)
    outputs: list[dict[str, Any]] = Field(default_factory=list)
    is_public: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
