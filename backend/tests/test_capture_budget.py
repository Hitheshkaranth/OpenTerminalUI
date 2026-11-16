"""Actual model finalization within bounded frozen-evidence captures."""

import asyncio
from copy import deepcopy
import json

import pytest

from backend.evaluation import capture
from backend.evaluation.agent import evaluate_case
from backend.services.llm.base import AssistantMessage, LLMError, ToolCall


def fixture():
    return next(case for case in json.loads(capture.FIXTURES.read_text()) if case["id"] == "screen_context_india")


def answer(text="TCS P/E is 27.4."):
    return AssistantMessage(content=json.dumps({"answer": text, "recommendations": []}))


def query(identifier="one", ticker="TCS"):
    return AssistantMessage(tool_calls=[ToolCall(identifier, "get_stock_snapshot", {"ticker": ticker})])


class Scripted:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    async def complete(self, messages, **kwargs):
        self.calls.append((deepcopy(messages), kwargs))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def count_registry(monkeypatch, case):
    original = capture.build_frozen_registry(case)
    executed = []

    class Counter:
        def tool_defs(self):
            return original.tool_defs()

        async def execute(self, name, args):
            executed.append((name, args))
            return await original.execute(name, args)

    monkeypatch.setattr(capture, "build_frozen_registry", lambda case: Counter())
    return executed


async def run(provider, **kwargs):
    return await capture.capture_case(fixture(), provider, provider_name="scripted", model="pinned", **kwargs)


@pytest.mark.asyncio
async def test_last_step_is_an_actual_no_tool_model_answer_not_a_budget_template():
    provider = Scripted([query(), answer()])
    result = await run(provider, max_steps=2)
    assert len(provider.calls) == 2
    assert provider.calls[0][1]["tools"]
    assert provider.calls[1][1]["tools"] is None
    assert "No further tools" in provider.calls[1][0][-1].content
    assert result["answer"] == "TCS P/E is 27.4."
    assert result["capture"]["status"] == "completed"
    assert result["capture"]["termination_reason"] == "step_budget_finalization"
    assert result["capture"]["budget_finalization"] is True
    assert result["capture"]["budget_warnings"]
    assert evaluate_case(fixture(), result)["passed"]


@pytest.mark.asyncio
async def test_finished_tool_loop_answer_has_no_redundant_third_inference():
    provider = Scripted([query(), answer()])
    result = await run(provider, max_steps=4)
    assert len(provider.calls) == 2 and provider.replies == []
    assert result["capture"]["status"] == "completed"
    assert result["capture"]["termination_reason"] == "model_final"


@pytest.mark.asyncio
async def test_repeated_identical_query_is_not_executed_again_and_next_turn_has_no_tools(monkeypatch):
    executed = count_registry(monkeypatch, fixture())
    provider = Scripted([query("first"), query("again"), answer()])
    result = await run(provider, max_steps=8)
    assert len(executed) == 1
    assert len(result["tool_calls"]) == 2  # actual model attempts remain visible
    assert result["tool_calls"][1]["result"]["error"]["code"] == "tool_phase_closed"
    assert provider.calls[-1][1]["tools"] is None
    assert result["capture"]["termination_reason"] == "repeated_tool_query"
    assert result["capture"]["status"] == "completed"
    assert evaluate_case(fixture(), result)["passed"]


@pytest.mark.asyncio
async def test_second_frozen_unavailable_closes_tool_phase_after_one_recovery(monkeypatch):
    executed = count_registry(monkeypatch, fixture())
    attempt = AssistantMessage(tool_calls=[ToolCall("wrong", "get_stock_snapshot", {"ticker": "WRONG"}),
                                           ToolCall("alternate", "get_stock_snapshot", {"ticker": "OTHER"})])
    provider = Scripted([attempt, answer("Frozen evidence is unavailable; no current figure is established.")])
    result = await run(provider, max_steps=8)
    assert executed == [("get_stock_snapshot", {"ticker": "WRONG"}), ("get_stock_snapshot", {"ticker": "OTHER"})]
    assert result["tool_calls"][1]["result"]["error"]["code"] == "frozen_evidence_unavailable"
    assert result["capture"]["unavailable_tool_recoveries"] == 1
    assert provider.calls[-1][1]["tools"] is None
    assert result["capture"]["termination_reason"] == "frozen_evidence_unavailable"
    assert result["capture"]["status"] == "completed"
    assert not evaluate_case(fixture(), result)["passed"]  # no expected evidence was observed


@pytest.mark.asyncio
async def test_model_ignoring_final_no_tools_cannot_execute_or_claim_completion(monkeypatch):
    executed = count_registry(monkeypatch, fixture())
    provider = Scripted([query(), query("ignored-boundary", "INFY")])
    result = await run(provider, max_steps=2)
    assert executed == [("get_stock_snapshot", {"ticker": "TCS"})]
    assert result["capture"]["status"] == "step_budget_exhausted"
    assert result["capture"]["termination_reason"] == "finalization_tool_calls_rejected"
    assert result["tool_calls"][-1]["result"]["error"]["code"] == "tools_disabled"
    assert not evaluate_case(fixture(), result)["passed"]


@pytest.mark.asyncio
async def test_interrupted_tool_inference_can_finalize_honestly_with_unknown_total_billing():
    class SlowToolPhase:
        def __init__(self):
            self.count = 0
            self.cancelled = False
            self.response_metadata = []

        async def complete(self, messages, **kwargs):
            self.count += 1
            if self.count == 1:
                self.response_metadata.append({"actual_model": "observed", "usage": {"cost": 0}, "cost_usd": 0})
                return query()
            if self.count == 2:
                try:
                    await asyncio.sleep(60)
                except asyncio.CancelledError:
                    self.cancelled = True
                    raise
            assert kwargs["tools"] is None
            self.response_metadata.append({"actual_model": "observed", "usage": {"cost": .002}, "cost_usd": .002})
            return answer()

    provider = SlowToolPhase()
    result = await run(provider, timeout_seconds=1.5, finalization_reserve_seconds=.9)
    assert provider.cancelled and provider.count == 3
    assert result["capture"]["status"] == "completed"
    assert result["capture"]["budget_finalization"] is True
    assert result["capture"]["termination_reason"] == "tool_phase_time_budget"
    assert result["capture"]["errors"] == []
    assert result["capture"]["completions"][1]["budget_interrupted"] is True
    assert result["capture"]["budget_warnings"]
    assert result["cost_usd"] is None and result["capture"]["billing_complete"] is False
    assert result["capture"]["reported_response_cost_usd"] == .002
    assert result["latency_ms"] < 1500
    assert evaluate_case(fixture(), result)["passed"]


@pytest.mark.asyncio
async def test_final_inference_timeout_remains_a_failed_capture_without_fabricated_answer():
    class SlowFinal:
        async def complete(self, messages, **kwargs):
            await asyncio.sleep(60)

    result = await run(SlowFinal(), max_steps=1, timeout_seconds=.04)
    assert result["capture"]["status"] == "timeout"
    assert result["raw_answer"] == ""
    assert result["cost_usd"] is None
    assert not evaluate_case(fixture(), result)["passed"]


@pytest.mark.asyncio
async def test_fatal_provider_error_is_not_retried_as_a_final_answer():
    provider = Scripted([LLMError("LLM HTTP 401: invalid API key")])
    result = await run(provider)
    assert len(provider.calls) == 1
    assert result["capture"]["status"] == "provider_error"
    assert not result["capture"]["budget_finalization"]


@pytest.mark.asyncio
async def test_empty_model_output_cannot_be_labeled_completed():
    result = await run(Scripted([AssistantMessage(content=None)]))
    assert result["capture"]["status"] == "empty_output"
    assert result["answer"] == ""


@pytest.mark.asyncio
@pytest.mark.parametrize("reserve", [0, -1, True, float("nan"), float("inf"), 60, 61])
async def test_invalid_finalization_reserve_never_starts_inference(reserve):
    provider = Scripted([])
    with pytest.raises(ValueError, match="finalization_reserve_seconds"):
        await run(provider, finalization_reserve_seconds=reserve)
    assert provider.calls == []
