from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ServiceStatusRegistry:
    def __init__(self) -> None:
        self._statuses: dict[str, dict[str, Any]] = {}

    def mark(self, name: str, *, state: str, required: bool, detail: str | None = None) -> None:
        self._statuses[name] = {
            "state": state,
            "required": required,
            "detail": detail,
            "updated_at": _utcnow_iso(),
        }

    def mark_ok(self, name: str, *, required: bool, detail: str | None = None) -> None:
        self.mark(name, state="ok", required=required, detail=detail)

    def mark_degraded(self, name: str, *, required: bool, detail: str | None = None) -> None:
        self.mark(name, state="degraded", required=required, detail=detail)

    def mark_stopped(self, name: str, *, required: bool, detail: str | None = None) -> None:
        self.mark(name, state="stopped", required=required, detail=detail)

    def snapshot(self) -> dict[str, dict[str, Any]]:
        return {name: dict(payload) for name, payload in self._statuses.items()}

    def overall_status(self) -> str:
        states = list(self._statuses.values())
        if any(item["required"] and item["state"] != "ok" for item in states):
            return "error"
        if any((not item["required"]) and item["state"] != "ok" for item in states):
            return "degraded"
        return "ok"


service_status_registry = ServiceStatusRegistry()
