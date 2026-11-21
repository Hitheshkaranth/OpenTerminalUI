"""Structured logging setup (REL-16). Stdlib only.

``configure_logging()`` installs one stream handler on the root logger with a JSON
formatter (``LOG_FORMAT=text`` for a human-readable line instead) at ``LOG_LEVEL``
(default INFO), plus the request-id filter. Safe to call more than once.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone

from backend.core.request_context import RequestIdFilter

_HANDLER_MARKER = "_openterminalui_handler"

# Attributes every LogRecord has; anything else came from ``extra=`` and is emitted.
_STANDARD_ATTRS = set(vars(logging.LogRecord("", 0, "", 0, "", None, None))) | {
    "message",
    "asctime",
    "request_id",
    "taskName",
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", None) or "-",
        }
        for key, value in record.__dict__.items():
            if key not in _STANDARD_ATTRS and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack_info"] = self.formatStack(record.stack_info)
        return json.dumps(payload, default=str)


def _resolve_level(raw: str | None) -> int:
    level = logging.getLevelName((raw or "INFO").strip().upper())
    return level if isinstance(level, int) else logging.INFO


def configure_logging() -> None:
    root = logging.getLogger()
    root.setLevel(_resolve_level(os.getenv("LOG_LEVEL")))

    use_text = (os.getenv("LOG_FORMAT") or "json").strip().lower() == "text"
    formatter: logging.Formatter = (
        logging.Formatter("%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s")
        if use_text
        else JsonFormatter()
    )

    for handler in root.handlers:
        if getattr(handler, _HANDLER_MARKER, False):
            handler.setFormatter(formatter)
            return

    handler = logging.StreamHandler(sys.stderr)
    setattr(handler, _HANDLER_MARKER, True)
    handler.setFormatter(formatter)
    handler.addFilter(RequestIdFilter())
    root.addHandler(handler)
