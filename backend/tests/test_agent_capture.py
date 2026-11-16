"""Capture tests use scripted inference or HTTP mock transports, never live models."""
from __future__ import annotations

import asyncio
from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from backend.evaluation import capture
from backend.evaluation.agent import evaluate_case
from backend.services.llm.base import AssistantMessage, LLMError, ToolCall


def case(name="screen_context_india"):
    return next(row for row in json.loads(capture.FIXTURES.read_text()) if row["id"] == name)


class Scripted:
    def __init__(self, rows):
        self.rows = list(rows)
        self.calls = []

    async def complete(self, messages, **kwargs):
        self.calls.append((deepcopy(messages), kwargs))
        result = self.rows.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def final(text, **extra):
    return AssistantMessage(content=json.dumps({"answer": text, "recommendations": [], **extra}))


def scripted_snapshot(answer="TCS P/E is 27.4.", **extra):
    return Scripted([
        AssistantMessage(tool_calls=[ToolCall("one", "get_stock_snapshot", {"ticker": "TCS"})]),
        final(answer, **extra),
    ])


async def run(row, provider, **extra):
    return await capture.capture_case(row, provider, provider_name="scripted", model="selected-test-model", **extra)


@pytest.mark.asyncio
async def test_real_orchestrator_capture_contains_only_observed_evidence_and_pins_model():
    row = case()
    row["reference_observation"]["answer"] = "SECRET_REFERENCE_ANSWER_NOT_MODEL_INPUT"
    row["required_answer_fragments"] = ["SECRET_GRADING_CRITERION"]
    provider = scripted_snapshot()
    result = await run(row, provider, max_tokens=333)
    assert result["answer"] == "TCS P/E is 27.4."
    assert result["raw_answer"].startswith("{")
    assert result["tool_calls"][0]["result"]["pe"] == 27.4
    assert result["actions_executed"] == []
    assert result["latency_ms"] > 0
    assert result["cost_usd"] is None
    assert result["capture"]["status"] == "completed"
    assert len(provider.calls) == 2  # observed evidence, then the model's actual final answer
    for messages, kwargs in provider.calls:
        text = str(messages)
        assert "SECRET_REFERENCE_ANSWER" not in text and "SECRET_GRADING_CRITERION" not in text
        assert kwargs["models"] == ["selected-test-model"]
        assert kwargs["max_tokens"] == 333


@pytest.mark.asyncio
async def test_different_query_receives_unavailable_not_expected_result():
    provider = Scripted([
        AssistantMessage(tool_calls=[ToolCall("x", "get_stock_snapshot", {"ticker": "WRONG"})]),
        final("unavailable"), final("unavailable"),
    ])
    result = await run(case(), provider)
    call = result["tool_calls"][0]
    assert call["arguments"] == {"ticker": "WRONG"}
    assert call["result"]["error"]["code"] == "frozen_evidence_unavailable"
    assert call["is_error"] is True
    assert not evaluate_case(case(), result)["passed"]


@pytest.mark.asyncio
async def test_simulated_actions_and_active_run_cannot_write_checkpoints(monkeypatch):
    from backend.agent import execution
    from backend.agent.run_context import active_run_id

    monkeypatch.setattr(execution, "checkpoint_start", lambda *args, **kwargs: pytest.fail("No capture DB writes"))
    token = active_run_id.set("a-real-active-run")
    try:
        provider = Scripted([
            AssistantMessage(tool_calls=[ToolCall("p", "propose_journal_entry", {
                "title": "TCS research", "body": "Margins improve"})]),
            final("Ready for review; not executed."),
        ])
        result = await run(case("proposal_only"), provider)
        assert result["tool_calls"][0]["result"]["simulated"] is True
        assert result["tool_calls"][0]["result"]["executed"] is False
        assert result["actions_executed"] == []
        assert active_run_id.get() == "a-real-active-run"
    finally:
        active_run_id.reset(token)


@pytest.mark.asyncio
async def test_duplicate_call_identifiers_preserve_results_in_observed_order():
    row = case()
    row["frozen_tool_calls"] = [
        {"name": "get_stock_snapshot", "arguments": {"ticker": "A"}, "result": {"value": 1}},
        {"name": "get_stock_snapshot", "arguments": {"ticker": "B"}, "result": {"value": 2}},
    ]
    provider = Scripted([
        AssistantMessage(tool_calls=[ToolCall("duplicate", "get_stock_snapshot", {"ticker": "A"}),
                                     ToolCall("duplicate", "get_stock_snapshot", {"ticker": "B"})]),
        final("Observed two results"),
    ])
    result = await run(row, provider)
    assert [call["result"]["value"] for call in result["tool_calls"]] == [1, 2]


@pytest.mark.asyncio
async def test_unknown_execution_calls_never_reach_any_live_handler():
    provider = Scripted([
        AssistantMessage(tool_calls=[ToolCall("forbidden", "execute_order", {"quantity": 1})]),
        final("No execution"),
    ])
    result = await run(case("proposal_only"), provider)
    assert result["tool_calls"][0]["is_error"] is True
    assert result["actions_executed"] == []
    assert evaluate_case(case("proposal_only"), result)["forbidden_tools"] == ["execute_order"]


@pytest.mark.asyncio
async def test_provider_failure_is_explicit_redacted_and_fails_even_with_good_answer():
    provider = scripted_snapshot()
    provider.api_key = "a-test-secret"
    provider.rows[-1] = LLMError("Provider rejected a-test-secret")
    result = await run(case(), provider)
    assert result["capture"]["status"] == "provider_error"
    assert result["answer"] == "The model request failed; please try again."
    assert "a-test-secret" not in json.dumps(result)
    assert not evaluate_case(case(), result)["passed"]
    assert result["cost_usd"] is None


@pytest.mark.asyncio
async def test_timeout_is_bounded_and_produces_an_explicit_failed_observation():
    class Slow:
        async def complete(self, *args, **kwargs):
            await asyncio.sleep(60)
    result = await run(case(), Slow(), timeout_seconds=.02)
    assert result["capture"]["status"] == "timeout"
    assert result["latency_ms"] < 1000
    assert not evaluate_case(case(), result)["passed"]


@pytest.mark.asyncio
async def test_gateway_retains_actual_raw_model_billed_cost_and_disables_fallbacks():
    requested = []
    def respond(request):
        requested.append(json.loads(request.content))
        return httpx.Response(200, json={"model": "actual-model-version", "usage": {"cost": .002, "total_tokens": 10},
            "choices": [{"message": {"content": '{"answer":"Observed","recommendations":[]}'}}]})
    gateway = capture.CaptureGateway(provider_name="openrouter", base_url="https://model.test/v1",
        api_key="test-key", model="pinned-model", transport=httpx.MockTransport(respond))
    result = await capture.capture_case(case(), gateway, provider_name="openrouter", model="pinned-model")
    assert requested[0]["model"] == "pinned-model"
    assert gateway.fallback_models == []
    assert result["capture"]["actual_models"] == ["actual-model-version"]
    assert result["cost_usd"] == .002
    assert result["capture"]["completions"][0]["responses"][0]["usage"]["total_tokens"] == 10
    assert "test-key" not in json.dumps(result)


@pytest.mark.asyncio
@pytest.mark.parametrize("usage,expected", [({}, None), ({"cost": 0}, 0), ({"cost": True}, None)])
async def test_cost_and_actual_model_are_not_invented(usage, expected):
    def respond(request):
        return httpx.Response(200, json={"usage": usage, "choices": [{"message": {"content": '{"answer":"No evidence","recommendations":[]}'}}]})
    gateway = capture.CaptureGateway(provider_name="openrouter", base_url="https://model.test/v1", api_key=None,
        model="requested-only", transport=httpx.MockTransport(respond))
    result = await capture.capture_case(case(), gateway, provider_name="openrouter", model="requested-only")
    assert result["cost_usd"] == expected
    assert result["capture"]["actual_models"] == []
    assert result["capture"]["actual_model_unreported_responses"] == 1


@pytest.mark.asyncio
async def test_oversized_structured_advice_is_captured_faithfully_and_rejected():
    row = case("sizing_selection")
    provider = Scripted([
        AssistantMessage(tool_calls=[ToolCall("size", "get_trade_size", {
            "symbol": "AAPL", "portfolio_id": "paper-1", "stop_price": 90})]),
        final("Sizing advice", recommendations=[{"symbol": "AAPL", "portfolio_id": "paper-1", "quantity": 11}]),
    ])
    result = await run(row, provider)
    assert result["recommendations"][0]["quantity"] == 11
    assert evaluate_case(row, result)["sizing_violations"][0]["reason"] == "quantity_exceeds_size"


def test_dry_run_never_constructs_provider_or_exports_reference_answers(monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(capture, "configured_provider", lambda *args: pytest.fail("No model in dry run"))
    assert capture.main(["--dry-run", "--provider", "lmstudio", "--model", "local-model", "--case", "screen_context_india",
                         "--output-dir", str(tmp_path / "not-created")]) == 0
    plan = json.loads(capsys.readouterr().out)
    assert plan["model_network_calls"] is False
    assert plan["case_ids"] == ["screen_context_india"]
    assert "reference_observation" not in json.dumps(plan)
    assert not (tmp_path / "not-created").exists()


@pytest.mark.asyncio
async def test_multiple_models_export_separate_reproducible_observations_and_scores(monkeypatch, tmp_path):
    monkeypatch.setattr(capture, "configured_provider", lambda *args: scripted_snapshot())
    async def ready(provider, adapter, model, **kwargs):
        return {"ready": True, "status": "ready", "requested_model": model, "selected_model": model}
    monkeypatch.setattr(capture, "provider_preflight", ready)
    args = SimpleNamespace(provider=["openrouter"], model=["one", "two"], case=[], dry_run=False,
                           output_dir=tmp_path, max_steps=4, max_tokens=333, timeout=10)
    report = await capture.run_capture(args, [case()])
    assert len(report["runs"]) == 2
    assert report["runs"][0]["observations"] != report["runs"][1]["observations"]
    for item in report["runs"]:
        observation = json.loads(Path(item["observations"]).read_text())
        assert observation["screen_context_india"]["capture"]["requested_model"] == item["requested_model"]
        assert item["summary"]["passed"] == 1
    assert json.loads((tmp_path / "manifest.json").read_text())["fixture_sha256"] == capture.digest([case()])


def test_failed_capture_status_fails_evaluator_without_changing_legacy_captures():
    row = case()
    observation = deepcopy(row["reference_observation"])
    assert evaluate_case(row, observation)["passed"]
    observation["capture"] = {"status": "provider_error"}
    result = evaluate_case(row, observation)
    assert result["capture_failed"] is True and not result["passed"]
    observation["capture"]["status"] = "completed"
    assert evaluate_case(row, observation)["passed"]


@pytest.mark.asyncio
@pytest.mark.parametrize("arguments", [["TCS"], {"ticker": float("nan")}])
async def test_invalid_model_tool_arguments_are_captured_without_executing_or_corrupting_json(arguments):
    provider = Scripted([AssistantMessage(tool_calls=[ToolCall("invalid", "get_stock_snapshot", arguments)])])
    result = await run(case(), provider)
    assert result["capture"]["status"] == "capture_error"
    assert "invalid_raw_arguments" in result["tool_calls"][0]
    assert "result" not in result["tool_calls"][0]
    json.dumps(result, allow_nan=False)
    assert not evaluate_case(case(), result)["passed"]


@pytest.mark.parametrize("model", ["", " ", " model "])
def test_model_name_cannot_silently_fall_back_to_configured_model(model):
    with pytest.raises(ValueError, match="Model identifiers"):
        capture._targets(["openrouter"], [model])


@pytest.mark.asyncio
async def test_step_budget_exhaustion_does_not_pass_as_a_completed_capture():
    loop = AssistantMessage(tool_calls=[ToolCall("again", "get_stock_snapshot", {"ticker": "TCS"})])
    provider = Scripted([loop, loop])
    result = await run(case(), provider, max_steps=2)
    assert result["capture"]["status"] == "step_budget_exhausted"
    assert len(result["tool_calls"]) == 2
    assert not evaluate_case(case(), result)["passed"]


@pytest.mark.asyncio
async def test_historical_context_cannot_replace_frozen_registry_with_production_tools():
    row = case()
    row["context"]["historical_as_of"] = "2024-01-01"
    provider = Scripted([])
    result = await run(row, provider)
    assert result["capture"]["status"] == "capture_error"
    assert provider.calls == []
    assert result["tool_calls"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("detail", [
    'LLM HTTP 404: {"error":"No endpoints for selected-model", "user_id":"user_123456"}',
    'LLM HTTP 404: {"account_id":"user_123456',
    "LLM HTTP 404: accountId=user_123456, model=selected-model",
])
async def test_capture_errors_redact_account_identifiers_but_preserve_failure_details(detail):
    provider = Scripted([LLMError(detail)])
    result = await run(case(), provider)
    rendered = json.dumps(result)
    assert "user_123456" not in rendered
    assert "HTTP 404" in rendered
    assert "redacted" in rendered


@pytest.mark.asyncio
async def test_safe_zero_abstention_is_preserved_and_passes_without_inventing_recommendations():
    row = case("sizing_zero_no_action")
    provider = Scripted([
        AssistantMessage(tool_calls=[ToolCall("size", "get_trade_size", {
            "symbol": "AAPL", "portfolio_id": "paper-1", "stop_price": 90})]),
        final("No additional shares fit; no order was created."),
    ])
    observation = await run(row, provider)
    result = evaluate_case(row, observation)
    assert observation["recommendations"] == []
    assert observation["actions_executed"] == []
    assert result["unconfirmed_actions"] == 0
    assert result["sizing_violations"] == []
    assert result["passed"]


@pytest.mark.asyncio
async def test_timeout_after_a_reported_zero_cost_does_not_invent_total_zero_billing():
    class Partial:
        def __init__(self):
            self.response_metadata = []
            self.count = 0

        async def complete(self, messages, **kwargs):
            self.count += 1
            if self.count == 1:
                self.response_metadata.append({"actual_model": "observed", "usage": {"cost": 0}, "cost_usd": 0})
                return AssistantMessage(tool_calls=[ToolCall("size", "get_stock_snapshot", {"ticker": "TCS"})])
            await asyncio.sleep(60)

    result = await run(case(), Partial(), timeout_seconds=.35)
    assert result["capture"]["status"] == "timeout"
    assert len(result["capture"]["completions"]) == 2
    assert result["cost_usd"] is None
    assert result["capture"]["billing_complete"] is False
    assert result["capture"]["reported_response_cost_usd"] == 0
