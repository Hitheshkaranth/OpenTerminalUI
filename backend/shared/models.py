from __future__ import annotations

from pydantic import BaseModel


class SharedBaseModel(BaseModel):
    class Config:
        populate_by_name = True
        arbitrary_types_allowed = True
