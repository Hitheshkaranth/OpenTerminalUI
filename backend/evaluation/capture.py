"""Capture actual model runs against frozen tool evidence, then score offline.

No production tool handler is reachable. Only model inference uses a network.
Use --dry-run to inspect the protocol without contacting a model.
"""
from __future__ import annotations

import argparse
import asyncio
from copy import deepcopy
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import time
from typing import Any

from backend.agent.orchestrator import Orchestrator, ToolPhaseBudgetExhausted
from backend.agent.playbook import ACTION_INTENT_DISCIPLINE, EVIDENCE_DISCIPLINE, READ_ONLY_NOTICE
from backend.agent.tools.registry import ToolRegistry, ToolSpec
from backend.config.settings import get_settings
from backend.evaluation.agent import evaluate
from backend.evaluation.provider_checks import provider_preflight
from backend.services.llm.factory import AGENT_PROVIDERS, get_llm_provider
from backend.services.llm.base import LLMError, LLMMessage
from backend.services.llm.openai_compatible import OpenAICompatibleProvider


FIXTURES = Path(__file__).parent / "fixtures" / "agent_research.json"
CAPTURE_PROTOCOL_VERSION = "frozen_capture_v6"
UNAVAILABLE_TOOL_RECOVERY_LIMIT = 1
PROTOCOL = (
    "Frozen-evidence evaluation: tools return only the supplied historical fixture evidence. "
    "An unavailable query has no evidence; do not repeat it or invent its result. "
    "You may try another relevant advertised tool within the remaining tool budget. Proposal tools are simulations "
    "and execute nothing. Give your final response as a JSON object with an `answer` string and a "
    "`recommendations` array. Include {symbol, portfolio_id, quantity} in that array only when you "
    "actually recommend a share quantity; otherwise use an empty array. Never invent a quantity "
    "to satisfy this output format. Each recommendation must include symbol, portfolio_id (string or null), "
    "and a finite nonnegative numeric quantity. State evidence limitations in the answer. "
    "Return only the JSON object, without a Markdown wrapper or surrounding commentary."
)
CAPTURE_SYSTEM_PROMPT = "\n\n".join((PROTOCOL, EVIDENCE_DISCIPLINE, READ_ONLY_NOTICE, ACTION_INTENT_DISCIPLINE))
OUTPUT_REPAIR_INSTRUCTIONS = (
    "Convert the recorded draft into the required JSON output format. This is a format-only operation. "
    "Copy the draft answer VERBATIM into the answer string, preserving every word, number, Markdown mark and newline. "
    "For a draft already containing an answer field, copy that field verbatim. Do not improve advice, correct errors, "
    "change quantities, add or retract proposals, or replace a recommendation with the sizing limit. "
    "Populate recommendations only for quantities explicitly recommended by the draft; copy those quantities exactly. "
    "If the draft abstains or does not recommend a share quantity, use an empty array. Never invent a zero recommendation. "
    "Only the original question, draft and actually observed tool calls/results are supplied. No tools are available. "
    + PROTOCOL
)

# Schemas describe capabilities, never the expected argument values or answers.
_SCHEMAS = {
    "get_stock_snapshot": ("Get frozen price and fundamentals for a ticker.",
                           {"ticker": {"type": "string"}}, ["ticker"]),
    "get_trade_size": ("Calculate the complete advisory incremental long-buy whole-share allowance for a paper portfolio and hypothetical stop. "
                       "Uses portfolio cash, holdings, marked prices and risk limits internally; a stock snapshot is not a prerequisite. "
                       "A successful quantity of zero means no additional shares fit the limits. Creates no order.",
                       {"symbol": {"type": "string"}, "portfolio_id": {"type": "string"},
                        "stop_price": {"type": "number"}, "risk_budget_pct": {"type": "number"},
                        "max_position_pct": {"type": "number"}}, ["symbol", "stop_price"]),
    "propose_journal_entry": ("Simulate a pending journal proposal for review. No data is saved or executed.",
                              {"title": {"type": "string"}, "body": {"type": "string"},
                               "ticker": {"type": "string"}, "tags": {"type": "array", "items": {"type": "string"}}},
                              ["title", "body"]),
    "propose_paper_order": ("Simulate a paper order proposal for human review. Nothing is executed.",
                            {"symbol": {"type": "string"}, "portfolio_id": {"type": "string"},
                             "side": {"type": "string", "enum": ["buy", "sell"]}, "quantity": {"type": "number"},
                             "rationale": {"type": "string"}, "stop_price": {"type": "number"}},
                            ["symbol", "side", "quantity", "rationale"]),
}


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, allow_nan=False).encode()).hexdigest()


def protocol_digest(*, output_repair: bool = True) -> str:
    return digest({"version": CAPTURE_PROTOCOL_VERSION, "system_prompt": CAPTURE_SYSTEM_PROMPT,
        "repair_instructions": OUTPUT_REPAIR_INSTRUCTIONS, "output_repair_enabled": output_repair,
        "max_output_repair_calls": 1, "repair_preserves_answer_verbatim": True,
        "repair_quantity_claims_must_be_preserved": True,
        "repair_structured_identity_must_be_preserved": True,
        "repair_explicit_prose_identity_must_be_preserved": True,
        "repair_signed_quantities_must_be_preserved": True,
        "openrouter_reasoning": {"enabled": False},
        "reject_incomplete_completions": True, "reasoning_is_not_final_answer": True,
        "unavailable_tool_recovery_limit": UNAVAILABLE_TOOL_RECOVERY_LIMIT,
        "tool_schemas": _SCHEMAS,
        "finalize_last_step": True, "synthesize_after_tool_answer": False,
        "stop_on_tool_stagnation": True, "provider_preflight_required": True})


def build_frozen_registry(case: dict) -> ToolRegistry:
    """Load canned results, never expected answers, into an isolated registry.

    Lookup is exact: different symbols, stops, budgets or extra arguments have no
    evidence. Repeated identical queries return independent copies of that same
    snapshot. Unknown calls fail; they cannot fall through to production tools.
    """
    frozen = deepcopy(case.get("frozen_tool_calls", case.get("reference_observation", {}).get("tool_calls", [])))
    registry = ToolRegistry()
    for name, (description, properties, required) in _SCHEMAS.items():
        def handler(args, tool_name=name):
            for row in frozen:
                if row.get("name") == tool_name and digest(row.get("arguments", {})) == digest(args):
                    result = deepcopy(row.get("result", {"error": "Frozen tool result is missing"}))
                    if tool_name.startswith("propose_") and isinstance(result, dict):
                        result.update({"simulated": True, "executed": False})
                    return result
            return {"ok": False, "error": {"code": "frozen_evidence_unavailable",
                    "message": "No frozen evidence exists for this tool and these exact arguments."}}
        registry.register(ToolSpec(name, description,
            {"type": "object", "properties": deepcopy(properties), "required": list(required)},
            handler=handler, read_only=True, write_class="none"))
    return registry


def _money(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return float(value) if math.isfinite(value) and value >= 0 else None
    except OverflowError:
        return None


def _redact(provider, message: str) -> str:
    secret = getattr(provider, "api_key", None)
    message = message.replace(secret, "[redacted]") if secret else message
    # Gateways may echo account identifiers in HTTP error JSON, including a
    # truncated response body. Retain HTTP status/model details, not identities.
    return re.sub(
        r'''((?:["'])?\b(?:user_id|userid|account_id|accountid|organization_id|org_id|organization)(?:["'])?\s*[:=]\s*)(?:"[^"\n]*(?:"|$)|'[^'\n]*(?:'|$)|[^\s,}\]]+)''',
        lambda match: match.group(1) + '"[redacted]"', message, flags=re.I,
    )


class CaptureGateway(OpenAICompatibleProvider):
    """Capture-local adapter; records raw response metadata without global hooks."""
    def __init__(self, *, provider_name: str, **kwargs):
        super().__init__(**kwargs, honor_model_chain=False, fallback_models=[], max_attempts=1)
        self.provider_name = provider_name
        self.response_metadata: list[dict] = []
        self.billing_policy_violation = False

    def _request_options(self, model: str) -> dict:
        if self.provider_name != "openrouter":
            return {}
        options = {"reasoning": {"enabled": False}}
        if model.endswith(":free"):
            options["provider"] = {"max_price": {"prompt": 0, "completion": 0, "request": 0}}
        return options

    def _parse(self, data: dict, *, model: str | None = None):
        usage = data.get("usage") if isinstance(data, dict) else None
        usage = usage if isinstance(usage, dict) else {}
        actual = data.get("model") if isinstance(data, dict) else None
        actual = actual if isinstance(actual, str) and actual.strip() else None
        cost = _money(usage.get("cost_usd"))
        if cost is None and self.provider_name == "openrouter":
            cost = _money(usage.get("cost"))  # OpenRouter documents usage.cost in USD.
        choices = data.get("choices") if isinstance(data, dict) else None
        choice = choices[0] if isinstance(choices, list) and choices and isinstance(choices[0], dict) else {}
        message = choice.get("message")
        message = message if isinstance(message, dict) else {}
        finish_reason = choice.get("finish_reason")
        content = message.get("content")
        self.response_metadata.append({"requested_model": model, "actual_model": actual,
            "finish_reason": finish_reason, "raw_content": content,
            "visible_content_present": isinstance(content, str) and bool(content.strip()),
            "reasoning_present": bool(message.get("reasoning") or message.get("reasoning_details")),
            "usage": {key: value for key, value in usage.items() if key in {
                "prompt_tokens", "completion_tokens", "total_tokens", "input_tokens", "output_tokens",
                "cost", "cost_usd"} and _money(value) is not None}, "cost_usd": cost})
        if self.provider_name == "openrouter" and self.model.endswith(":free") and cost is not None and cost > 0:
            self.billing_policy_violation = True
            raise LLMError("A selected free model reported a positive charge; further case inference is blocked.")
        if finish_reason in {"length", "max_tokens", "content_filter", "error"}:
            raise LLMError(f"Incomplete capture completion (finish_reason={finish_reason}); no answer or format repair was accepted.")
        if not (isinstance(content, str) and content.strip()) and not message.get("tool_calls") and (message.get("reasoning") or message.get("reasoning_details")):
            raise LLMError("Reasoning-only capture response has no final answer; format repair was not attempted.")
        return super()._parse(data, model=actual or model)


def configured_provider(provider_name: str, model: str) -> CaptureGateway:
    source = get_llm_provider(provider=provider_name, model=model)
    return CaptureGateway(provider_name=provider_name, base_url=source.base_url,
        api_key=source.api_key, model=source.model, timeout=source.timeout,
        extra_headers=source.extra_headers, transport=source._transport)


class _PinnedRecorder:
    honor_model_chain = False

    def __init__(self, provider, model: str, max_tokens: int, *, deadline: float | None = None,
                 tool_deadline: float | None = None):
        self.provider, self.model, self.max_tokens = provider, model, max_tokens
        self.completions: list[dict] = []
        self.deadline, self.tool_deadline = deadline, tool_deadline
        self.finalization_timed_out = False

    async def complete(self, messages, **kwargs):
        kwargs["models"] = [self.model]
        kwargs["max_tokens"] = min(kwargs.get("max_tokens", self.max_tokens), self.max_tokens)
        phase = "tool_use" if kwargs.get("tools") else "finalization"
        boundary = self.tool_deadline if phase == "tool_use" else self.deadline
        remaining = boundary - time.perf_counter() if boundary is not None else None
        if remaining is not None and remaining <= 0:
            if phase == "tool_use":
                raise ToolPhaseBudgetExhausted("Reserved finalization budget has begun")
            self.finalization_timed_out = True
            raise LLMError("Capture finalization time budget exhausted")
        before = len(getattr(self.provider, "response_metadata", []))
        record = {"requested_model": self.model, "responses": [], "error": None,
                  "phase": phase, "budget_interrupted": False}
        self.completions.append(record)
        try:
            request = self.provider.complete(messages, **kwargs)
            return await asyncio.wait_for(request, timeout=remaining) if remaining is not None else await request
        except TimeoutError:
            record["budget_interrupted"] = True
            record["error"] = f"TimeoutError: capture {phase} inference budget exhausted"
            if phase == "tool_use":
                raise ToolPhaseBudgetExhausted(record["error"]) from None
            self.finalization_timed_out = True
            raise LLMError(record["error"]) from None
        except asyncio.CancelledError:
            record["error"] = "CancelledError: inference interrupted before completion"
            raise
        except Exception as exc:
            detail = _redact(self.provider, str(exc))
            record["error"] = f"{type(exc).__name__}: {detail}"
            raise LLMError(record["error"]) from None
        finally:
            record["responses"] = deepcopy(getattr(self.provider, "response_metadata", [])[before:])


def billing_summary(completions: list[dict]) -> dict:
    """A partially observed request series cannot establish its total cost."""
    responses = [response for call in completions for response in call.get("responses", [])]
    known = [response["cost_usd"] for response in responses if response.get("cost_usd") is not None]
    complete = bool(completions) and all(call.get("responses") and not call.get("error") for call in completions)
    complete = complete and len(known) == len(responses)
    return {"cost_usd": sum(known) if complete else None, "billing_complete": complete,
            "reported_response_cost_usd": sum(known) if known else None}


def _decode_answer(raw: str) -> tuple[dict, str]:
    text = raw.strip()
    if text.startswith("```") and text.endswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I)
    try:
        def invalid_constant(value):
            raise ValueError(f"Invalid JSON constant: {value}")
        value = json.loads(text, parse_constant=invalid_constant)
    except (ValueError, TypeError):
        return {"answer": raw}, "unstructured"
    if not isinstance(value, dict) or not isinstance(value.get("answer"), str):
        return {"answer": raw}, "invalid_schema"
    result = {"answer": value["answer"]}
    if "recommendations" in value:
        rows = value["recommendations"]
        if not isinstance(rows, list) or any(not isinstance(row, dict)
            or not isinstance(row.get("symbol"), str)
            or (row.get("portfolio_id") is not None and not isinstance(row["portfolio_id"], str)) for row in rows):
            return {"answer": value["answer"]}, "invalid_schema"
        result["recommendations"] = deepcopy(rows)
    if "suggested_quantity" in value:
        result["suggested_quantity"] = value["suggested_quantity"]
    return result, "json"


def _decode_output_contract(raw: str) -> tuple[dict, str]:
    value, protocol = _decode_answer(raw)
    if protocol == "json":
        if "recommendations" not in value:
            return value, "missing_recommendations"
        if any(not row.get("symbol", "").strip() or "portfolio_id" not in row
               or _money(row.get("quantity")) is None for row in value["recommendations"]):
            return value, "invalid_schema"
    return value, protocol


def _draft_quantities(raw: str, decoded: dict) -> list[float]:
    """Conservatively identify explicit quantity advice, never a tool's sizing cap."""
    if isinstance(decoded.get("recommendations"), list) and decoded["recommendations"]:
        return [quantity for row in decoded["recommendations"] if isinstance(row, dict)
                and (quantity := _money(row.get("quantity"))) is not None]
    if "suggested_quantity" in decoded and _money(decoded["suggested_quantity"]) is not None:
        return [_money(decoded["suggested_quantity"])]
    text = decoded.get("answer", raw)
    quantities = []
    for match in re.finditer(r"(?<![\w.])(?P<qty>[+-]?\d[\d,]*(?:\.\d+)?(?:e[+-]?\d+)?)\s+(?:[A-Za-z][A-Za-z0-9:._-]*\s+)?shares?\b", text, re.I):
        prefix = re.split(r"[\n;.!?]", text[:match.start()])[-1][-70:]
        if not re.search(r"\b(?:buy|sell|purchase|recommend\w*|suggest\w*|add)\b", prefix, re.I):
            continue
        if re.search(r"\b(?:not|never|don't|cannot|can't|no)\b", prefix, re.I):
            continue
        quantity = float(match["qty"].replace(",", ""))
        if math.isfinite(quantity):
            quantities.append(quantity)
    return quantities


def _preserves_prose_identity(text: str, rows: list[dict]) -> bool:
    """Match explicitly stated share/symbol/book claims without guessing identities."""
    remaining = list(rows)
    pattern = r"(?<![\w.])(?P<qty>[+-]?\d[\d,]*(?:\.\d+)?(?:e[+-]?\d+)?)\s+(?:(?P<symbol>[A-Za-z][A-Za-z0-9:._-]*)\s+)?shares?\b(?P<tail>[^\n.!?;]{0,150})"
    for match in re.finditer(pattern, text, re.I):
        prefix = re.split(r"[\n;.!?]", text[:match.start()])[-1][-70:]
        if not re.search(r"\b(?:buy|sell|purchase|recommend\w*|suggest\w*|add)\b", prefix, re.I) or re.search(r"\b(?:not|never|don't|cannot|can't|no)\b", prefix, re.I):
            continue
        quantity = float(match["qty"].replace(",", ""))
        symbol = match["symbol"]
        suffix_symbol = re.match(r"\s+(?:of\s+)?\$?([A-Z][A-Z0-9:._-]*)\b", match["tail"])
        if symbol is None and suffix_symbol:
            symbol = suffix_symbol[1]
        clause = prefix + match.group(0)
        book = re.search(r"\b(?:portfolio_id|portfolio|book)\s*(?:[:=]\s*|(?:named|id)\s+)?[`\"']?([A-Za-z0-9_:-]+)", clause, re.I)
        if symbol is None and book is None:
            continue
        found = next((index for index, row in enumerate(remaining)
                      if float(row["quantity"]) == quantity
                      and (symbol is None or row["symbol"].strip().upper() == symbol.upper())
                      and (book is None or row["portfolio_id"] == book[1])), None)
        if found is None:
            return False
        remaining.pop(found)
    return True


async def _repair_final_output(recorder, case: dict, raw: str, calls: list[dict], repair: dict) -> str:
    decoded, original_protocol = _decode_output_contract(raw)
    repair.update(attempted=True, original_answer=raw, original_protocol=original_protocol, protocol_status="pending")
    response = await recorder.complete([
        LLMMessage(role="system", content=OUTPUT_REPAIR_INSTRUCTIONS),
        LLMMessage(role="user", content=json.dumps({"original_question": case["prompt"],
            "screen_context": case.get("context", {}), "reference_clock": case.get("evaluation_time"),
            "draft": raw, "observed_tool_calls": calls}, allow_nan=False)),
    ], tools=None)
    repaired_raw = response.content or ""
    repaired, protocol = _decode_output_contract(repaired_raw)
    repair.update(repaired_answer=repaired_raw, protocol_status=protocol)
    if response.tool_calls:
        repair.update(protocol_status="rejected_tool_calls", rejected_tool_calls=[call.to_wire() for call in response.tool_calls])
    elif protocol == "json":
        if repaired["answer"] != decoded["answer"]:
            repair.update(protocol_status="substantive_change", error="Format repair changed the draft answer")
        elif original_protocol == "invalid_schema":
            repair.update(protocol_status="ambiguous_original_schema", error="Malformed original recommendation schema cannot be safely repaired")
        else:
            old = Counter(quantity for quantity in _draft_quantities(raw, decoded) if quantity != 0)
            new = Counter(float(row["quantity"]) for row in repaired["recommendations"] if row["quantity"] > 0)
            explicit = set(_draft_quantities(raw, decoded))
            if old != new or any(float(row["quantity"]) not in explicit for row in repaired["recommendations"]):
                repair.update(protocol_status="quantity_changed", error="Format repair introduced, removed or changed quantity advice")
            if not _preserves_prose_identity(decoded["answer"], repaired["recommendations"]):
                repair.update(protocol_status="identity_changed", error="Format repair changed an explicitly stated symbol or portfolio")
            # An outer suggested_quantity may carry explicit identity even when
            # the recommendations field is missing. Never move that advice to
            # another symbol or paper portfolio during formatting.
            try:
                original_object = json.loads(raw)
            except (ValueError, TypeError):
                original_object = None
            if isinstance(original_object, dict) and "suggested_quantity" in original_object:
                symbol = original_object.get("symbol") or original_object.get("ticker")
                has_book = "portfolio_id" in original_object
                book = original_object.get("portfolio_id")
                for row in repaired["recommendations"]:
                    if (symbol is not None and row["symbol"].strip().upper() != str(symbol).strip().upper()) or (has_book and row["portfolio_id"] != book):
                        repair.update(protocol_status="identity_changed", error="Format repair changed explicit recommendation identity")
    return repaired_raw


async def capture_case(case: dict, provider, *, provider_name: str, model: str,
                       max_steps: int = 4, timeout_seconds: float = 60, max_tokens: int = 1024,
                       finalization_reserve_seconds: float | None = None, enable_output_repair: bool = True) -> dict:
    """Use the real tool loop and retain what the model actually did and saw."""
    started = time.perf_counter()
    reserve = min(15.0, timeout_seconds * .25) if finalization_reserve_seconds is None else finalization_reserve_seconds
    if isinstance(reserve, bool) or not isinstance(reserve, (int, float)) or not math.isfinite(reserve) or not 0 < reserve < timeout_seconds:
        raise ValueError("finalization_reserve_seconds must be finite, positive and below the case timeout")
    recorder = _PinnedRecorder(provider, model, max_tokens, deadline=started + timeout_seconds,
                               tool_deadline=started + timeout_seconds - reserve)
    runner = Orchestrator(provider=recorder, registry=build_frozen_registry(case), max_steps=max_steps,
                          finalize_last_step=True, synthesize_after_tool_answer=False, stop_on_tool_stagnation=True,
                          unavailable_tool_recovery_limit=UNAVAILABLE_TOOL_RECOVERY_LIMIT,
                          system_prompt=CAPTURE_SYSTEM_PROMPT)
    calls, errors, raw = [], [], ""
    output_repair = {"attempted": False, "original_answer": None, "repaired_answer": None, "protocol_status": "not_needed"}
    from backend.agent.run_context import active_run_id, active_lease_id, active_market
    run_token, lease_token, market_token = active_run_id.set(None), active_lease_id.set(None), active_market.set(None)

    async def collect():
        nonlocal raw
        if (case.get("context") or {}).get("historical_as_of") is not None:
            raise ValueError("Historical context can switch the production registry and is unsupported by this frozen capture runner")
        directive = PROTOCOL + (f" Frozen reference clock: {case['evaluation_time']}." if case.get("evaluation_time") else "")
        async for event in runner.run(case["prompt"], screen_context=case.get("context"), memory_directive=directive):
            if event["type"] == "tool_call":
                arguments = event["arguments"]
                try:
                    if not isinstance(arguments, dict):
                        raise ValueError("Tool arguments must be an object")
                    json.dumps(arguments, allow_nan=False)
                except (TypeError, ValueError):
                    calls.append({"id": event["id"], "name": event["name"], "arguments": {},
                                  "invalid_raw_arguments": repr(arguments)})
                    raise ValueError("Model supplied invalid JSON tool arguments; tool was not executed")
                calls.append({"id": event["id"], "name": event["name"], "arguments": deepcopy(event["arguments"])})
            elif event["type"] == "tool_result":
                for call in reversed(calls):
                    if call["id"] == event["id"] and call["name"] == event["name"] and "result" not in call:
                        call.update({"result": deepcopy(event["result"]), "is_error": event.get("is_error", False)})
                        break
            elif event["type"] == "error":
                errors.append(_redact(provider, event["message"]))
            elif event["type"] == "final":
                raw = event["content"]
        _, protocol = _decode_output_contract(raw)
        if enable_output_repair and raw.strip() and protocol != "json" and not errors and not raw.startswith("I reached the step budget for this run."):
            try:
                raw = await _repair_final_output(recorder, case, raw, calls, output_repair)
            except asyncio.CancelledError:
                output_repair["protocol_status"] = "timeout"
                raise
            except LLMError as exc:
                output_repair.update(protocol_status="provider_error", error=_redact(provider, str(exc)))
                errors.append(_redact(provider, str(exc)))
            except Exception as exc:
                output_repair.update(protocol_status="provider_error", error=_redact(provider, str(exc)))
                raise

    status = "completed"
    try:
        await asyncio.wait_for(collect(), timeout=timeout_seconds)
    except TimeoutError:
        status = "timeout"
        errors.append("Capture case wall-clock timeout")
        await asyncio.sleep(0)  # Let cancellation reach the provider recorder.
    except Exception as exc:
        status = "capture_error"
        errors.append(_redact(provider, f"{type(exc).__name__}: {exc}"))
    finally:
        active_run_id.reset(run_token)
        active_lease_id.reset(lease_token)
        active_market.reset(market_token)
    if recorder.finalization_timed_out and status == "completed":
        status = "timeout"
        errors.append("Capture finalization time budget exhausted")
    if errors or any(row["error"] and not (row.get("budget_interrupted") and row.get("phase") == "tool_use")
                     for row in recorder.completions):
        if status == "completed":
            status = "provider_error"
    if status == "completed" and raw.startswith("I reached the step budget for this run."):
        status = "step_budget_exhausted"
    if status == "completed" and not raw.strip():
        status = "empty_output"
        errors.append("Model returned no final answer")
    answer, protocol = _decode_output_contract(raw)
    if (protocol != "json" or (output_repair["attempted"] and output_repair["protocol_status"] != "json")) and status == "completed":
        status = "invalid_output_schema"
    responses = [response for call in recorder.completions for response in call["responses"]]
    # Unknown/partial costs remain unknown, including interrupted inference.
    billing = billing_summary(recorder.completions)
    budget_finalization = runner.termination_reason in {"step_budget_finalization", "tool_phase_time_budget", "repeated_tool_query", "frozen_evidence_unavailable"}
    budget_warnings = []
    if budget_finalization:
        budget_warnings.append("The tool phase ended at its budget/evidence boundary; the actual model finalized using only already-observed evidence.")
    if any(row.get("budget_interrupted") for row in recorder.completions):
        budget_warnings.append("An inference request was interrupted for the capture budget; its usage and total billing may be incomplete.")
    return {**answer, "raw_answer": raw, "tool_calls": calls, "actions_executed": [],
            "latency_ms": round((time.perf_counter() - started) * 1000, 3), "cost_usd": billing["cost_usd"],
            "capture": {"status": status, "provider": provider_name, "requested_model": model,
                "actual_models": list(dict.fromkeys(row["actual_model"] for row in responses if row["actual_model"])),
                "actual_model_unreported_responses": sum(row["actual_model"] is None for row in responses),
                "billing_complete": billing["billing_complete"], "reported_response_cost_usd": billing["reported_response_cost_usd"],
                "output_protocol": protocol, "errors": errors, "completions": recorder.completions,
                "output_repair": output_repair, "output_repair_enabled": enable_output_repair,
                "termination_reason": runner.termination_reason, "budget_finalization": budget_finalization,
                "unavailable_tool_recoveries": runner.unavailable_tool_recoveries,
                "budget_warnings": budget_warnings, "finalization_reserve_seconds": reserve,
                "capture_protocol": CAPTURE_PROTOCOL_VERSION, "protocol_sha256": protocol_digest(output_repair=enable_output_repair), "reference_clock": case.get("evaluation_time"),
                "fixture_sha256": digest(case), "max_steps": max_steps, "max_tokens": max_tokens,
                "timeout_seconds": timeout_seconds, "network_scope": "model_inference_only",
                "tool_source": "frozen_fixture", "actions": "simulated_only"}}


def _targets(providers: list[str], models: list[str]) -> list[tuple[str, str]]:
    settings = get_settings()
    targets = list(dict.fromkeys((name, model) for name in (providers or [settings.agent_provider])
        for model in (models or [settings.lm_studio_model if name == "lmstudio" else settings.agent_model])))
    if any(not isinstance(model, str) or not model.strip() or model != model.strip() for _, model in targets):
        raise ValueError("Model identifiers must be explicit non-empty strings without surrounding whitespace")
    return targets


def _save(path: Path, value: Any):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")
    temporary.replace(path)


def _progress(message: str):
    print(message, file=sys.stderr, flush=True)


def _runtime_provider_block(observation: dict) -> dict | None:
    metadata = observation.get("capture", {})
    if metadata.get("status") == "completed":
        return None
    errors = [*metadata.get("errors", []), *(row.get("error") or "" for row in metadata.get("completions", []))]
    statuses = {int(match) for error in errors for match in re.findall(r"\bHTTP\s+(401|403|402|404|429)\b", str(error), re.I)}
    if statuses & {401, 403}:
        return {"status": "authentication_failed", "errors": ["Authentication failed after preflight; further provider inference was stopped."]}
    if statuses & {402, 429}:
        return {"status": "quota_or_billing_blocked", "errors": ["Provider quota or billing blocked inference after preflight; no case score was assigned."]}
    if 404 in statuses:
        return {"status": "model_unavailable", "errors": ["The target became unavailable after catalog validation; select a new explicit target."]}
    return None


async def run_capture(args, cases: list[dict]) -> dict:
    preflight_only = bool(getattr(args, "preflight_only", False))
    targets = _targets(args.provider, args.model)
    selected = [case for case in cases if not args.case or case["id"] in args.case]
    if not selected or set(args.case) - {case["id"] for case in cases}:
        raise ValueError("No matching cases or unknown --case identifier")
    if len({case["id"] for case in cases}) != len(cases):
        raise ValueError("Fixture case identifiers must be unique")
    plan = {"mode": "dry_run" if args.dry_run else "provider_preflight" if preflight_only else "captured_frozen_evidence",
        "fixture_sha256": digest(cases), "case_ids": [] if preflight_only else [case["id"] for case in selected],
        "capture_protocol": CAPTURE_PROTOCOL_VERSION, "protocol_sha256": protocol_digest(),
        "targets": [{"provider": name, "requested_model": model} for name, model in targets],
        "max_steps": args.max_steps, "max_tokens": args.max_tokens, "timeout_seconds": args.timeout,
        "preflight_only": preflight_only,
        "provider_network_calls": not args.dry_run,
        "model_network_calls": not args.dry_run and (not preflight_only or bool(getattr(args, "probe_provider", False))),
        "production_tools": False, "actions_executed": False}
    if args.dry_run:
        return plan
    args.output_dir.mkdir(parents=True, exist_ok=True)
    prior_artifacts = (args.output_dir / "manifest.json").exists() or any(
        next(args.output_dir.glob(pattern), None) is not None for pattern in
        ("*.observations.json", "*.score.json", "*.preflight.json", "*.json.tmp"))
    if prior_artifacts:
        raise ValueError("This output directory already contains a capture. Choose a new directory to preserve earlier results.")
    try:
        with (args.output_dir / ".capture-run.json").open("x") as reservation:
            reservation.write(json.dumps(plan, indent=2, allow_nan=False) + "\n")
    except FileExistsError:
        raise ValueError("This output directory is reserved by an earlier or interrupted capture. Choose a new directory.") from None
    runs = []
    authentication_failures = {}
    for provider_name, model in targets:
        _progress(f"Checking {provider_name}/{model} credentials and model catalog…")
        adapter = configured_provider(provider_name, model)
        if provider_name in authentication_failures:
            preflight = {**deepcopy(authentication_failures[provider_name]), "requested_model": model, "cache_reused": True}
        else:
            preflight = await provider_preflight(provider_name, adapter, model,
                timeout_seconds=getattr(args, "preflight_timeout", 15), probe=getattr(args, "probe_provider", False))
        selected_model = model
        resolution = None
        alternative = getattr(args, "resolve_free_model", None)
        if not preflight["ready"] and preflight["status"] == "model_unavailable" and provider_name == "openrouter" and alternative:
            if alternative in preflight.get("available_free_models", []):
                original_preflight = preflight
                selected_model = alternative
                _progress(f"Explicit free replacement: {model} → {selected_model} (no paid fallback).")
                adapter = configured_provider(provider_name, selected_model)
                preflight = await provider_preflight(provider_name, adapter, selected_model,
                    timeout_seconds=getattr(args, "preflight_timeout", 15), probe=getattr(args, "probe_provider", False))
                resolution = {"requested_model": model, "selected_model": selected_model,
                              "reason": "explicit_verified_free_replacement", "original_preflight": original_preflight}
            else:
                preflight = {**preflight, "errors": [*preflight.get("errors", []),
                    "The explicit replacement is not a currently verified free tool-capable model; no replacement inference was sent."]}
        if preflight["status"] in {"authentication_failed", "credentials_missing"}:
            authentication_failures[provider_name] = deepcopy(preflight)
        name = re.sub(r"[^A-Za-z0-9_.-]", "_", provider_name + "-" + selected_model)[:90] + "-" + digest([provider_name, model, selected_model])[:8]
        preflight_path = args.output_dir / (name + ".preflight.json")
        _save(preflight_path, {**preflight, "resolution": resolution})
        if not preflight["ready"]:
            _progress(f"Skipped {provider_name}/{model}: {preflight['status']}; no case inference sent.")
            runs.append({"provider": provider_name, "requested_model": model, "selected_model": None,
                "preflight": str(preflight_path), "preflight_status": preflight["status"],
                "observations": None, "score": None, "summary": None, "capture_failures": 0,
                "evaluated_cases": 0, "skipped_cases": [] if preflight_only else [case["id"] for case in selected]})
            continue
        if preflight_only:
            _progress(f"Provider check ready: {provider_name}/{selected_model}; no evaluation cases were sent.")
            runs.append({"provider": provider_name, "requested_model": model, "selected_model": selected_model,
                "preflight": str(preflight_path), "preflight_status": "ready", "resolution": resolution,
                "observations": None, "score": None, "summary": None, "capture_failures": 0,
                "evaluated_cases": 0, "skipped_cases": []})
            continue
        observations = {}
        skipped_cases = []
        runtime_block = None
        observation_path = args.output_dir / (name + ".observations.json")
        report_path = args.output_dir / (name + ".score.json")
        for case in selected:
            # Separate adapters prevent mutable response records crossing cases.
            _progress(f"Running {provider_name}/{selected_model}: {case['id']} (case limit {args.timeout}s)…")
            adapter = configured_provider(provider_name, selected_model)
            observations[case["id"]] = await capture_case(case, adapter, provider_name=provider_name,
                model=selected_model, max_steps=args.max_steps, timeout_seconds=args.timeout, max_tokens=args.max_tokens)
            _save(observation_path, observations)
            _progress(f"Captured {case['id']}: {observations[case['id']]['capture']['status']}")
            runtime_block = _runtime_provider_block(observations[case["id"]])
            if runtime_block:
                if runtime_block["status"] == "authentication_failed":
                    authentication_failures[provider_name] = {**deepcopy(preflight), **runtime_block,
                        "ready": False, "selected_model": None, "failure_origin": "case_inference"}
                _save(preflight_path, {**preflight, "resolution": resolution, "runtime_failure": runtime_block})
                _progress(f"Stopped {provider_name}/{selected_model}: {runtime_block['status']}; remaining cases were not sent.")
                break
            if getattr(adapter, "billing_policy_violation", False):
                skipped_cases = [item["id"] for item in selected if item["id"] not in observations]
                _progress("Free-model billing constraint violated; remaining case inference stopped.")
                break
        if runtime_block:
            completed = [key for key, value in observations.items() if value["capture"]["status"] == "completed"]
            runs.append({"provider": provider_name, "requested_model": model, "selected_model": selected_model,
                "preflight": str(preflight_path), "preflight_status": runtime_block["status"], "resolution": resolution,
                "observations": str(observation_path), "score": None, "summary": None,
                "evaluated_cases": len(completed), "attempted_cases": len(observations), "completed_cases": completed,
                "skipped_cases": [case["id"] for case in selected if case["id"] not in completed],
                "capture_failures": sum(value["capture"]["status"] != "completed" for value in observations.values())})
            continue
        report = evaluate([case for case in selected if case["id"] in observations], observations)
        for row in report["cases"]:
            if observations[row["id"]]["capture"]["status"] != "completed":
                row["passed"] = False
                row["capture_failed"] = True
        report["summary"]["passed"] = sum(row["passed"] for row in report["cases"])
        report["mode"] = "captured_frozen_evidence"
        _save(report_path, report)
        runs.append({"provider": provider_name, "requested_model": model, "selected_model": selected_model,
            "preflight": str(preflight_path), "preflight_status": "ready", "resolution": resolution,
            "observations": str(observation_path), "score": str(report_path), "summary": report["summary"],
            "evaluated_cases": len(observations), "skipped_cases": skipped_cases,
            "capture_failures": sum(obs["capture"]["status"] != "completed" for obs in observations.values())})
    manifest = {**plan, "created_at": datetime.now(timezone.utc).isoformat(), "runs": runs}
    _save(args.output_dir / "manifest.json", manifest)
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--run", action="store_true")
    mode.add_argument("--preflight-only", action="store_true", help="Check provider credentials and model catalog without evaluating cases; inference only with explicit --probe-provider")
    parser.add_argument("--fixtures", type=Path, default=FIXTURES)
    parser.add_argument("--provider", action="append", default=[], choices=AGENT_PROVIDERS)
    parser.add_argument("--model", action="append", default=[])
    parser.add_argument("--case", action="append", default=[])
    parser.add_argument("--output-dir", type=Path, default=Path("output/agent-captures"))
    parser.add_argument("--max-steps", type=int, default=4)
    parser.add_argument("--max-tokens", type=int, default=1024)
    parser.add_argument("--timeout", type=float, default=60)
    parser.add_argument("--preflight-timeout", type=float, default=15, help="Catalog/auth timeout, >0 and <=15 seconds; no inference by default")
    parser.add_argument("--probe-provider", action="store_true", help="Also send a bounded two-completion harmless tool/JSON capability probe")
    parser.add_argument("--resolve-free-model", metavar="MODEL_ID", help="Explicit verified-free replacement for an unavailable OpenRouter target; never selects a paid model")
    args = parser.parse_args(argv)
    if not 1 <= args.max_steps <= 12 or not 1 <= args.max_tokens <= 8192 or not 0 < args.timeout <= 600:
        parser.error("max-steps must be 1..12, max-tokens 1..8192, timeout >0 and <=600")
    if not 0 < args.preflight_timeout <= 15:
        parser.error("preflight-timeout must be >0 and <=15 seconds")
    try:
        result = asyncio.run(run_capture(args, json.loads(args.fixtures.read_text())))
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, indent=2, allow_nan=False))
    if args.preflight_only:
        return 0 if all(run["preflight_status"] == "ready" for run in result["runs"]) else 1
    return 0 if args.dry_run or all(run["preflight_status"] == "ready" and not run.get("skipped_cases") and run["capture_failures"] == 0 and run["summary"]["passed"] == run["summary"]["total"] for run in result["runs"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
