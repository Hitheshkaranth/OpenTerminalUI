from __future__ import annotations

import inspect
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from backend.services.llm.base import ToolDef

ToolHandler = Callable[[dict[str, Any]], Awaitable[Any]]


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: ToolHandler | None
    read_only: bool
    write_class: str = "none"  # none | soft | order  (Phase 1: none only)

    def to_def(self) -> ToolDef:
        return ToolDef(self.name, self.description, self.parameters)


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        if spec.name in self._tools:
            raise ValueError(f"Tool already registered: {spec.name}")
        self._tools[spec.name] = spec

    def tool_defs(self) -> list[ToolDef]:
        return [spec.to_def() for spec in self._tools.values()]

    def get(self, name: str) -> ToolSpec:
        if name not in self._tools:
            raise KeyError(name)
        return self._tools[name]

    async def execute(self, name: str, args: dict[str, Any]) -> Any:
        spec = self.get(name)
        if spec.handler is None:
            raise KeyError(f"Tool has no handler: {name}")
        # Handlers may be plain functions (DB-only tools) or coroutines.
        result = spec.handler(args)
        if inspect.isawaitable(result):
            result = await result
        return result
