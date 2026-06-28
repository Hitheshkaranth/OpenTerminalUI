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
    assert isinstance(wire["tool_calls"][0]["function"]["arguments"], str)


def test_tool_def_wire_shape():
    td = ToolDef(name="get_quote", description="quote", parameters={"type": "object"})
    wire = td.to_wire()
    assert wire["type"] == "function"
    assert wire["function"]["name"] == "get_quote"


import pytest
import httpx
from backend.services.llm.openai_compatible import OpenAICompatibleProvider


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
    assert out.model == "m"


@pytest.mark.asyncio
async def test_complete_uses_supplied_model_chain_and_reports_winner():
    captured: dict = {}
    provider = OpenAICompatibleProvider(
        base_url="https://x/api/v1", api_key=None, model="default",
        transport=_mock_transport(captured, {"choices": [{"message": {"content": "done"}}]}),
    )
    out = await provider.complete(
        [LLMMessage(role="user", content="hi")],
        models=["first:free", "second:free"],
    )
    assert '"model":"first:free"' in captured["body"]
    assert out.model == "first:free"


@pytest.mark.asyncio
async def test_complete_falls_back_to_reasoning_when_content_empty():
    # Reasoning models (e.g. gpt-oss) may return null content + a reasoning field.
    resp = {"choices": [{"message": {"content": None, "reasoning": "DECISION: HOLD | CONVICTION: 50 | balanced."}}]}
    provider = OpenAICompatibleProvider(
        base_url="https://x/api/v1", api_key=None, model="m",
        transport=_mock_transport({}, resp),
    )
    out = await provider.complete([LLMMessage(role="user", content="decide")])
    assert "DECISION:" in (out.content or "")


@pytest.mark.asyncio
async def test_complete_parses_legacy_choice_text():
    resp = {"choices": [{"text": "Plain text completion"}]}
    provider = OpenAICompatibleProvider(
        base_url="https://x/api/v1", api_key=None, model="m",
        transport=_mock_transport({}, resp),
    )
    out = await provider.complete([LLMMessage(role="user", content="hi")])
    assert out.content == "Plain text completion"


@pytest.mark.asyncio
async def test_complete_parses_gemini_candidate_text():
    resp = {"candidates": [{"content": {"parts": [{"text": "Gemini native text"}]}}]}
    provider = OpenAICompatibleProvider(
        base_url="https://x/api/v1", api_key=None, model="gemini",
        transport=_mock_transport({}, resp),
    )
    out = await provider.complete([LLMMessage(role="user", content="hi")])
    assert out.content == "Gemini native text"


@pytest.mark.asyncio
async def test_complete_parses_gemini_candidate_function_call():
    resp = {
        "candidates": [{
            "content": {
                "parts": [{
                    "functionCall": {
                        "name": "get_quote",
                        "args": {"ticker": "AAPL"},
                    }
                }]
            }
        }]
    }
    provider = OpenAICompatibleProvider(
        base_url="https://x/api/v1", api_key=None, model="gemini",
        transport=_mock_transport({}, resp),
    )
    out = await provider.complete([LLMMessage(role="user", content="quote")])
    assert out.tool_calls[0].name == "get_quote"
    assert out.tool_calls[0].arguments == {"ticker": "AAPL"}


@pytest.mark.asyncio
async def test_complete_surfaces_error_payload_message():
    resp = {"error": {"message": "quota exceeded"}}
    provider = OpenAICompatibleProvider(
        base_url="https://x/api/v1", api_key=None, model="m",
        transport=_mock_transport({}, resp),
    )
    with pytest.raises(LLMError, match="quota exceeded"):
        await provider.complete([LLMMessage(role="user", content="hi")])


@pytest.mark.asyncio
async def test_reasoning_not_used_when_tool_call_present():
    # A tool-calling turn legitimately has null content; reasoning must NOT override it.
    resp = {"choices": [{"message": {"content": None, "reasoning": "thinking...", "tool_calls": [
        {"id": "c1", "type": "function", "function": {"name": "get_quote", "arguments": "{}"}}]}}]}
    provider = OpenAICompatibleProvider(
        base_url="https://x/api/v1", api_key=None, model="m",
        transport=_mock_transport({}, resp),
    )
    out = await provider.complete([LLMMessage(role="user", content="quote")])
    assert out.tool_calls[0].name == "get_quote"
    assert (out.content or "") == ""  # reasoning ignored on tool turns


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
