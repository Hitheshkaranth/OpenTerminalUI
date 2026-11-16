"""Bounded, credential-safe provider checks before frozen-evidence evaluation.

Catalog checks perform no inference. Optional capability probes use only an
isolated ping tool and never access trading tools, fixtures, or expected answers.
Model replacements are suggestions: callers must explicitly select a new target.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
import math
import time
from typing import Any

import httpx


_MODALITY_PRICES = {"image", "audio", "input_audio", "output_audio", "input_audio_cache",
                    "video", "vision", "web_search"}


def _zero(value: Any) -> bool:
    if isinstance(value, bool) or value is None:
        return False
    try:
        number = Decimal(str(value))
        return number.is_finite() and number == 0
    except (InvalidOperation, ValueError):
        return False


def is_verified_free_model(row: dict) -> bool:
    """Require free-variant zero token pricing; reject any declared request fee.

    An omitted request price is unknown, not zero. Callers constrain that
    unknown with max_price.request=0 on every free inference request.
    """
    pricing = row.get("pricing")
    if not str(row.get("id", "")).endswith(":free") or not isinstance(pricing, dict):
        return False
    if not all(key in pricing and _zero(pricing[key]) for key in ("prompt", "completion")):
        return False
    if "request" in pricing and not _zero(pricing["request"]):
        return False
    return all(_zero(value) for key, value in pricing.items() if key not in _MODALITY_PRICES)


def free_tool_models(rows: list[dict]) -> list[str]:
    return sorted({row["id"] for row in rows if isinstance(row, dict)
                   and isinstance(row.get("id"), str) and is_verified_free_model(row)
                   and isinstance(row.get("supported_parameters"), list)
                   and "tools" in row["supported_parameters"]})


def _usage_cost(data: dict, provider_name: str) -> float | None:
    usage = data.get("usage") or {}
    if not isinstance(usage, dict):
        return None
    value = usage.get("cost_usd")
    if value is None and provider_name == "openrouter":
        value = usage.get("cost")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return float(value) if math.isfinite(value) and value >= 0 else None
    except OverflowError:
        return None


class _Blocked(Exception):
    def __init__(self, status: str, message: str):
        self.status, self.message = status, message


async def provider_preflight(provider_name: str, provider, requested_model: str, *,
                             timeout_seconds: float = 15, probe: bool = False) -> dict:
    """Return catalog/auth capability evidence; never retry or change a model.

    The entire operation, including optional probes, is limited to 15 seconds.
    Auth responses are inspected for a management-key boolean only. No raw key,
    model catalog, response body, account identity, or HTTP headers are returned.
    """
    started = time.perf_counter()
    result = {"ready": False, "status": "pending", "requested_model": requested_model,
        "selected_model": None, "available_free_models": [], "advertised_tools": None,
        "capabilities": {"tool_calling": None, "json_output": None}, "errors": [], "requests": [],
        "inference_requests": 0, "probe_billing": {"cost_usd": None, "billing_complete": False},
        "metadata": {"checked_at": datetime.now(timezone.utc).isoformat(),
            "catalog_source": "configured_provider_models_endpoint", "no_paid_fallback": True,
            "pricing_basis": "zero_token_catalog_and_zero_request_cap" if provider_name == "openrouter" and isinstance(requested_model, str) and requested_model.endswith(":free") else None,
            "openrouter_probe_reasoning_disabled": provider_name == "openrouter" and bool(probe),
            "probe_requested": probe}}
    costs: list[float | None] = []
    if isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, (int, float)) or not math.isfinite(timeout_seconds) or not 0 < timeout_seconds <= 15:
        raise ValueError("Preflight timeout must be >0 and <=15 seconds")
    if provider_name not in {"openrouter", "openai", "gemini", "lmstudio"} or not isinstance(requested_model, str) or not requested_model.strip() or requested_model != requested_model.strip():
        result.update(status="invalid_target", errors=["Select an explicit supported provider and model identifier."])
        result["metadata"]["latency_ms"] = round((time.perf_counter() - started) * 1000, 3)
        return result
    if provider_name != "lmstudio" and not getattr(provider, "api_key", None):
        result.update(status="credentials_missing", errors=["Provider credentials are missing; configure a valid key before evaluating."])
        result["metadata"]["latency_ms"] = round((time.perf_counter() - started) * 1000, 3)
        return result

    async def check():
        async with httpx.AsyncClient(timeout=timeout_seconds, trust_env=False,
                                     transport=getattr(provider, "_transport", None)) as client:
            async def request(endpoint: str, payload: dict | None = None) -> dict:
                method = "GET" if payload is None else "POST"
                record = {"method": method, "endpoint": endpoint, "status": None}
                result["requests"].append(record)
                if method == "POST":
                    result["inference_requests"] += 1
                response = await client.request(method, f"{provider.base_url.rstrip('/')}{endpoint}",
                    headers=provider._headers(), **({"json": payload} if payload is not None else {}))
                record["status"] = response.status_code
                if response.status_code in {401, 403}:
                    raise _Blocked("authentication_failed", "Provider authentication failed. Replace or authorize the configured key; no retries were attempted.")
                if response.status_code in {402, 429}:
                    raise _Blocked("quota_or_billing_blocked", f"Provider returned HTTP {response.status_code}; resolve quota or account access before evaluating.")
                if response.status_code == 404:
                    raise _Blocked("model_unavailable" if method == "POST" else "catalog_unavailable",
                                   "Requested model or endpoint is unavailable. Select an explicit current target; paid fallback is disabled.")
                if not response.is_success:
                    raise _Blocked("provider_unavailable", f"Provider returned HTTP {response.status_code}; no retries were attempted.")
                try:
                    data = response.json()
                except ValueError:
                    raise _Blocked("catalog_unavailable" if method == "GET" else "invalid_probe_response", "Provider returned invalid JSON.") from None
                if not isinstance(data, dict) or data.get("error"):
                    raise _Blocked("catalog_unavailable" if method == "GET" else "invalid_probe_response", "Provider returned an invalid response object.")
                if method == "POST":
                    observed_cost = _usage_cost(data, provider_name)
                    costs.append(observed_cost)
                    if provider_name == "openrouter" and requested_model.endswith(":free") and observed_cost is not None and observed_cost > 0:
                        raise _Blocked("free_constraint_violated", "The provider reported a positive charge for the selected free probe. Evaluation is blocked; observed billing is retained.")
                return data

            if provider_name == "openrouter":
                # /models is public and cannot validate a bearer key by itself.
                auth = await request("/key")
                if isinstance(auth.get("data"), dict) and auth["data"].get("is_management_key") is True:
                    raise _Blocked("authentication_failed", "A management key cannot invoke models. Configure an inference key.")
            catalog = await request("/models")
            rows = catalog.get("data")
            if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                raise _Blocked("catalog_unavailable", "Provider model catalog has no valid model list.")
            if provider_name == "openrouter":
                result["available_free_models"] = free_tool_models(rows)
            def identifier(value):
                return str(value or "").removeprefix("models/") if provider_name == "gemini" else value
            matches = [row for row in rows if identifier(row.get("id")) == identifier(requested_model)]
            if not matches:
                raise _Blocked("model_unavailable", "Requested model is absent from the current catalog. Available free suggestions require explicit selection.")
            model_row = matches[0]
            if provider_name == "openrouter" and requested_model.endswith(":free") and not is_verified_free_model(model_row):
                raise _Blocked("free_constraint_unverified", "The selected free model lacks zero token pricing or declares an invalid/nonzero text/request charge; no inference was sent.")
            supported = model_row.get("supported_parameters")
            if isinstance(supported, list):
                result["advertised_tools"] = "tools" in supported
                if not result["advertised_tools"]:
                    raise _Blocked("tools_unsupported", "The selected model catalog does not advertise tool calling.")
            if probe:
                messages = [{"role": "user", "content": "Call evaluation_ping exactly once with token=preflight. Do not answer in prose."}]
                tool = {"type": "function", "function": {"name": "evaluation_ping", "description": "Harmless isolated capability probe; no tools or data are accessed.",
                    "parameters": {"type": "object", "properties": {"token": {"type": "string", "enum": ["preflight"]}}, "required": ["token"]}}}
                payload = {"model": requested_model, "messages": messages, "tools": [tool],
                    "tool_choice": {"type": "function", "function": {"name": "evaluation_ping"}},
                    "max_tokens": 512, "temperature": 0, "stream": False}
                if provider_name == "openrouter":
                    payload["reasoning"] = {"enabled": False}
                    payload["provider"] = {"require_parameters": True, "max_price": {"prompt": 0, "completion": 0, "request": 0}} if requested_model.endswith(":free") else {"require_parameters": True}
                first = await request("/chat/completions", payload)
                try:
                    message = first["choices"][0]["message"]
                    calls = message.get("tool_calls") or []
                    call = calls[0] if len(calls) == 1 else {}
                    arguments = call["function"]["arguments"]
                    arguments = json.loads(arguments) if isinstance(arguments, str) else arguments
                    valid = call["function"]["name"] == "evaluation_ping" and arguments == {"token": "preflight"} and isinstance(call.get("id"), str) and bool(call["id"])
                except (KeyError, IndexError, ValueError, TypeError, AttributeError):
                    valid = False
                result["capabilities"]["tool_calling"] = valid
                if not valid:
                    raise _Blocked("tool_probe_failed", "The model did not produce the required structured tool call.")
                payload = {"model": requested_model, "messages": [*messages, message,
                    {"role": "tool", "tool_call_id": call["id"], "content": '{"ok":true}'},
                    {"role": "user", "content": 'Return only this JSON object: {"answer":"preflight ready","recommendations":[]}. Do not call tools.'}],
                    "max_tokens": 512, "temperature": 0, "stream": False}
                if provider_name == "openrouter":
                    payload["reasoning"] = {"enabled": False}
                    if requested_model.endswith(":free"):
                        payload["provider"] = {"max_price": {"prompt": 0, "completion": 0, "request": 0}}
                second = await request("/chat/completions", payload)
                try:
                    final = json.loads(second["choices"][0]["message"]["content"])
                    valid = final == {"answer": "preflight ready", "recommendations": []}
                except (KeyError, IndexError, ValueError, TypeError):
                    valid = False
                result["capabilities"]["json_output"] = valid
                if not valid:
                    raise _Blocked("json_probe_failed", "The model did not produce the required JSON answer format.")
            result.update(ready=True, status="ready", selected_model=requested_model)

    try:
        await asyncio.wait_for(check(), timeout_seconds)
    except _Blocked as exc:
        result.update(status=exc.status, errors=[exc.message])
    except (TimeoutError, httpx.TimeoutException):
        result.update(status="timeout", errors=["Provider preflight reached its wall-clock timeout; no retries were attempted."])
    except httpx.HTTPError:
        result.update(status="connection_failed", errors=["Provider connection failed; no retries were attempted."])
    except (AttributeError, TypeError, ValueError):
        result.update(status="invalid_provider", errors=["Provider configuration or response is invalid."])
    complete = bool(costs) and len(costs) == result["inference_requests"] and all(cost is not None for cost in costs)
    result["probe_billing"] = {"cost_usd": sum(costs) if complete else None, "billing_complete": complete}
    result["metadata"]["latency_ms"] = round((time.perf_counter() - started) * 1000, 3)
    return result
