"""Independent HTTP-mock coverage for capture-only completion integrity."""
from __future__ import annotations

from copy import deepcopy
import json

import httpx
import pytest

from backend.evaluation import capture
from backend.services.llm.base import LLMError, LLMMessage, ToolDef
from backend.services.llm.openai_compatible import OpenAICompatibleProvider

MODEL = "nvidia/nemotron-3.5-lightning:free"
REASONING = "PRIVATE_REASONING_MUST_NOT_BECOME_A_FINAL_ANSWER"
FINAL = '{"answer":"TCS P/E is 27.4.","recommendations":[]}'


def response(*, content=FINAL, finish="stop", reasoning=None, calls=None, include_finish=True, details=None):
    message = {"role": "assistant", "content": content}
    if reasoning is not None:
        message["reasoning"] = reasoning
    if details is not None:
        message["reasoning_details"] = details
    if calls is not None:
        message["tool_calls"] = calls
    choice = {"message": message}
    if include_finish:
        choice["finish_reason"] = finish
    return {"model": MODEL, "choices": [choice], "usage": {"prompt_tokens": 10, "completion_tokens": 20, "cost": 0}}


def gateway(payload, *, capture_gateway=True, provider_name="openrouter"):
    requests = []
    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json=deepcopy(payload))
    settings = dict(base_url="https://openrouter.ai/api/v1", api_key="test-key", model=MODEL,
                    transport=httpx.MockTransport(handler))
    provider = capture.CaptureGateway(provider_name=provider_name, **settings) if capture_gateway else OpenAICompatibleProvider(**settings)
    return provider, requests


@pytest.mark.asyncio
async def test_capture_openrouter_wire_disables_reasoning_and_caps_all_free_charge_axes():
    provider, requests = gateway(response())
    result = await provider.complete([LLMMessage(role="user", content="Return the final JSON.")], models=["paid/wrong-target"])
    assert result.content == FINAL
    assert len(requests) == 1
    assert requests[0]["model"] == MODEL
    assert requests[0]["reasoning"] == {"enabled": False}
    assert requests[0]["provider"]["max_price"] == {"prompt": 0, "completion": 0, "request": 0}
    assert "response_format" not in requests[0]
    assert provider.max_attempts == 1


@pytest.mark.asyncio
async def test_normal_application_provider_retains_its_payload_retries_and_reasoning_fallback():
    provider, requests = gateway(response(content=None, finish="length", reasoning=REASONING), capture_gateway=False)
    result = await provider.complete([LLMMessage(role="user", content="legacy compatibility")])
    assert result.content == REASONING
    assert provider.max_attempts == 3
    assert "reasoning" not in requests[0]
    assert "provider" not in requests[0]
    assert "response_format" not in requests[0]


@pytest.mark.asyncio
async def test_valid_structured_tool_call_with_reasoning_is_not_rejected():
    calls = [{"id": "call-1", "type": "function", "function": {"name": "get_stock_snapshot", "arguments": '{"ticker":"TCS"}'}}]
    provider, _ = gateway(response(content=None, finish="tool_calls", reasoning=REASONING, calls=calls))
    result = await provider.complete([LLMMessage(role="user", content="Fetch the snapshot.")],
        tools=[ToolDef("get_stock_snapshot", "Fetch frozen data", {"type": "object"})])
    assert result.content is None
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0].name == "get_stock_snapshot"
    assert result.tool_calls[0].arguments == {"ticker": "TCS"}
    metadata = provider.response_metadata[0]
    assert metadata["finish_reason"] == "tool_calls"
    assert metadata["visible_content_present"] is False
    assert metadata["reasoning_present"] is True
    assert metadata["raw_content"] is None
    assert REASONING not in json.dumps(metadata)


@pytest.mark.asyncio
@pytest.mark.parametrize("content,hidden", [(None, {"reasoning": REASONING}), (" \n ", {"reasoning": REASONING}),
    (None, {"details": [{"type": "reasoning.text", "text": REASONING}]})])
async def test_reasoning_only_capture_rejected_before_fallback_with_metadata_retained(content, hidden):
    provider, requests = gateway(response(content=content, finish="stop", **hidden))
    with pytest.raises(LLMError, match="[Rr]easoning-only"):
        await provider.complete([LLMMessage(role="user", content="Need an actual final answer")])
    assert len(requests) == 1
    metadata = provider.response_metadata[0]
    assert metadata["visible_content_present"] is False
    assert metadata["reasoning_present"] is True
    assert metadata["raw_content"] == content
    assert REASONING not in json.dumps(metadata)
    assert metadata["usage"]["completion_tokens"] == 20
    assert metadata["cost_usd"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("finish", ["length", "max_tokens", "content_filter", "error"])
async def test_incomplete_finish_reason_rejects_even_valid_json_and_preserves_response(finish):
    provider, requests = gateway(response(content=FINAL, finish=finish, reasoning=REASONING))
    with pytest.raises(LLMError, match=f"finish_reason={finish}"):
        await provider.complete([LLMMessage(role="user", content="Return final JSON")])
    assert len(requests) == 1
    metadata = provider.response_metadata[0]
    assert metadata["finish_reason"] == finish
    assert metadata["raw_content"] == FINAL
    assert metadata["visible_content_present"] is True
    assert metadata["reasoning_present"] is True
    assert REASONING not in json.dumps(metadata)


@pytest.mark.asyncio
async def test_normal_stop_with_visible_content_is_accepted_without_exposing_reasoning():
    provider, _ = gateway(response(content=FINAL, reasoning=REASONING))
    result = await provider.complete([LLMMessage(role="user", content="Return final JSON")])
    assert result.content == FINAL
    assert provider.response_metadata[0]["finish_reason"] == "stop"
    assert REASONING not in json.dumps(provider.response_metadata)


@pytest.mark.asyncio
async def test_missing_finish_reason_remains_compatible_when_visible_answer_exists():
    provider, _ = gateway(response(include_finish=False))
    result = await provider.complete([LLMMessage(role="user", content="Return final JSON")])
    assert result.content == FINAL
    assert provider.response_metadata[0]["finish_reason"] is None
    assert provider.response_metadata[0]["visible_content_present"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [response(finish="length"), response(finish="content_filter"),
                                       response(content=None, reasoning=REASONING)])
async def test_invalid_completion_is_a_failed_capture_without_format_repair(payload):
    case = json.loads(capture.FIXTURES.read_text())[0]
    provider, requests = gateway(payload)
    observation = await capture.capture_case(case, provider, provider_name="openrouter", model=MODEL,
                                            max_steps=2, max_tokens=256, timeout_seconds=2)
    assert observation["capture"]["status"] == "provider_error"
    assert observation["capture"]["output_repair"]["attempted"] is False
    assert len(requests) == 1
    records = observation["capture"]["completions"]
    assert len(records) == 1 and len(records[0]["responses"]) == 1
    assert records[0]["error"]
    assert records[0]["responses"][0]["usage"]["completion_tokens"] == 20
    assert REASONING not in json.dumps(observation)
