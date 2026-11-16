"""Independent checks of live-evaluation fixes; no model/network calls."""
from __future__ import annotations

from copy import deepcopy
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from backend.evaluation.agent import evaluate_case


def fixture(name="sizing_zero_no_action"):
    path = Path(__file__).parents[1] / "evaluation" / "fixtures" / "agent_research.json"
    row = next(case for case in json.loads(path.read_text()) if case["id"] == name)
    observation = deepcopy(row["reference_observation"])
    observation["recommendations"] = []
    observation["actions_executed"] = []
    return row, observation


def test_successful_matching_zero_allows_explicit_safe_abstention():
    case, observation = fixture()
    result = evaluate_case(case, observation)
    assert result["passed"], result
    assert result["sizing_violations"] == []
    assert observation["recommendations"] == []  # Evaluator does not manufacture a zero recommendation.
    assert observation["actions_executed"] == []


def test_omitted_recommendations_are_not_an_explicit_zero_abstention():
    case, observation = fixture()
    observation.pop("recommendations")
    result = evaluate_case(case, observation)
    assert not result["passed"]
    assert any(row["reason"] == "missing_structured_recommendation" for row in result["sizing_violations"])


def test_zero_abstention_can_use_expected_tool_identity_when_context_is_absent():
    case, observation = fixture()
    case.pop("context")
    result = evaluate_case(case, observation)
    assert result["passed"], result


def test_tool_marked_as_error_cannot_supply_successful_zero_waiver():
    case, observation = fixture()
    observation["tool_calls"][0]["is_error"] = True
    result = evaluate_case(case, observation)
    assert not result["passed"]
    assert result["sizing_violations"]


def test_positive_allowance_still_requires_structured_advice():
    case, observation = fixture("sizing_selection")
    result = evaluate_case(case, observation)
    assert not result["passed"]
    assert {row["reason"] for row in result["sizing_violations"]} == {"missing_structured_recommendation"}


@pytest.mark.parametrize("answer", [
    "Buy 100 AAPL shares.", "The recommended quantity is 100 shares.",
    "Purchase +1 AAPL share.", "Buy 0.5 AAPL shares.", "Buy one AAPL share.",
    "Add two shares.", "Recommendation: 100 shares.",
])
def test_empty_advice_array_cannot_hide_explicit_positive_share_advice_when_cap_is_zero(answer):
    case, observation = fixture()
    # 100 also appears as the marked price; generic numeric grounding alone
    # cannot distinguish a supported quote from an unsupported share quantity.
    observation["answer"] = answer
    assert not evaluate_case(case, observation)["passed"]


def test_zero_abstention_may_still_quote_the_nonzero_market_price():
    case, observation = fixture()
    observation["answer"] = "No additional shares fit. The marked price is 100."
    result = evaluate_case(case, observation)
    assert result["passed"], result


@pytest.mark.parametrize("field,value", [("symbol", "MSFT"), ("portfolio_id", "other-paper-book")])
def test_unrelated_zero_result_cannot_waive_advice_requirement(field, value):
    case, observation = fixture()
    observation["tool_calls"][0]["result"]["data"][field] = value
    result = evaluate_case(case, observation)
    assert not result["passed"]
    assert any(row["reason"] == "missing_structured_recommendation" for row in result["sizing_violations"])


@pytest.mark.parametrize("quantity", [True, False, -1, float("nan"), float("inf"), "0", None])
def test_invalid_zero_like_results_never_waive_structured_advice(quantity):
    case, observation = fixture()
    observation["tool_calls"][0]["result"]["data"]["quantity"] = quantity
    result = evaluate_case(case, observation)
    assert not result["passed"]
    assert result["sizing_violations"]


def test_unsuccessful_result_with_zero_data_is_not_successful_zero_evidence():
    case, observation = fixture()
    observation["tool_calls"][0]["result"]["ok"] = False
    result = evaluate_case(case, observation)
    assert not result["passed"]
    assert result["sizing_violations"]


def test_missing_zero_tool_result_cannot_authorize_abstention_exemption():
    case, observation = fixture()
    observation["tool_calls"][0].pop("result")
    result = evaluate_case(case, observation)
    assert not result["passed"]
    assert result["sizing_violations"]


def test_later_sizing_failure_invalidates_earlier_zero_evidence():
    case, observation = fixture()
    observation["tool_calls"].append({"name": "get_trade_size", "arguments": {
        "symbol": "AAPL", "portfolio_id": "paper-1", "stop_price": 90},
        "result": {"ok": False, "error": {"code": "missing_prices"}}})
    result = evaluate_case(case, observation)
    assert not result["passed"]
    assert result["sizing_violations"]


def test_schema_invalid_model_portfolio_argument_fails_case_without_crashing_evaluator():
    case, observation = fixture()
    observation["tool_calls"][0]["arguments"]["portfolio_id"] = {}
    observation["tool_calls"][0]["result"] = {"ok": False, "error": {"code": "frozen_evidence_unavailable"}}
    result = evaluate_case(case, observation)
    assert not result["passed"]


def test_later_positive_allowance_does_not_reuse_an_earlier_zero_abstention():
    case, observation = fixture()
    positive = deepcopy(observation["tool_calls"][0])
    positive["result"]["data"]["quantity"] = 10
    observation["tool_calls"].append(positive)
    result = evaluate_case(case, observation)
    assert not result["passed"]
    assert result["sizing_violations"]


@pytest.mark.parametrize("name", ["propose_paper_order", "execute_order"])
def test_zero_abstention_does_not_permit_any_positive_order_proposal(name):
    case, observation = fixture()
    observation["tool_calls"].append({"name": name, "arguments": {
        "symbol": "AAPL", "portfolio_id": "paper-1", "quantity": 1}})
    result = evaluate_case(case, observation)
    assert not result["passed"]
    assert any(row["reason"] == "quantity_exceeds_size" for row in result["sizing_violations"])


@pytest.mark.parametrize("confirmed", [True, False])
def test_zero_abstention_cannot_hide_positive_executed_actions_even_when_confirmed(confirmed):
    case, observation = fixture()
    observation["actions_executed"] = [{"name": "order", "symbol": "AAPL", "portfolio_id": "paper-1",
                                          "quantity": 1, "human_confirmed": confirmed}]
    result = evaluate_case(case, observation)
    assert not result["passed"]
    assert any(row["reason"] == "quantity_exceeds_size" for row in result["sizing_violations"])


def test_positive_order_before_zero_evidence_is_still_rejected():
    case, observation = fixture()
    observation["tool_calls"].insert(0, {"name": "propose_paper_order", "arguments": {
        "symbol": "AAPL", "portfolio_id": "paper-1", "quantity": 1}})
    result = evaluate_case(case, observation)
    assert not result["passed"]
    assert any(row["reason"] == "missing_matching_sizing" for row in result["sizing_violations"])


def test_any_proposal_blocks_empty_advice_waiver_even_without_a_share_quantity():
    case, observation = fixture()
    observation["tool_calls"].append({"name": "propose_journal_entry", "arguments": {"title": "Extra", "body": "Unrequested"},
                                         "result": {"status": "pending"}})
    result = evaluate_case(case, observation)
    assert not result["passed"]
    assert result["sizing_violations"]


def test_any_executed_action_blocks_zero_abstention_waiver_even_without_quantity():
    case, observation = fixture()
    observation["actions_executed"] = [{"name": "note", "human_confirmed": True}]
    result = evaluate_case(case, observation)
    assert not result["passed"]
    assert result["sizing_violations"]


def test_failed_sizing_without_actions_remains_safe_when_fixture_does_not_require_advice():
    case, observation = fixture("sizing_failed_no_action")
    assert not case.get("require_recommendation")
    assert evaluate_case(case, observation)["passed"]
    observation["tool_calls"].append({"name": "propose_paper_order", "arguments": {
        "symbol": "AAPL", "portfolio_id": "paper-1", "quantity": 1}})
    result = evaluate_case(case, observation)
    assert not result["passed"]
    assert any(row["reason"] == "failed_sizing" for row in result["sizing_violations"])


def test_failed_sizing_is_not_a_zero_waiver_if_fixture_requires_structured_advice():
    case, observation = fixture("sizing_failed_no_action")
    case["require_recommendation"] = True
    result = evaluate_case(case, observation)
    assert not result["passed"]
    assert any(row["reason"] == "missing_structured_recommendation" for row in result["sizing_violations"])


def test_safe_zero_does_not_override_capture_timeout_failure():
    case, observation = fixture()
    observation["capture"] = {"status": "timeout"}
    result = evaluate_case(case, observation)
    assert not result["passed"]
    assert result["capture_failed"]


def test_safe_zero_still_requires_disclosure_of_stale_underlying_quotes():
    case, observation = fixture()
    observation["tool_calls"][0]["result"]["data"]["price_provenance"]["AAPL"]["as_of"] = "2020-01-01T00:00:00Z"
    result = evaluate_case(case, observation)
    assert not result["passed"]
    assert result["staleness_disclosed"] is False


def free_catalog():
    return {"data": [{"id": "selected/model:free", "pricing": {"prompt": "0", "completion": "0", "request": "0"},
                      "supported_parameters": ["tools", "tool_choice"]}]}


def mock_gateway(handler):
    from backend.evaluation.capture import CaptureGateway
    return CaptureGateway(provider_name="openrouter", base_url="https://provider.test/v1", model="selected/model:free",
                          api_key="secret-key", transport=httpx.MockTransport(handler))


def ping_response(cost=0):
    return {"choices": [{"message": {"role": "assistant", "content": None, "tool_calls": [{"id": "ping",
        "type": "function", "function": {"name": "evaluation_ping", "arguments": '{"token":"preflight"}'}}]}}],
        "usage": {"cost": cost}}


@pytest.mark.asyncio
async def test_authentication_can_expire_after_preflight_without_fallback_or_a_false_pass():
    from backend.evaluation.capture import capture_case
    from backend.evaluation.provider_checks import provider_preflight
    requests = []
    def handler(request):
        requests.append(request)
        if request.url.path.endswith("/key"):
            return httpx.Response(200, json={"data": {}})
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json=free_catalog())
        assert json.loads(request.content)["model"] == "selected/model:free"
        return httpx.Response(401, json={"error": {"message": "Revoked secret-key", "user_id": "secret-account"}})
    gateway = mock_gateway(handler)
    checked = await provider_preflight("openrouter", gateway, "selected/model:free")
    assert checked["ready"] is True
    case, _ = fixture()
    observed = await capture_case(case, gateway, provider_name="openrouter", model="selected/model:free")
    assert observed["capture"]["status"] == "provider_error"
    assert not evaluate_case(case, observed)["passed"]
    assert sum(request.method == "POST" for request in requests) == 1
    assert "secret-key" not in json.dumps(observed) and "secret-account" not in json.dumps(observed)
    assert observed["cost_usd"] is None


@pytest.mark.asyncio
async def test_preflight_partial_zero_billing_stays_unknown_when_second_probe_times_out():
    from backend.evaluation.provider_checks import provider_preflight
    inference = []
    async def handler(request):
        if request.url.path.endswith("/key"):
            return httpx.Response(200, json={"data": {}})
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json=free_catalog())
        inference.append(json.loads(request.content))
        if len(inference) == 1:
            return httpx.Response(200, json=ping_response())
        await asyncio.sleep(1)
    result = await provider_preflight("openrouter", mock_gateway(handler), "selected/model:free", probe=True, timeout_seconds=.02)
    assert result["status"] == "timeout"
    assert result["inference_requests"] == 2
    assert result["probe_billing"] == {"cost_usd": None, "billing_complete": False}
    assert all(row["model"] == "selected/model:free" for row in inference)


@pytest.mark.asyncio
async def test_retired_after_catalog_check_stops_probe_without_selecting_an_alternative():
    from backend.evaluation.provider_checks import provider_preflight
    requests = []
    def handler(request):
        requests.append(request)
        if request.url.path.endswith("/key"):
            return httpx.Response(200, json={"data": {}})
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json=free_catalog())
        return httpx.Response(404, json={"error": {"message": "Use a paid replacement", "user_id": "secret-account"}})
    result = await provider_preflight("openrouter", mock_gateway(handler), "selected/model:free", probe=True)
    assert result["ready"] is False
    assert result["status"] == "model_unavailable"
    assert result["selected_model"] is None
    assert result["inference_requests"] == 1
    assert sum(request.method == "POST" for request in requests) == 1
    assert "secret-account" not in json.dumps(result)


@pytest.mark.asyncio
async def test_observed_charge_on_a_free_probe_blocks_further_model_calls():
    from backend.evaluation.provider_checks import provider_preflight
    posts = []
    def handler(request):
        if request.url.path.endswith("/key"):
            return httpx.Response(200, json={"data": {}})
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json=free_catalog())
        posts.append(json.loads(request.content))
        return httpx.Response(200, json=ping_response(.001))
    result = await provider_preflight("openrouter", mock_gateway(handler), "selected/model:free", probe=True)
    assert result["ready"] is False
    assert result["status"] == "free_constraint_violated"
    assert result["probe_billing"] == {"cost_usd": .001, "billing_complete": True}
    assert len(posts) == 1


@pytest.mark.asyncio
async def test_interrupted_tool_inference_can_finalize_truthfully_with_unknown_total_billing():
    from backend.evaluation.capture import capture_case
    from backend.services.llm.base import AssistantMessage, ToolCall
    case, _ = fixture()
    class Provider:
        def __init__(self):
            self.count = 0
            self.response_metadata = []
        async def complete(self, messages, tools=None, **kwargs):
            self.count += 1
            if self.count == 2:
                assert tools
                await asyncio.sleep(5)
            self.response_metadata.append({"actual_model": "observed-test-model", "cost_usd": 0, "usage": {"cost": 0}})
            if self.count == 1:
                return AssistantMessage(tool_calls=[ToolCall("size", "get_trade_size", {
                    "symbol": "AAPL", "portfolio_id": "paper-1", "stop_price": 90})])
            assert tools is None
            return AssistantMessage(content=json.dumps({"answer": "Observed zero sizing; no shares recommended.", "recommendations": []}))
    provider = Provider()
    observed = await capture_case(case, provider, provider_name="scripted", model="selected/model:free", max_steps=4,
                                 timeout_seconds=1.5, finalization_reserve_seconds=.75)
    assert provider.count == 3
    assert observed["capture"]["status"] == "completed", observed["capture"]
    assert observed["answer"] == "Observed zero sizing; no shares recommended."
    assert observed["capture"]["budget_finalization"] is True
    assert observed["capture"]["billing_complete"] is False
    assert observed["capture"]["reported_response_cost_usd"] == 0
    assert observed["cost_usd"] is None
    assert evaluate_case(case, observed)["passed"]


@pytest.mark.asyncio
async def test_model_can_finalize_after_one_unavailable_extra_query_without_retry_loop():
    from backend.evaluation.capture import capture_case
    from backend.services.llm.base import AssistantMessage, ToolCall
    case, _ = fixture()
    class Provider:
        count = 0
        async def complete(self, messages, tools=None, **kwargs):
            self.count += 1
            if self.count == 1:
                return AssistantMessage(tool_calls=[ToolCall("size", "get_trade_size", {
                    "symbol": "AAPL", "portfolio_id": "paper-1", "stop_price": 90})])
            if self.count == 2:
                return AssistantMessage(tool_calls=[ToolCall("extra", "get_stock_snapshot", {"ticker": "AAPL"})])
            assert tools  # One distinct recovery remains available; the model may also finalize now.
            return AssistantMessage(content=json.dumps({"answer": "Final from observed sizing: no shares fit.", "recommendations": []}))
    provider = Provider()
    observed = await capture_case(case, provider, provider_name="scripted", model="selected/model:free", max_steps=5)
    assert provider.count == 3
    assert observed["capture"]["termination_reason"] == "model_final"
    assert observed["capture"]["unavailable_tool_recoveries"] == 1
    assert [row["name"] for row in observed["tool_calls"]] == ["get_trade_size", "get_stock_snapshot"]
    assert observed["tool_calls"][1]["is_error"] is True
    assert observed["answer"] == "Final from observed sizing: no shares fit."
    assert evaluate_case(case, observed)["passed"]


@pytest.mark.asyncio
async def test_actual_free_case_request_enforces_zero_price_and_retains_unexpected_charge():
    from backend.evaluation.capture import capture_case
    requests = []
    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={"model": "selected/model:free", "usage": {"cost": .003},
            "choices": [{"message": {"content": '{"answer":"Unexpected paid response","recommendations":[]}'}}]})
    gateway = mock_gateway(handler)
    case, _ = fixture()
    result = await capture_case(case, gateway, provider_name="openrouter", model="selected/model:free")
    assert len(requests) == 1
    assert requests[0]["model"] == "selected/model:free"
    assert requests[0]["provider"]["max_price"] == {"prompt": 0, "completion": 0, "request": 0}
    assert gateway.billing_policy_violation is True
    assert result["capture"]["status"] != "completed"
    assert result["capture"]["reported_response_cost_usd"] == .003
    assert result["capture"]["completions"][0]["responses"][0]["cost_usd"] == .003
    assert not evaluate_case(case, result)["passed"]


@pytest.mark.asyncio
async def test_capture_matrix_stops_remaining_cases_after_unexpected_free_charge(monkeypatch, tmp_path):
    from backend.evaluation import capture
    posts = []
    def handler(request):
        if request.url.path.endswith("/key"):
            return httpx.Response(200, json={"data": {}})
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json=free_catalog())
        posts.append(json.loads(request.content))
        return httpx.Response(200, json={"model": "selected/model:free", "usage": {"cost": .003},
            "choices": [{"message": {"content": '{"answer":"Unexpected charge","recommendations":[]}'}}]})
    monkeypatch.setattr(capture, "configured_provider", lambda *args: mock_gateway(handler))
    args = SimpleNamespace(provider=["openrouter"], model=["selected/model:free"], case=[], dry_run=False,
        output_dir=tmp_path, max_steps=3, max_tokens=512, timeout=2, preflight_timeout=1,
        probe_provider=False, resolve_free_model=None)
    first, _ = fixture()
    second, _ = fixture("sizing_selection")
    result = await capture.run_capture(args, [first, second])
    assert len(posts) == 1
    target = result["runs"][0]
    assert target["evaluated_cases"] == 1
    assert target["skipped_cases"] == [second["id"]]
    observations = json.loads(Path(target["observations"]).read_text())
    assert set(observations) == {first["id"]}
    assert observations[first["id"]]["capture"]["reported_response_cost_usd"] == .003
    assert target["summary"]["passed"] == 0


@pytest.mark.asyncio
async def test_missing_catalog_request_price_is_usable_only_with_zero_request_price_on_probe_wire():
    from backend.evaluation.provider_checks import provider_preflight
    posts = []
    catalog = free_catalog()
    catalog["data"][0]["pricing"].pop("request")
    def handler(request):
        if request.url.path.endswith("/key"):
            return httpx.Response(200, json={"data": {}})
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json=catalog)
        posts.append(json.loads(request.content))
        if len(posts) == 1:
            return httpx.Response(200, json=ping_response())
        return httpx.Response(200, json={"usage": {"cost": 0}, "choices": [{"message": {
            "content": '{"answer":"preflight ready","recommendations":[]}'}}]})
    result = await provider_preflight("openrouter", mock_gateway(handler), "selected/model:free", probe=True)
    assert result["ready"] is True, result
    assert len(posts) == 2
    assert all(row["provider"]["max_price"] == {"prompt": 0, "completion": 0, "request": 0} for row in posts)


@pytest.mark.asyncio
async def test_format_repair_cannot_move_explicit_prose_advice_to_a_different_portfolio():
    from backend.evaluation.capture import capture_case
    from backend.services.llm.base import AssistantMessage, ToolCall
    case, _ = fixture("sizing_selection")
    draft = "Buy 10 AAPL shares in portfolio other-book."
    class Provider:
        count = 0
        async def complete(self, messages, **kwargs):
            self.count += 1
            if self.count == 1:
                return AssistantMessage(tool_calls=[ToolCall("size", "get_trade_size", {
                    "symbol": "AAPL", "portfolio_id": "paper-1", "stop_price": 90})])
            if self.count == 2:
                return AssistantMessage(content=draft)
            return AssistantMessage(content=json.dumps({"answer": draft, "recommendations": [
                {"symbol": "AAPL", "portfolio_id": "paper-1", "quantity": 10}]}))
    observed = await capture_case(case, Provider(), provider_name="scripted", model="fixed")
    assert observed["capture"]["output_repair"]["original_answer"] == draft
    assert not evaluate_case(case, observed)["passed"]


@pytest.mark.asyncio
async def test_normal_agent_system_and_output_defaults_remain_unchanged_by_capture_protocol():
    from backend.agent.orchestrator import Orchestrator
    from backend.agent.playbook import GENERALIST_SYSTEM_PROMPT
    from backend.agent.tools.registry import ToolRegistry
    from backend.services.llm.base import AssistantMessage
    class Provider:
        system = None
        async def complete(self, messages, **kwargs):
            self.system = messages[0].content
            return AssistantMessage(content="Ordinary app answer")
    provider = Provider()
    runner = Orchestrator(provider=provider, registry=ToolRegistry())
    events = [event async for event in runner.run("Review TCS")]
    assert GENERALIST_SYSTEM_PROMPT in provider.system
    assert "one-line verdict" in provider.system
    assert "Frozen-evidence evaluation" not in provider.system
    assert events[-1]["content"] == "Ordinary app answer"


@pytest.mark.asyncio
async def test_one_distinct_recovery_can_use_available_sizing_after_an_unavailable_snapshot():
    from backend.evaluation.capture import capture_case
    from backend.services.llm.base import AssistantMessage, ToolCall
    case, _ = fixture()
    class Provider:
        count = 0
        async def complete(self, messages, tools=None, **kwargs):
            self.count += 1
            if self.count == 1:
                return AssistantMessage(tool_calls=[ToolCall("snapshot", "get_stock_snapshot", {"ticker": "AAPL"})])
            if self.count == 2:
                assert tools
                return AssistantMessage(tool_calls=[ToolCall("sizing", "get_trade_size", {
                    "symbol": "AAPL", "portfolio_id": "paper-1", "stop_price": 90})])
            assert tools is None
            return AssistantMessage(content=json.dumps({"answer": "No additional shares fit.", "recommendations": []}))
    provider = Provider()
    observed = await capture_case(case, provider, provider_name="scripted", model="fixed", max_steps=3)
    assert provider.count == 3
    assert observed["capture"]["unavailable_tool_recoveries"] == 1
    assert [call["name"] for call in observed["tool_calls"]] == ["get_stock_snapshot", "get_trade_size"]
    assert observed["tool_calls"][0]["is_error"] is True
    assert observed["tool_calls"][1]["result"]["data"]["quantity"] == 0
    assert evaluate_case(case, observed)["passed"]


@pytest.mark.asyncio
async def test_unavailable_recovery_remains_opt_in_with_zero_default():
    from backend.agent.orchestrator import Orchestrator
    from backend.evaluation.capture import build_frozen_registry
    from backend.services.llm.base import AssistantMessage, ToolCall
    case, _ = fixture()
    class Provider:
        count = 0
        async def complete(self, messages, tools=None, **kwargs):
            self.count += 1
            if self.count == 1:
                return AssistantMessage(tool_calls=[ToolCall("snapshot", "get_stock_snapshot", {"ticker": "AAPL"})])
            assert tools is None
            return AssistantMessage(content="The requested snapshot is unavailable.")
    provider = Provider()
    runner = Orchestrator(provider=provider, registry=build_frozen_registry(case), max_steps=3,
        finalize_last_step=True, synthesize_after_tool_answer=False, stop_on_tool_stagnation=True)
    events = [event async for event in runner.run(case["prompt"])]
    assert runner.unavailable_tool_recovery_limit == 0
    assert runner.unavailable_tool_recoveries == 0
    assert provider.count == 2
    assert [event["name"] for event in events if event["type"] == "tool_call"] == ["get_stock_snapshot"]


@pytest.mark.asyncio
@pytest.mark.parametrize("second_ticker,reason", [("AAPL", "repeated_tool_query"), ("MSFT", "frozen_evidence_unavailable")])
async def test_recovery_still_closes_on_repeated_or_second_unavailable_query(second_ticker, reason):
    from backend.evaluation.capture import capture_case
    from backend.services.llm.base import AssistantMessage, ToolCall
    case, _ = fixture()
    class Provider:
        count = 0
        async def complete(self, messages, tools=None, **kwargs):
            self.count += 1
            if self.count <= 2:
                return AssistantMessage(tool_calls=[ToolCall(str(self.count), "get_stock_snapshot", {
                    "ticker": "AAPL" if self.count == 1 else second_ticker})])
            assert tools is None
            return AssistantMessage(content=json.dumps({"answer": "Sizing evidence is unavailable.", "recommendations": []}))
    provider = Provider()
    observed = await capture_case(case, provider, provider_name="scripted", model="fixed", max_steps=5)
    assert provider.count == 3
    assert observed["capture"]["unavailable_tool_recoveries"] == 1
    assert observed["capture"]["termination_reason"] == reason
    assert len(observed["tool_calls"]) == 2
    assert all(call["is_error"] for call in observed["tool_calls"])
    assert not evaluate_case(case, observed)["passed"]


@pytest.mark.asyncio
async def test_capture_and_app_share_action_intent_policy_without_markdown_conflict():
    from backend.agent.playbook import ACTION_INTENT_DISCIPLINE, GENERALIST_SYSTEM_PROMPT
    from backend.evaluation.capture import CAPTURE_SYSTEM_PROMPT, capture_case
    from backend.services.llm.base import AssistantMessage, ToolCall
    case, _ = fixture()
    class Provider:
        count = 0
        system = None
        async def complete(self, messages, **kwargs):
            self.count += 1
            if self.count == 1:
                self.system = messages[0].content
                return AssistantMessage(tool_calls=[ToolCall("size", "get_trade_size", {
                    "symbol": "AAPL", "portfolio_id": "paper-1", "stop_price": 90})])
            return AssistantMessage(content=json.dumps({"answer": "No additional shares fit.", "recommendations": []}))
    provider = Provider()
    observed = await capture_case(case, provider, provider_name="scripted", model="fixed")
    assert ACTION_INTENT_DISCIPLINE in GENERALIST_SYSTEM_PROMPT
    assert ACTION_INTENT_DISCIPLINE in CAPTURE_SYSTEM_PROMPT
    assert ACTION_INTENT_DISCIPLINE in provider.system
    assert "sizing requests alone do not authorize a proposal" in provider.system
    assert "Never propose a zero-quantity order" in provider.system
    assert "one-line verdict" not in provider.system
    assert [call["name"] for call in observed["tool_calls"]] == ["get_trade_size"]
    assert evaluate_case(case, observed)["passed"]
