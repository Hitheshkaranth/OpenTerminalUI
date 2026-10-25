"""Validate optional company links already returned by market-data providers."""
from __future__ import annotations

from urllib.parse import urlsplit


def company_url(value: object) -> str | None:
    """Accept complete web URLs only; missing/malformed branding must not break quotes."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or len(value) > 2048 or any(ord(char) < 32 for char in value):
        return None
    try:
        parsed = urlsplit(value)
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
            return None
        if parsed.username or parsed.password:
            return None
        # Accessing port also rejects malformed values such as ':not-a-port'.
        _ = parsed.port
    except ValueError:
        return None
    return value


def first_company_url(*values: object) -> str | None:
    return next((safe for value in values if (safe := company_url(value)) is not None), None)
