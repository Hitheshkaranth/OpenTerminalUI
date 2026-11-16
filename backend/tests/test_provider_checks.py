from __future__ import annotations

import asyncio
from copy import deepcopy
import json

import httpx
import pytest

from backend.evaluation.provider_checks import free_tool_models, is_verified_free_model, provider_preflight
from backend.services.llm.openai_compatible import OpenAICompatibleProvider


def row(identifier="current/model:free", **kwargs):
    return {"id": identifier, "pricing": {"prompt": "0", "completion": "0", "request": "0"},
            "supported_parameters": ["tools", "tool_choice"], **kwargs}


def source(handler, api_key="test-secret-key"):
    return OpenAICompatibleProvider(base_url="https://configured.test/v1", api_key=api_key,
        model="current/model:free", transport=httpx.MockTransport(handler), extra_headers={"X-Account": "test-secret-account"})


@pytest.mark.asyncio
async def test_catalog_preflight_authenticates_once_without_inference_or_identity_output():
    calls = []
    def handler(request):
        calls.append(request)
        assert request.headers["Authorization"] == "Bearer test-secret-key"
        return httpx.Response(200, json={"data": {"creator_user_id": "test-secret-account", "label": "test-secret-key"}} if request.url.path.endswith("/key") else {"data": [row()]})
    result = await provider_preflight("openrouter", source(handler), "current/model:free")
    assert result["ready"] is True
    assert result["selected_model"] == "current/model:free"
    assert result["advertised_tools"] is True
    assert result["capabilities"] == {"tool_calling": None, "json_output": None}
    assert [request.url.path for request in calls] == ["/v1/key", "/v1/models"]
    assert result["inference_requests"] == 0
    assert result["probe_billing"]["cost_usd"] is None
    assert "test-secret" not in json.dumps(result)


@pytest.mark.asyncio
@pytest.mark.parametrize("provider_name,status", [("openrouter", 401), ("gemini", 401), ("openai", 403)])
async def test_authentication_failure_stops_without_retry_or_case_inferences(provider_name, status):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(status, json={"error": {"message": "test-secret-key test-secret-account"}})
    result = await provider_preflight(provider_name, source(handler), "current/model:free", probe=True)
    assert result["status"] == "authentication_failed"
    assert result["ready"] is False
    assert len(calls) == 1
    assert result["inference_requests"] == 0
    assert "test-secret" not in json.dumps(result)


@pytest.mark.asyncio
async def test_missing_credentials_sends_no_requests():
    def handler(request):
        pytest.fail("Missing credentials cannot make requests")
    result = await provider_preflight("gemini", source(handler, api_key=None), "gemini-test")
    assert result["status"] == "credentials_missing"
    assert result["requests"] == []
    assert result["metadata"]["latency_ms"] >= 0


@pytest.mark.asyncio
async def test_management_key_cannot_be_used_for_inference():
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"data": {"is_management_key": True, "creator_user_id": "test-secret-account"}})
    result = await provider_preflight("openrouter", source(handler), "current/model:free")
    assert result["status"] == "authentication_failed"
    assert len(calls) == 1
    assert "test-secret" not in json.dumps(result)


@pytest.mark.asyncio
async def test_retired_model_has_only_verified_free_tool_suggestions_and_is_never_replaced():
    catalog = [row("zero/model:free"), row("paid/model", pricing={"prompt": "1", "completion": "1", "request": "0"}),
               row("priced/model:free", pricing={"prompt": "1", "completion": "0", "request": "0"}),
               row("no-tools/model:free", supported_parameters=[]), row("unknown/model:free", pricing={})]
    def handler(request):
        return httpx.Response(200, json={"data": {}} if request.url.path.endswith("/key") else {"data": catalog})
    result = await provider_preflight("openrouter", source(handler), "retired/model:free")
    assert result["status"] == "model_unavailable"
    assert result["selected_model"] is None
    assert result["available_free_models"] == ["zero/model:free"]
    assert result["inference_requests"] == 0


@pytest.mark.asyncio
async def test_explicit_paid_target_is_allowed_without_any_model_substitution():
    def handler(request):
        return httpx.Response(200, json={"data": {}} if request.url.path.endswith("/key") else {"data": [row("paid/model", pricing={"prompt": "1", "completion": "2"})]})
    result = await provider_preflight("openrouter", source(handler), "paid/model")
    assert result["ready"] is True
    assert result["selected_model"] == "paid/model"
    assert result["available_free_models"] == []


@pytest.mark.parametrize("pricing", [
    {"prompt": "0", "completion": "0", "request": None}, {"prompt": "0", "completion": "0", "request": "0.01"},
    {"prompt": True, "completion": "0", "request": "0"}, {"prompt": "NaN", "completion": "0", "request": "0"},
    {"prompt": "0", "completion": "0", "request": "0", "internal_reasoning": "0.1"},
    {"prompt": "0", "completion": "0", "request": "0", "unknown_text_charge": "1"},
])
def test_free_pricing_validation_fails_closed(pricing):
    assert is_verified_free_model(row(pricing=pricing)) is False


def test_unused_modality_pricing_does_not_disqualify_text_only_free_probe():
    assert is_verified_free_model(row(pricing={"prompt": "0", "completion": "0", "request": "0", "audio": "1", "image": "2"}))


@pytest.mark.asyncio
async def test_unverified_free_price_blocks_inference():
    def handler(request):
        return httpx.Response(200, json={"data": {}} if request.url.path.endswith("/key") else {"data": [row(pricing={})]})
    result = await provider_preflight("openrouter", source(handler), "current/model:free", probe=True)
    assert result["status"] == "free_constraint_unverified"
    assert result["inference_requests"] == 0


@pytest.mark.asyncio
async def test_catalog_advertised_no_tools_blocks_inference():
    def handler(request):
        return httpx.Response(200, json={"data": {}} if request.url.path.endswith("/key") else {"data": [row(supported_parameters=[])]})
    result = await provider_preflight("openrouter", source(handler), "current/model:free", probe=True)
    assert result["status"] == "tools_unsupported"
    assert result["inference_requests"] == 0


@pytest.mark.asyncio
async def test_gemini_openai_catalog_prefix_and_unknown_capabilities_are_explicit():
    def handler(request):
        assert request.url.path == "/v1/models"
        return httpx.Response(200, json={"data": [{"id": "models/gemini-test"}]})
    result = await provider_preflight("gemini", source(handler), "gemini-test")
    assert result["ready"] is True
    assert result["advertised_tools"] is None
    assert result["capabilities"]["tool_calling"] is None


def probe_tool_message():
    return {"role": "assistant", "content": None, "tool_calls": [{"id": "ping-1", "type": "function",
        "function": {"name": "evaluation_ping", "arguments": '{"token":"preflight"}'}}]}


def probe_source(first=None, second=None, catalog_row=None):
    requests = []
    outputs = [first if first is not None else {"choices": [{"message": probe_tool_message()}], "usage": {"cost": 0}},
               second if second is not None else {"choices": [{"message": {"content": '{"answer":"preflight ready","recommendations":[]}'}}], "usage": {"cost": 0}}]
    def handler(request):
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(200, json={"data": {}} if request.url.path.endswith("/key") else {"data": [catalog_row or row()]})
        return httpx.Response(200, json=outputs.pop(0))
    return source(handler), requests


@pytest.mark.asyncio
async def test_optional_probe_checks_structured_tools_and_json_without_fixtures_or_live_tools():
    provider, calls = probe_source()
    result = await provider_preflight("openrouter", provider, "current/model:free", probe=True)
    assert result["ready"] is True
    assert result["capabilities"] == {"tool_calling": True, "json_output": True}
    assert result["inference_requests"] == 2
    assert result["probe_billing"] == {"cost_usd": 0, "billing_complete": True}
    payloads = [json.loads(request.content) for request in calls if request.method == "POST"]
    assert all(payload["model"] == "current/model:free" for payload in payloads)
    assert payloads[0]["tools"][0]["function"]["name"] == "evaluation_ping"
    assert all(payload["reasoning"] == {"enabled": False} for payload in payloads)
    assert all(payload["provider"]["max_price"] == {"prompt": 0, "completion": 0, "request": 0} for payload in payloads)
    assert result["metadata"]["openrouter_probe_reasoning_disabled"] is True
    assert "get_stock_snapshot" not in json.dumps(payloads)


@pytest.mark.asyncio
async def test_literal_tool_text_does_not_pass_structured_tool_capability_probe():
    provider, _ = probe_source(first={"choices": [{"message": {"content": '<tool_call>evaluation_ping</tool_call>'}}]})
    result = await provider_preflight("openrouter", provider, "current/model:free", probe=True)
    assert result["status"] == "tool_probe_failed"
    assert result["capabilities"]["tool_calling"] is False
    assert result["inference_requests"] == 1
    assert result["probe_billing"]["cost_usd"] is None


@pytest.mark.asyncio
async def test_prose_instead_of_json_fails_output_capability_probe():
    provider, _ = probe_source(second={"choices": [{"message": {"content": "preflight ready"}}]})
    result = await provider_preflight("openrouter", provider, "current/model:free", probe=True)
    assert result["status"] == "json_probe_failed"
    assert result["capabilities"] == {"tool_calling": True, "json_output": False}
    assert result["probe_billing"]["cost_usd"] is None


@pytest.mark.asyncio
async def test_positive_reported_charge_stops_free_probe_and_retains_actual_billing():
    provider, _ = probe_source(first={"choices": [{"message": probe_tool_message()}], "usage": {"cost": .01}})
    result = await provider_preflight("openrouter", provider, "current/model:free", probe=True)
    assert result["ready"] is False
    assert result["status"] == "free_constraint_violated"
    assert result["inference_requests"] == 1
    assert result["probe_billing"] == {"cost_usd": .01, "billing_complete": True}


@pytest.mark.asyncio
async def test_omitted_request_pricing_is_unknown_and_guarded_by_zero_request_wire_cap():
    provider, requests = probe_source(catalog_row=row(pricing={"prompt": "0", "completion": "0"}))
    result = await provider_preflight("openrouter", provider, "current/model:free", probe=True)
    assert result["ready"] is True
    assert result["metadata"]["pricing_basis"] == "zero_token_catalog_and_zero_request_cap"
    for request in requests:
        if request.method == "POST":
            assert json.loads(request.content)["provider"]["max_price"] == {"prompt": 0, "completion": 0, "request": 0}
            assert json.loads(request.content)["reasoning"] == {"enabled": False}


@pytest.mark.asyncio
async def test_timeout_is_bounded_and_retains_no_secrets_or_unobserved_costs():
    async def handler(request):
        await asyncio.sleep(1)
        return httpx.Response(200, json={"data": []})
    result = await provider_preflight("gemini", source(handler), "gemini-test", timeout_seconds=.01)
    assert result["status"] == "timeout"
    assert len(result["requests"]) == 1
    assert result["probe_billing"]["cost_usd"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("catalog", [{}, {"data": "bad"}, {"data": [None]}, {"error": {"message": "test-secret-key"}}])
async def test_malformed_catalog_cannot_be_used_as_capability_evidence(catalog):
    def handler(request):
        return httpx.Response(200, json=catalog)
    result = await provider_preflight("gemini", source(handler), "gemini-test")
    assert result["ready"] is False
    assert result["status"] == "catalog_unavailable"
    assert "test-secret" not in json.dumps(result)
