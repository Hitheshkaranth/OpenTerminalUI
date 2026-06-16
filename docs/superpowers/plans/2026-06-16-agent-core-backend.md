# Agent Core (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend of OpenTerminalUI's agent framework — a multi-provider LLM abstraction (OpenRouter primary), a typed tool registry wrapping existing services, a native tool-calling orchestrator loop, and an SSE API — delivering read-only "determine stocks" runs end-to-end.

**Architecture:** A provider-agnostic `LLMProvider` (OpenAI-compatible base; OpenRouter/OpenAI/LM Studio subclasses) returns assistant messages with `tool_calls`. An async `Orchestrator` loops: call provider → execute requested tools via a `ToolRegistry` (handlers wrapping `ScreenerEngine` / `UnifiedFetcher`) → feed results back → stop at a final answer or a step/time budget. The orchestrator yields typed `AgentEvent`s; a FastAPI route streams them as Server-Sent Events. This plan is **read-only** — no write/order tools (deferred to later phases per the design spec).

**Tech Stack:** Python 3.10, FastAPI, httpx (async), pydantic v1-style `BaseModel`, pytest + pytest-asyncio. No new heavyweight deps.

**Scope note:** This is the backend slice of design-spec Phase 1. The frontend global console + Settings UI is a separate follow-on plan that consumes the API contract defined in Task 8.

**Reference:** `docs/superpowers/specs/2026-06-16-agent-framework-design.md`

---

## File Structure

**Create:**
- `backend/services/llm/__init__.py` — package exports.
- `backend/services/llm/base.py` — message/tool/delta dataclasses, `LLMProvider` protocol, `LLMError`.
- `backend/services/llm/openai_compatible.py` — `OpenAICompatibleProvider` (httpx, `/chat/completions`, tools).
- `backend/services/llm/factory.py` — `get_llm_provider()` building the right subclass from settings.
- `backend/agent/__init__.py` — package marker.
- `backend/agent/events.py` — `AgentEvent` union + helpers.
- `backend/agent/tools/__init__.py` — package marker.
- `backend/agent/tools/registry.py` — `ToolSpec`, `ToolRegistry`.
- `backend/agent/tools/market_tools.py` — read tools + `build_default_registry()`.
- `backend/agent/orchestrator.py` — `Orchestrator.run()` async event generator.
- `backend/api/routes/agent.py` — `POST /api/agent/runs`, `GET /api/agent/runs/{id}/stream`.
- Tests: `backend/tests/test_llm_provider.py`, `backend/tests/test_agent_registry.py`, `backend/tests/test_agent_market_tools.py`, `backend/tests/test_agent_orchestrator.py`, `backend/tests/test_agent_api.py`.

**Modify:**
- `backend/config/settings.py` — add OpenRouter + agent settings and env mapping.
- `backend/api/router.py` — mount the agent router.

---

## Task 1: Agent + LLM settings

**Files:**
- Modify: `backend/config/settings.py` (AppSettings fields near line 35-43; env mapping near line 194-225)
- Test: `backend/tests/test_agent_settings.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_agent_settings.py
import importlib
import backend.config.settings as settings_mod


def _fresh_settings():
    settings_mod.get_settings.cache_clear()
    return settings_mod.get_settings()


def test_agent_defaults(monkeypatch):
    for var in [
        "OPENTERMINALUI_OPENROUTER_API_KEY", "OPENROUTER_API_KEY",
        "OPENTERMINALUI_AGENT_PROVIDER", "OPENTERMINALUI_AGENT_MODEL",
    ]:
        monkeypatch.delenv(var, raising=False)
    s = _fresh_settings()
    assert s.agent_provider == "openrouter"
    assert s.agent_model == "anthropic/claude-opus-4-8"
    assert s.openrouter_base_url == "https://openrouter.ai/api/v1"
    assert s.openrouter_api_key is None
    assert s.agent_max_steps == 12


def test_agent_env_override(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    monkeypatch.setenv("OPENTERMINALUI_AGENT_MODEL", "openai/gpt-4o")
    s = _fresh_settings()
    assert s.openrouter_api_key == "sk-or-test"
    assert s.agent_model == "openai/gpt-4o"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_agent_settings.py -v`
Expected: FAIL — `AttributeError: 'AppSettings' object has no attribute 'agent_provider'`.

- [ ] **Step 3: Add settings fields**

In `backend/config/settings.py`, inside `class AppSettings(BaseModel)` after the `lm_studio_timeout_seconds` field (~line 41), add:

```python
    # Agent framework (multi-provider LLM)
    agent_provider: str = "openrouter"  # openrouter | openai | lmstudio
    agent_model: str = "anthropic/claude-opus-4-8"
    agent_max_steps: int = 12
    agent_timeout_seconds: float = 120.0
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_api_key: str | None = None
```

- [ ] **Step 4: Add env mapping**

In `get_settings()` where the `AppSettings(...)` kwargs are built (after the `lm_studio_timeout_seconds=` block, ~line 223), add:

```python
        agent_provider=(
            _env("OPENTERMINALUI_AGENT_PROVIDER")
            or _env("AGENT_PROVIDER")
            or app_cfg.get("agent_provider", "openrouter")
        ),
        agent_model=(
            _env("OPENTERMINALUI_AGENT_MODEL")
            or _env("AGENT_MODEL")
            or app_cfg.get("agent_model", "anthropic/claude-opus-4-8")
        ),
        agent_max_steps=int(
            _env("OPENTERMINALUI_AGENT_MAX_STEPS")
            or str(app_cfg.get("agent_max_steps", 12))
        ),
        agent_timeout_seconds=float(
            _env("OPENTERMINALUI_AGENT_TIMEOUT_SECONDS")
            or str(app_cfg.get("agent_timeout_seconds", 120.0))
        ),
        openrouter_base_url=(
            _env("OPENTERMINALUI_OPENROUTER_BASE_URL")
            or _env("OPENROUTER_BASE_URL")
            or app_cfg.get("openrouter_base_url", "https://openrouter.ai/api/v1")
        ),
        openrouter_api_key=(
            _env("OPENTERMINALUI_OPENROUTER_API_KEY")
            or _env("OPENROUTER_API_KEY")
            or app_cfg.get("openrouter_api_key")
        ),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest backend/tests/test_agent_settings.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/config/settings.py backend/tests/test_agent_settings.py
git commit -m "feat(agent): add OpenRouter + agent settings"
```

---

## Task 2: LLM message/tool types and provider protocol

**Files:**
- Create: `backend/services/llm/__init__.py`, `backend/services/llm/base.py`
- Test: `backend/tests/test_llm_provider.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_llm_provider.py
from backend.services.llm.base import (
    LLMMessage, ToolCall, AssistantMessage, ToolDef, LLMError,
)


def test_message_to_wire_roundtrip():
    msg = LLMMessage(role="user", content="hi")
    assert msg.to_wire() == {"role": "user", "content": "hi"}


def test_tool_result_message_wire():
    msg = LLMMessage(role="tool", content='{"ok": true}', tool_call_id="call_1")
    wire = msg.to_wire()
    assert wire["role"] == "tool"
    assert wire["tool_call_id"] == "call_1"


def test_assistant_message_with_tool_calls_wire():
    tc = ToolCall(id="call_1", name="screen_stocks", arguments={"query": "pe < 20"})
    msg = AssistantMessage(content=None, tool_calls=[tc])
    wire = msg.to_wire()
    assert wire["role"] == "assistant"
    assert wire["tool_calls"][0]["function"]["name"] == "screen_stocks"
    # arguments must be a JSON string on the wire
    assert isinstance(wire["tool_calls"][0]["function"]["arguments"], str)


def test_tool_def_wire_shape():
    td = ToolDef(name="get_quote", description="quote", parameters={"type": "object"})
    wire = td.to_wire()
    assert wire["type"] == "function"
    assert wire["function"]["name"] == "get_quote"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_llm_provider.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.services.llm'`.

- [ ] **Step 3: Create the package and types**

```python
# backend/services/llm/__init__.py
from backend.services.llm.base import (
    AssistantMessage, LLMError, LLMMessage, LLMProvider, ToolCall, ToolDef,
)

__all__ = [
    "AssistantMessage", "LLMError", "LLMMessage", "LLMProvider", "ToolCall", "ToolDef",
]
```

```python
# backend/services/llm/base.py
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Protocol


class LLMError(RuntimeError):
    """Raised when an LLM provider is unreachable or returns bad data."""


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]

    def to_wire(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": "function",
            "function": {"name": self.name, "arguments": json.dumps(self.arguments)},
        }


@dataclass
class LLMMessage:
    role: str  # "system" | "user" | "tool"
    content: str | None = None
    tool_call_id: str | None = None

    def to_wire(self) -> dict[str, Any]:
        wire: dict[str, Any] = {"role": self.role, "content": self.content or ""}
        if self.tool_call_id is not None:
            wire["tool_call_id"] = self.tool_call_id
        return wire


@dataclass
class AssistantMessage:
    content: str | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)

    def to_wire(self) -> dict[str, Any]:
        wire: dict[str, Any] = {"role": "assistant", "content": self.content}
        if self.tool_calls:
            wire["tool_calls"] = [tc.to_wire() for tc in self.tool_calls]
        return wire


@dataclass
class ToolDef:
    name: str
    description: str
    parameters: dict[str, Any]

    def to_wire(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


class LLMProvider(Protocol):
    async def complete(
        self,
        messages: list[LLMMessage | AssistantMessage],
        tools: list[ToolDef] | None = None,
        *,
        temperature: float = 0.1,
        max_tokens: int = 1024,
    ) -> AssistantMessage: ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_llm_provider.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/services/llm/__init__.py backend/services/llm/base.py backend/tests/test_llm_provider.py
git commit -m "feat(agent): add LLM message/tool types and provider protocol"
```

---

## Task 3: OpenAI-compatible provider

**Files:**
- Create: `backend/services/llm/openai_compatible.py`
- Test: append to `backend/tests/test_llm_provider.py`

- [ ] **Step 1: Write the failing test**

```python
# append to backend/tests/test_llm_provider.py
import pytest
import httpx
from backend.services.llm.openai_compatible import OpenAICompatibleProvider
from backend.services.llm.base import LLMMessage, ToolDef


def _mock_transport(captured: dict, response_json: dict):
    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        captured["body"] = request.read().decode()
        return httpx.Response(200, json=response_json)
    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_complete_parses_tool_calls():
    captured: dict = {}
    resp = {"choices": [{"message": {"content": None, "tool_calls": [
        {"id": "call_1", "type": "function",
         "function": {"name": "get_quote", "arguments": '{"ticker": "AAPL"}'}}]}}]}
    provider = OpenAICompatibleProvider(
        base_url="https://x/api/v1", api_key="sk-test", model="m",
        transport=_mock_transport(captured, resp),
    )
    out = await provider.complete([LLMMessage(role="user", content="quote AAPL")],
                                  tools=[ToolDef("get_quote", "q", {"type": "object"})])
    assert out.tool_calls[0].name == "get_quote"
    assert out.tool_calls[0].arguments == {"ticker": "AAPL"}
    assert "Bearer sk-test" in captured["headers"]["authorization"]


@pytest.mark.asyncio
async def test_complete_parses_plain_content():
    resp = {"choices": [{"message": {"content": "AAPL looks fine", "tool_calls": None}}]}
    provider = OpenAICompatibleProvider(
        base_url="https://x/api/v1", api_key=None, model="m",
        transport=_mock_transport({}, resp),
    )
    out = await provider.complete([LLMMessage(role="user", content="hi")])
    assert out.content == "AAPL looks fine"
    assert out.tool_calls == []


@pytest.mark.asyncio
async def test_http_error_raises_llmerror():
    from backend.services.llm.base import LLMError

    def handler(request):
        return httpx.Response(500, json={"error": "boom"})
    provider = OpenAICompatibleProvider(
        base_url="https://x/api/v1", api_key="k", model="m",
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(LLMError):
        await provider.complete([LLMMessage(role="user", content="hi")])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_llm_provider.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.services.llm.openai_compatible'`.

- [ ] **Step 3: Implement the provider**

```python
# backend/services/llm/openai_compatible.py
from __future__ import annotations

import json
from typing import Any

import httpx

from backend.services.llm.base import (
    AssistantMessage, LLMError, LLMMessage, ToolCall, ToolDef,
)


class OpenAICompatibleProvider:
    """Async client for any OpenAI-compatible /chat/completions endpoint."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str | None,
        model: str,
        timeout: float = 120.0,
        extra_headers: dict[str, str] | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.extra_headers = extra_headers or {}
        self._transport = transport  # injected in tests

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json", **self.extra_headers}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def complete(
        self,
        messages: list[LLMMessage | AssistantMessage],
        tools: list[ToolDef] | None = None,
        *,
        temperature: float = 0.1,
        max_tokens: int = 1024,
    ) -> AssistantMessage:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [m.to_wire() for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if tools:
            payload["tools"] = [t.to_wire() for t in tools]
            payload["tool_choice"] = "auto"
        url = f"{self.base_url}/chat/completions"
        try:
            async with httpx.AsyncClient(
                timeout=self.timeout, trust_env=False, transport=self._transport
            ) as client:
                resp = await client.post(url, json=payload, headers=self._headers())
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code if exc.response is not None else "?"
            raise LLMError(f"LLM HTTP {status}") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise LLMError(f"LLM request failed: {exc}") from exc
        return self._parse(data)

    @staticmethod
    def _parse(data: dict[str, Any]) -> AssistantMessage:
        try:
            message = data["choices"][0]["message"]
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError("LLM returned an unexpected payload") from exc
        raw_calls = message.get("tool_calls") or []
        calls: list[ToolCall] = []
        for rc in raw_calls:
            fn = rc.get("function", {})
            raw_args = fn.get("arguments") or "{}"
            try:
                args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args)
            except json.JSONDecodeError:
                args = {}
            calls.append(ToolCall(id=rc.get("id", ""), name=fn.get("name", ""), arguments=args))
        return AssistantMessage(content=message.get("content"), tool_calls=calls)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_llm_provider.py -v`
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/services/llm/openai_compatible.py backend/tests/test_llm_provider.py
git commit -m "feat(agent): add OpenAI-compatible LLM provider"
```

---

## Task 4: Provider factory

**Files:**
- Create: `backend/services/llm/factory.py`
- Test: `backend/tests/test_llm_factory.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_llm_factory.py
import pytest
from backend.services.llm.factory import get_llm_provider, AGENT_PROVIDERS
from backend.services.llm.base import LLMError


def test_openrouter_provider_config(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-x")
    import backend.config.settings as s
    s.get_settings.cache_clear()
    p = get_llm_provider(provider="openrouter")
    assert p.base_url == "https://openrouter.ai/api/v1"
    assert p.api_key == "sk-or-x"
    # OpenRouter etiquette headers present
    assert "HTTP-Referer" in p.extra_headers


def test_lmstudio_provider_uses_lm_settings():
    p = get_llm_provider(provider="lmstudio")
    assert p.base_url.endswith("/v1")


def test_unknown_provider_raises():
    with pytest.raises(LLMError):
        get_llm_provider(provider="nope")


def test_known_providers_listed():
    assert set(AGENT_PROVIDERS) == {"openrouter", "openai", "lmstudio"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_llm_factory.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.services.llm.factory'`.

- [ ] **Step 3: Implement the factory**

```python
# backend/services/llm/factory.py
from __future__ import annotations

from backend.config.settings import get_settings
from backend.services.llm.base import LLMError
from backend.services.llm.openai_compatible import OpenAICompatibleProvider

AGENT_PROVIDERS = ("openrouter", "openai", "lmstudio")


def get_llm_provider(
    *, provider: str | None = None, model: str | None = None,
    api_key: str | None = None,
) -> OpenAICompatibleProvider:
    """Build an OpenAI-compatible provider for the agent from settings + overrides."""
    settings = get_settings()
    provider = (provider or settings.agent_provider or "openrouter").lower()
    timeout = settings.agent_timeout_seconds

    if provider == "openrouter":
        return OpenAICompatibleProvider(
            base_url=settings.openrouter_base_url,
            api_key=api_key or settings.openrouter_api_key,
            model=model or settings.agent_model,
            timeout=timeout,
            extra_headers={
                "HTTP-Referer": "https://openterminalui.local",
                "X-Title": "OpenTerminalUI Agent",
            },
        )
    if provider == "openai":
        return OpenAICompatibleProvider(
            base_url="https://api.openai.com/v1",
            api_key=api_key or settings.openai_api_key,
            model=model or settings.agent_model,
            timeout=timeout,
        )
    if provider == "lmstudio":
        return OpenAICompatibleProvider(
            base_url=settings.lm_studio_base_url,
            api_key=None,
            model=model or settings.lm_studio_model,
            timeout=timeout,
        )
    raise LLMError(f"Unknown agent provider: {provider}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_llm_factory.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/services/llm/factory.py backend/tests/test_llm_factory.py
git commit -m "feat(agent): add LLM provider factory"
```

---

## Task 5: Tool registry

**Files:**
- Create: `backend/agent/__init__.py`, `backend/agent/tools/__init__.py`, `backend/agent/tools/registry.py`
- Test: `backend/tests/test_agent_registry.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_agent_registry.py
import pytest
from backend.agent.tools.registry import ToolSpec, ToolRegistry


@pytest.mark.asyncio
async def test_register_and_execute():
    reg = ToolRegistry()

    async def handler(args):
        return {"echo": args["x"]}

    reg.register(ToolSpec(
        name="echo", description="echo x",
        parameters={"type": "object", "properties": {"x": {"type": "string"}},
                    "required": ["x"]},
        handler=handler, read_only=True,
    ))
    result = await reg.execute("echo", {"x": "hi"})
    assert result == {"echo": "hi"}


def test_tool_defs_wire():
    reg = ToolRegistry()
    reg.register(ToolSpec("t", "d", {"type": "object"}, handler=None, read_only=True))
    defs = reg.tool_defs()
    assert defs[0].name == "t"


@pytest.mark.asyncio
async def test_unknown_tool_raises():
    reg = ToolRegistry()
    with pytest.raises(KeyError):
        await reg.execute("nope", {})


def test_duplicate_registration_raises():
    reg = ToolRegistry()
    spec = ToolSpec("t", "d", {"type": "object"}, handler=None, read_only=True)
    reg.register(spec)
    with pytest.raises(ValueError):
        reg.register(spec)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_agent_registry.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.agent'`.

- [ ] **Step 3: Implement registry**

```python
# backend/agent/__init__.py
```

```python
# backend/agent/tools/__init__.py
```

```python
# backend/agent/tools/registry.py
from __future__ import annotations

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
        return await spec.handler(args)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_agent_registry.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/agent/__init__.py backend/agent/tools/__init__.py backend/agent/tools/registry.py backend/tests/test_agent_registry.py
git commit -m "feat(agent): add tool registry"
```

---

## Task 6: Read-only market tools

**Files:**
- Create: `backend/agent/tools/market_tools.py`
- Test: `backend/tests/test_agent_market_tools.py`

These wrap verified interfaces: `ScreenerEngine().run(RunConfig(query=...))` (`backend/screener/engine.py:240`) and `get_unified_fetcher().fetch_stock_snapshot(symbol)` (`backend/api/deps.py`).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_agent_market_tools.py
import pytest
import backend.agent.tools.market_tools as mt
from backend.agent.tools.registry import ToolRegistry


@pytest.mark.asyncio
async def test_screen_stocks_calls_engine(monkeypatch):
    captured = {}

    class FakeEngine:
        def run(self, config):
            captured["query"] = config.query
            captured["limit"] = config.limit
            return {"rows": [{"ticker": "AAPL", "pe_ratio": 18}], "total": 1}

    monkeypatch.setattr(mt, "ScreenerEngine", lambda: FakeEngine())
    out = await mt.screen_stocks({"query": "pe_ratio < 20", "limit": 5})
    assert captured["query"] == "pe_ratio < 20"
    assert captured["limit"] == 5
    assert out["rows"][0]["ticker"] == "AAPL"


@pytest.mark.asyncio
async def test_get_stock_snapshot(monkeypatch):
    async def fake_fetcher():
        class F:
            async def fetch_stock_snapshot(self, sym):
                return {"company_name": "Apple", "last_price": 200.0, "symbol": sym}
        return F()

    monkeypatch.setattr(mt, "get_unified_fetcher", fake_fetcher)
    out = await mt.get_stock_snapshot({"ticker": "aapl"})
    assert out["symbol"] == "AAPL"
    assert out["last_price"] == 200.0


@pytest.mark.asyncio
async def test_compare_stocks(monkeypatch):
    async def fake_fetcher():
        class F:
            async def fetch_stock_snapshot(self, sym):
                return {"symbol": sym, "pe_ratio": 10 if sym == "A" else 20}
        return F()

    monkeypatch.setattr(mt, "get_unified_fetcher", fake_fetcher)
    out = await mt.compare_stocks({"tickers": ["A", "B"], "metrics": ["pe_ratio"]})
    assert len(out["rows"]) == 2
    assert out["rows"][0]["pe_ratio"] == 10


def test_build_default_registry_has_read_tools():
    reg = mt.build_default_registry()
    names = {d.name for d in reg.tool_defs()}
    assert {"screen_stocks", "get_stock_snapshot", "compare_stocks"} <= names
    # Phase 1 is read-only
    for d in reg.tool_defs():
        assert reg.get(d.name).read_only is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_agent_market_tools.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.agent.tools.market_tools'`.

- [ ] **Step 3: Implement the tools**

```python
# backend/agent/tools/market_tools.py
from __future__ import annotations

from typing import Any

from backend.agent.tools.registry import ToolRegistry, ToolSpec
from backend.api.deps import get_unified_fetcher
from backend.screener.engine import RunConfig, ScreenerEngine


async def screen_stocks(args: dict[str, Any]) -> dict[str, Any]:
    """Run the platform screener from a natural filter string."""
    config = RunConfig(
        query=str(args.get("query", "")),
        universe=str(args.get("universe", "nse_500")),
        market=str(args.get("market", "IN")),
        limit=int(args.get("limit", 25)),
    )
    engine = ScreenerEngine()
    return engine.run(config)


async def get_stock_snapshot(args: dict[str, Any]) -> dict[str, Any]:
    """Fetch a full fundamentals/price snapshot for one ticker."""
    symbol = str(args.get("ticker", "")).strip().upper()
    fetcher = await get_unified_fetcher()
    return await fetcher.fetch_stock_snapshot(symbol)


async def compare_stocks(args: dict[str, Any]) -> dict[str, Any]:
    """Fetch snapshots for several tickers, projected to the requested metrics."""
    tickers = [str(t).strip().upper() for t in args.get("tickers", []) if str(t).strip()]
    metrics = [str(m) for m in args.get("metrics", [])]
    fetcher = await get_unified_fetcher()
    rows: list[dict[str, Any]] = []
    for sym in tickers:
        snap = await fetcher.fetch_stock_snapshot(sym)
        row = {"symbol": sym}
        if metrics:
            for m in metrics:
                row[m] = snap.get(m)
        else:
            row.update(snap)
        rows.append(row)
    return {"rows": rows}


def build_default_registry() -> ToolRegistry:
    reg = ToolRegistry()
    reg.register(ToolSpec(
        name="screen_stocks",
        description="Find stocks matching filter expressions (e.g. 'pe_ratio < 20 and roe > 15'). "
                    "Returns matching rows with fundamentals.",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Filter expression."},
                "universe": {"type": "string", "enum": ["nse_500", "sp_500", "nasdaq_100", "us_all"]},
                "market": {"type": "string", "enum": ["IN", "US"]},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100},
            },
            "required": ["query"],
        },
        handler=screen_stocks, read_only=True,
    ))
    reg.register(ToolSpec(
        name="get_stock_snapshot",
        description="Get a full price + fundamentals snapshot for a single ticker.",
        parameters={
            "type": "object",
            "properties": {"ticker": {"type": "string"}},
            "required": ["ticker"],
        },
        handler=get_stock_snapshot, read_only=True,
    ))
    reg.register(ToolSpec(
        name="compare_stocks",
        description="Compare several tickers across the requested metrics "
                    "(e.g. pe_ratio, roe, market_cap).",
        parameters={
            "type": "object",
            "properties": {
                "tickers": {"type": "array", "items": {"type": "string"}},
                "metrics": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["tickers"],
        },
        handler=compare_stocks, read_only=True,
    ))
    return reg
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_agent_market_tools.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/agent/tools/market_tools.py backend/tests/test_agent_market_tools.py
git commit -m "feat(agent): add read-only market tools (screen/snapshot/compare)"
```

---

## Task 7: Orchestrator loop + events

**Files:**
- Create: `backend/agent/events.py`, `backend/agent/orchestrator.py`
- Test: `backend/tests/test_agent_orchestrator.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_agent_orchestrator.py
import pytest
from backend.agent.orchestrator import Orchestrator
from backend.agent.tools.registry import ToolRegistry, ToolSpec
from backend.services.llm.base import AssistantMessage, ToolCall


class ScriptedProvider:
    """Returns a queued list of AssistantMessages, one per complete() call."""
    def __init__(self, scripted):
        self._scripted = list(scripted)
        self.calls = 0

    async def complete(self, messages, tools=None, *, temperature=0.1, max_tokens=1024):
        msg = self._scripted[self.calls]
        self.calls += 1
        return msg


def _registry():
    reg = ToolRegistry()

    async def handler(args):
        return {"rows": [{"ticker": "AAPL"}]}

    reg.register(ToolSpec("screen_stocks", "d", {"type": "object"},
                          handler=handler, read_only=True))
    return reg


@pytest.mark.asyncio
async def test_tool_call_then_final():
    provider = ScriptedProvider([
        AssistantMessage(content=None, tool_calls=[
            ToolCall(id="c1", name="screen_stocks", arguments={"query": "x"})]),
        AssistantMessage(content="Top idea: AAPL", tool_calls=[]),
    ])
    orch = Orchestrator(provider=provider, registry=_registry(), max_steps=5)
    events = [e async for e in orch.run("find cheap stocks")]
    kinds = [e["type"] for e in events]
    assert "tool_call" in kinds
    assert "tool_result" in kinds
    assert kinds[-1] == "final"
    assert events[-1]["content"] == "Top idea: AAPL"


@pytest.mark.asyncio
async def test_tool_error_is_reported_not_raised():
    reg = ToolRegistry()

    async def boom(args):
        raise RuntimeError("provider down")

    reg.register(ToolSpec("screen_stocks", "d", {"type": "object"},
                          handler=boom, read_only=True))
    provider = ScriptedProvider([
        AssistantMessage(content=None, tool_calls=[
            ToolCall(id="c1", name="screen_stocks", arguments={})]),
        AssistantMessage(content="Sorry, screener failed", tool_calls=[]),
    ])
    orch = Orchestrator(provider=provider, registry=reg, max_steps=5)
    events = [e async for e in orch.run("go")]
    tool_results = [e for e in events if e["type"] == "tool_result"]
    assert tool_results[0]["is_error"] is True
    assert events[-1]["type"] == "final"


@pytest.mark.asyncio
async def test_max_steps_budget_halts():
    # Provider always asks for another tool call -> must stop at budget.
    loop_msg = AssistantMessage(content=None, tool_calls=[
        ToolCall(id="c", name="screen_stocks", arguments={})])
    provider = ScriptedProvider([loop_msg] * 10)
    orch = Orchestrator(provider=provider, registry=_registry(), max_steps=3)
    events = [e async for e in orch.run("loop forever")]
    assert events[-1]["type"] == "final"
    assert "step budget" in events[-1]["content"].lower()
    # 3 tool calls max
    assert sum(1 for e in events if e["type"] == "tool_call") == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_agent_orchestrator.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.agent.orchestrator'`.

- [ ] **Step 3: Implement events helpers**

```python
# backend/agent/events.py
from __future__ import annotations

from typing import Any


def token(text: str) -> dict[str, Any]:
    return {"type": "token", "text": text}


def tool_call(call_id: str, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return {"type": "tool_call", "id": call_id, "name": name, "arguments": arguments}


def tool_result(call_id: str, name: str, result: Any, is_error: bool = False) -> dict[str, Any]:
    return {"type": "tool_result", "id": call_id, "name": name,
            "result": result, "is_error": is_error}


def artifact(kind: str, name: str, data: Any) -> dict[str, Any]:
    return {"type": "artifact", "kind": kind, "name": name, "data": data}


def final(content: str) -> dict[str, Any]:
    return {"type": "final", "content": content}


def error(message: str) -> dict[str, Any]:
    return {"type": "error", "message": message}


# Map tool name -> artifact kind for the frontend canvas.
ARTIFACT_KINDS = {
    "screen_stocks": "screener_table",
    "compare_stocks": "compare_table",
    "get_stock_snapshot": "snapshot_card",
}
```

- [ ] **Step 4: Implement the orchestrator**

```python
# backend/agent/orchestrator.py
from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator

from backend.agent import events
from backend.agent.tools.registry import ToolRegistry
from backend.services.llm.base import (
    AssistantMessage, LLMError, LLMMessage,
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are the OpenTerminalUI financial analysis agent. Help the user analyze and "
    "determine stocks using the provided tools. Call tools to fetch real data before "
    "making claims. When you have enough information, give a concise, structured answer "
    "with concrete tickers and the reasoning behind them. This session is read-only: "
    "you cannot place orders or modify any data."
)


class Orchestrator:
    def __init__(
        self,
        *,
        provider: Any,
        registry: ToolRegistry,
        max_steps: int = 12,
        system_prompt: str = SYSTEM_PROMPT,
    ) -> None:
        self.provider = provider
        self.registry = registry
        self.max_steps = max_steps
        self.system_prompt = system_prompt

    async def run(
        self, user_prompt: str, *, screen_context: dict[str, Any] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        messages: list[LLMMessage | AssistantMessage] = [
            LLMMessage(role="system", content=self.system_prompt),
        ]
        if screen_context:
            messages.append(LLMMessage(
                role="system",
                content="Current screen context: " + json.dumps(screen_context),
            ))
        messages.append(LLMMessage(role="user", content=user_prompt))

        tool_defs = self.registry.tool_defs()
        for _step in range(self.max_steps):
            try:
                assistant = await self.provider.complete(messages, tools=tool_defs)
            except LLMError as exc:
                yield events.error(str(exc))
                yield events.final("The model request failed; please try again.")
                return

            if not assistant.tool_calls:
                yield events.final(assistant.content or "")
                return

            messages.append(assistant)
            for call in assistant.tool_calls:
                yield events.tool_call(call.id, call.name, call.arguments)
                try:
                    result = await self.registry.execute(call.name, call.arguments)
                    is_error = False
                except Exception as exc:  # tool failures are fed back, not raised
                    logger.warning("Tool %s failed: %s", call.name, exc)
                    result = {"error": str(exc)}
                    is_error = True

                yield events.tool_result(call.id, call.name, result, is_error=is_error)
                if not is_error and call.name in events.ARTIFACT_KINDS:
                    yield events.artifact(
                        events.ARTIFACT_KINDS[call.name], call.name, result)

                messages.append(LLMMessage(
                    role="tool", tool_call_id=call.id,
                    content=json.dumps(result, default=str)[:8000],
                ))

        yield events.final(
            "I reached the step budget for this run. Here is what I gathered so far; "
            "ask a follow-up to continue.")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest backend/tests/test_agent_orchestrator.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/agent/events.py backend/agent/orchestrator.py backend/tests/test_agent_orchestrator.py
git commit -m "feat(agent): add orchestrator tool-calling loop + events"
```

---

## Task 8: Agent SSE API

**Files:**
- Create: `backend/api/routes/agent.py`
- Modify: `backend/api/router.py` (add import near line 24, mount near the `ai_router` include ~line 51)
- Test: `backend/tests/test_agent_api.py`

**API contract (consumed by the frontend console plan):**
- `POST /api/agent/runs` — body `{"prompt": str, "context": {...}?, "provider": str?, "model": str?}` → `{"run_id": str}`.
- `GET /api/agent/runs/{run_id}/stream` — `text/event-stream`; each event is `data: <json AgentEvent>\n\n`; stream ends after the `final` (or `error`) event.

For Phase 1 the run executes during the stream request (the POST registers prompt+context keyed by `run_id`; the GET runs the orchestrator and streams events). This keeps state in-process; durable persistence is a later phase.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_agent_api.py
import json
import pytest
from fastapi.testclient import TestClient

import backend.api.routes.agent as agent_route
from backend.main import app
from backend.services.llm.base import AssistantMessage, ToolCall


@pytest.fixture(autouse=True)
def _patch_provider_and_tools(monkeypatch):
    class ScriptedProvider:
        def __init__(self):
            self.calls = 0
        async def complete(self, messages, tools=None, *, temperature=0.1, max_tokens=1024):
            self.calls += 1
            if self.calls == 1:
                return AssistantMessage(content=None, tool_calls=[
                    ToolCall(id="c1", name="screen_stocks", arguments={"query": "pe<20"})])
            return AssistantMessage(content="AAPL is the top pick.", tool_calls=[])

    async def fake_screen(args):
        return {"rows": [{"ticker": "AAPL", "pe_ratio": 18}]}

    from backend.agent.tools.registry import ToolRegistry, ToolSpec
    def fake_registry():
        reg = ToolRegistry()
        reg.register(ToolSpec("screen_stocks", "d", {"type": "object"},
                              handler=fake_screen, read_only=True))
        return reg

    monkeypatch.setattr(agent_route, "get_llm_provider", lambda **k: ScriptedProvider())
    monkeypatch.setattr(agent_route, "build_default_registry", fake_registry)


def test_create_and_stream_run(monkeypatch):
    monkeypatch.setenv("AUTH_MIDDLEWARE_ENABLED", "0")
    client = TestClient(app)
    resp = client.post("/api/agent/runs", json={"prompt": "find cheap stocks"})
    assert resp.status_code == 200
    run_id = resp.json()["run_id"]

    with client.stream("GET", f"/api/agent/runs/{run_id}/stream") as s:
        assert s.status_code == 200
        payloads = []
        for line in s.iter_lines():
            if line.startswith("data: "):
                payloads.append(json.loads(line[len("data: "):]))
    kinds = [p["type"] for p in payloads]
    assert "tool_call" in kinds and "tool_result" in kinds
    assert kinds[-1] == "final"
    assert payloads[-1]["content"] == "AAPL is the top pick."


def test_stream_unknown_run_404():
    client = TestClient(app)
    r = client.get("/api/agent/runs/does-not-exist/stream")
    assert r.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_agent_api.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.api.routes.agent'`.

- [ ] **Step 3: Implement the route**

```python
# backend/api/routes/agent.py
from __future__ import annotations

import json
import uuid
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from backend.agent.orchestrator import Orchestrator
from backend.agent.tools.market_tools import build_default_registry
from backend.auth.deps import get_current_user
from backend.config.settings import get_settings
from backend.services.llm.factory import get_llm_provider

# Mounted under "/api" in router.py -> resolves to /api/agent.
router = APIRouter(prefix="/agent", tags=["agent"])

# In-process pending-run store (Phase 1; durable persistence is a later phase).
_PENDING: Dict[str, Dict[str, Any]] = {}


@router.post("/runs")
async def create_run(payload: Dict[str, Any], user=Depends(get_current_user)) -> Dict[str, str]:
    prompt = (payload.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is required")
    run_id = uuid.uuid4().hex
    _PENDING[run_id] = {
        "prompt": prompt,
        "context": payload.get("context") or {},
        "provider": payload.get("provider"),
        "model": payload.get("model"),
        "user_id": getattr(user, "id", "unknown"),
    }
    return {"run_id": run_id}


@router.get("/runs/{run_id}/stream")
async def stream_run(run_id: str, user=Depends(get_current_user)) -> StreamingResponse:
    spec = _PENDING.pop(run_id, None)
    if spec is None:
        raise HTTPException(status_code=404, detail="run not found")

    settings = get_settings()
    provider = get_llm_provider(provider=spec["provider"], model=spec["model"])
    registry = build_default_registry()
    orchestrator = Orchestrator(
        provider=provider, registry=registry, max_steps=settings.agent_max_steps)

    async def event_stream():
        async for event in orchestrator.run(
            spec["prompt"], screen_context=spec["context"]):
            yield f"data: {json.dumps(event, default=str)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

- [ ] **Step 4: Mount the router**

In `backend/api/router.py`, add the import alongside the other route imports (after line 24):

```python
from backend.api.routes.agent import router as agent_router
```

And mount it next to the `ai_router` include (after the `api_router.include_router(ai_router, prefix="/api")` line ~51):

```python
api_router.include_router(agent_router, prefix="/api")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest backend/tests/test_agent_api.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/api/routes/agent.py backend/api/router.py backend/tests/test_agent_api.py
git commit -m "feat(agent): add agent SSE run API"
```

---

## Task 9: Full backend suite + lint gate

**Files:** none (verification task)

- [ ] **Step 1: Run the full agent test set**

Run: `pytest backend/tests/test_agent_settings.py backend/tests/test_llm_provider.py backend/tests/test_llm_factory.py backend/tests/test_agent_registry.py backend/tests/test_agent_market_tools.py backend/tests/test_agent_orchestrator.py backend/tests/test_agent_api.py -v`
Expected: PASS (all).

- [ ] **Step 2: Run the broader backend suite to check for regressions**

Run: `pytest backend/tests/ -x -q`
Expected: No new failures introduced by these changes.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "test(agent): verify backend agent core suite green"
```

---

## Self-Review Notes (spec coverage)

- **Provider abstraction (spec §4.1):** Tasks 2-4 — base types, OpenAI-compatible client, factory (OpenRouter/OpenAI/LM Studio). ✓
- **Tool registry, curated read tools, hybrid scope (spec §4.2):** Tasks 5-6 — registry + 3 read tools. *Dynamic meta-tool and the remaining curated tools are explicitly Phase 2 per the spec; not in this plan.*
- **Orchestrator loop, budgets, events (spec §4.3):** Task 7 — loop, step budget, typed events, artifact mapping. *Token-level streaming and cost ceiling deferred (events stream final answer as one block in Phase 1).*
- **API surface (spec §4.6):** Task 8 — `POST /runs`, `GET /runs/{id}/stream`. *`/approve`, `/cancel`, `/config`, history endpoints belong to later phases (writes/order HITL/persistence).*
- **Guardrails/orders (spec §4.4):** Out of scope — this plan is read-only by construction (`write_class="none"`, no order tools). ✓ consistent with phasing.
- **Persistence (spec §4.5):** Out of scope — in-process pending store only; durable models are Phase 2. ✓ noted.
- **Frontend console (spec §5):** Separate follow-on plan; this plan locks the API contract (Task 8) it depends on.

Type consistency check: `AssistantMessage`/`LLMMessage`/`ToolCall`/`ToolDef` (Task 2) are used unchanged in Tasks 3,7,8; `ToolSpec`/`ToolRegistry` (Task 5) used in Tasks 6,7,8; `get_llm_provider` (Task 4) used in Task 8; `build_default_registry` (Task 6) used in Task 8; event dict shapes (Task 7) asserted identically in Task 8 test. ✓
