"""Per-request correlation id (REL-16).

``RequestIdMiddleware`` is a pure ASGI middleware (not ``BaseHTTPMiddleware``, which
runs the downstream app in a separate task and breaks contextvar propagation). It reads
an incoming ``X-Request-ID`` header (only if it looks like a sane token) or generates a
new one, exposes it through a contextvar and ``scope["state"]["request_id"]``, and echoes
it on the response. ``RequestIdFilter`` copies it onto every log record.
"""

from __future__ import annotations

import logging
import re
import uuid
from contextvars import ContextVar
from typing import Any

from starlette.datastructures import MutableHeaders

REQUEST_ID_HEADER = "X-Request-ID"
_HEADER_KEY = REQUEST_ID_HEADER.lower().encode("latin-1")
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:\-]{1,128}$")

_request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)


def get_request_id() -> str | None:
    return _request_id_var.get()


def new_request_id() -> str:
    return uuid.uuid4().hex


def _incoming_request_id(scope: dict[str, Any]) -> str | None:
    for key, value in scope.get("headers") or []:
        if key.lower() == _HEADER_KEY:
            try:
                candidate = value.decode("latin-1").strip()
            except Exception:
                return None
            return candidate if _VALID_REQUEST_ID.match(candidate) else None
    return None


class RequestIdMiddleware:
    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        request_id = _incoming_request_id(scope) or new_request_id()
        scope.setdefault("state", {})["request_id"] = request_id
        token = _request_id_var.set(request_id)

        async def send_with_request_id(message: dict[str, Any]) -> None:
            if message.get("type") == "http.response.start":
                headers = MutableHeaders(scope=message)
                if REQUEST_ID_HEADER not in headers:
                    headers.append(REQUEST_ID_HEADER, request_id)
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            _request_id_var.reset(token)


class RequestIdFilter(logging.Filter):
    """Attach ``record.request_id`` (keeps an explicit ``extra={"request_id": ...}``)."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not getattr(record, "request_id", None):
            record.request_id = get_request_id() or "-"
        return True
