"""Shared outbound HTTP client (contract C5).

A single lazily-created ``httpx.AsyncClient`` reused across the process so
outbound calls share a connection pool instead of opening a new pool per
request. Per-call settings (timeouts, headers, redirects) are passed as request
kwargs, e.g. ``await get_http_client().get(url, timeout=10, headers=...)``.

The client is recreated when it has been closed or when the running event loop
differs from the one it was created on (tests and worker threads may run
separate loops; an httpx client must not be shared across loops).

Because one client serves unrelated call sites, it never stores cookies (one
provider's session cookie must not ride along on another call) and ignores
proxy environment variables (``trust_env=False``), matching what nearly every
call site configured before the client was shared. Flows that need a cookie
session (e.g. NSE homepage warm-up) keep their own short-lived client.

Deployments behind an egress proxy can opt in with
``OPENTERMINALUI_HTTP_TRUST_ENV=1``: the shared client is then built with
``trust_env=True`` and honours ``HTTP_PROXY``/``HTTPS_PROXY``/``NO_PROXY``.
Note that alert webhook delivery (``backend/alerts/delivery.py``) does NOT go
through this client: it opens pinned-IP connections to the resolved address
(SSRF/DNS-rebinding guard), so webhook targets still need direct egress even
when this proxy opt-in is enabled.
"""

from __future__ import annotations

import asyncio
import os
import threading
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator
from http.cookiejar import CookieJar, DefaultCookiePolicy

import httpx

_DEFAULT_TIMEOUT = httpx.Timeout(15, connect=5)
_DEFAULT_LIMITS = httpx.Limits(max_connections=100, max_keepalive_connections=20)

_client: httpx.AsyncClient | None = None
_client_loop: asyncio.AbstractEventLoop | None = None
_lock = threading.Lock()


def _trust_env() -> bool:
    """Opt-in proxy support: honour proxy env vars only when explicitly enabled."""
    return os.getenv("OPENTERMINALUI_HTTP_TRUST_ENV", "").strip().lower() in {"1", "true", "yes", "on"}


def _current_loop() -> asyncio.AbstractEventLoop | None:
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None


def get_http_client() -> httpx.AsyncClient:
    """Return the process-wide shared AsyncClient, creating it if needed."""
    global _client, _client_loop
    loop = _current_loop()
    with _lock:
        client = _client
        if client is not None and not getattr(client, "is_closed", True) and (loop is None or _client_loop is loop):
            return client
        # Client missing, closed, or bound to a different event loop: replace it.
        # The stale client (if any) belongs to another loop, so it cannot be
        # awaited closed here; drop the reference and let it be collected.
        _client = httpx.AsyncClient(
            timeout=_DEFAULT_TIMEOUT,
            limits=_DEFAULT_LIMITS,
            follow_redirects=False,
            trust_env=_trust_env(),
            cookies=CookieJar(policy=DefaultCookiePolicy(allowed_domains=[])),
        )
        _client_loop = loop
        return _client


class _SharedSession:
    """Request-defaults view over the shared client.

    Lets a former ``async with httpx.AsyncClient(timeout=..., headers=...)``
    block keep its shape while issuing requests on the shared pool: the
    defaults are applied per request and exiting the block does not close the
    shared client.
    """

    def __init__(self, client: httpx.AsyncClient, defaults: dict[str, Any]) -> None:
        self._client = client
        self._defaults = defaults

    def _merge(self, kwargs: dict[str, Any]) -> dict[str, Any]:
        for key, value in self._defaults.items():
            if key == "headers":
                merged = dict(value)
                merged.update(kwargs.get("headers") or {})
                kwargs["headers"] = merged
            else:
                kwargs.setdefault(key, value)
        return kwargs

    async def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        return await self._client.request(method, url, **self._merge(kwargs))

    async def get(self, url: str, **kwargs: Any) -> httpx.Response:
        return await self.request("GET", url, **kwargs)

    async def post(self, url: str, **kwargs: Any) -> httpx.Response:
        return await self.request("POST", url, **kwargs)

    def stream(self, method: str, url: str, **kwargs: Any):
        return self._client.stream(method, url, **self._merge(kwargs))


@asynccontextmanager
async def shared_session(
    *,
    timeout: Any = None,
    headers: dict[str, str] | None = None,
    follow_redirects: bool | None = None,
) -> AsyncIterator[_SharedSession]:
    """``async with shared_session(timeout=10) as client: await client.get(...)``."""
    defaults: dict[str, Any] = {}
    if timeout is not None:
        defaults["timeout"] = timeout
    if headers:
        defaults["headers"] = dict(headers)
    if follow_redirects is not None:
        defaults["follow_redirects"] = follow_redirects
    yield _SharedSession(get_http_client(), defaults)


async def close_http_client() -> None:
    """Close the shared client (called from the app lifespan on shutdown)."""
    global _client, _client_loop
    with _lock:
        client = _client
        _client = None
        _client_loop = None
    if client is not None and not getattr(client, "is_closed", True):
        await client.aclose()
