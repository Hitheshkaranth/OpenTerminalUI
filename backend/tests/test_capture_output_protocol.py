"""One auditable format repair may copy a draft, never improve its advice."""

import asyncio
from copy import deepcopy
import json

import pytest

from backend.evaluation import capture
from backend.evaluation.agent import evaluate_case
from backend.services.llm.base import AssistantMessage, ToolCall


def case(name="sizing_zero_no_action"):
    return next(item for item in json.loads(capture.FIXTURES.read_text()) if item["id"] == name)


class Scripted:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []
        self.response_metadata = []

    async def complete(self, messages, **kwargs):
        self.calls.append((deepcopy(messages), kwargs))
        self.response_metadata.append({"actual_model": "recorded-model", "usage": {"cost": .001}, "cost_usd": .001})
        return self.replies.pop(0)


def size_call():
    return AssistantMessage(tool_calls=[ToolCall("size", "get_trade_size", {
        "symbol": "AAPL", "portfolio_id": "paper-1", "stop_price": 90})])


def formatted(answer, recommendations=None):
    return AssistantMessage(content=json.dumps({"answer": answer, "recommendations": recommendations or []}))


async def run(row, provider, **kwargs):
    return await capture.capture_case(row, provider, provider_name="scripted", model="pinned", **kwargs)


@pytest.mark.asyncio
async def test_dedicated_system_has_no_markdown_format_conflict_or_expected_answer_leak():
    row = case()
    row["required_answer_fragments"] = ["SECRET_GRADING_CRITERION"]
    row["reference_observation"]["answer"] = "SECRET_REFERENCE_ANSWER"
    draft = "**No additional shares fit.**\nNo order was created."
    provider = Scripted([size_call(), AssistantMessage(content=draft), formatted(draft)])
    observation = await run(row, provider)
    assert len(provider.calls) == 3
    initial_system = provider.calls[0][0][0].content
    assert "one-line verdict" not in initial_system and "2–5 tight bullets" not in initial_system
    assert "JSON object" in initial_system
    assert provider.calls[-1][1]["tools"] is None
    rendered = str(provider.calls)
    assert "SECRET_GRADING" not in rendered and "SECRET_REFERENCE" not in rendered
    repair = observation["capture"]["output_repair"]
    assert repair["attempted"] and repair["original_answer"] == draft
    assert repair["protocol_status"] == "json"
    assert observation["answer"] == draft and observation["recommendations"] == []
    assert observation["raw_answer"] == repair["repaired_answer"]
    assert observation["capture"]["status"] == "completed"
    assert observation["cost_usd"] == pytest.approx(.003)
    assert observation["capture"]["actual_models"] == ["recorded-model"]


@pytest.mark.asyncio
async def test_safe_zero_markdown_repair_passes_without_inventing_a_zero_row():
    draft = "No additional shares fit; no order was created."
    provider = Scripted([size_call(), AssistantMessage(content=draft), formatted(draft)])
    observation = await run(case(), provider)
    assert observation["recommendations"] == []
    assert evaluate_case(case(), observation)["passed"]


@pytest.mark.asyncio
async def test_json_missing_recommendations_gets_one_actual_model_format_call():
    provider = Scripted([size_call(), AssistantMessage(content='{"answer":"No additional shares fit; no order was created."}'),
                         formatted("No additional shares fit; no order was created.")])
    observation = await run(case(), provider)
    assert len(provider.calls) == 3
    assert observation["capture"]["output_repair"]["original_protocol"] == "missing_recommendations"
    assert observation["capture"]["status"] == "completed"


@pytest.mark.asyncio
async def test_already_valid_json_abstention_and_positive_advice_do_not_repair():
    for name, text, rows in [("sizing_zero_no_action", "No additional shares fit; no order was created.", []),
                              ("sizing_selection", "Buy 10 shares.", [{"symbol": "AAPL", "portfolio_id": "paper-1", "quantity": 10}])]:
        provider = Scripted([size_call(), formatted(text, rows)])
        observation = await run(case(name), provider)
        assert len(provider.calls) == 2
        assert observation["capture"]["output_repair"]["attempted"] is False
        assert observation["recommendations"] == rows


@pytest.mark.asyncio
@pytest.mark.parametrize("repaired", [
    formatted("No additional shares fit; no order was created."),
    formatted("Buy 11 shares.", []),
    formatted("Buy 11 shares.", [{"symbol": "AAPL", "portfolio_id": "paper-1", "quantity": 10}]),
])
async def test_repair_cannot_remove_or_reduce_unsafe_original_advice(repaired):
    provider = Scripted([size_call(), AssistantMessage(content="Buy 11 shares."), repaired])
    observation = await run(case("sizing_selection"), provider)
    assert observation["capture"]["status"] == "invalid_output_schema"
    assert observation["capture"]["output_repair"]["original_answer"] == "Buy 11 shares."
    assert not evaluate_case(case("sizing_selection"), observation)["passed"]


@pytest.mark.asyncio
async def test_faithful_unsafe_advice_still_fails_sizing_instead_of_getting_fixed():
    rows = [{"symbol": "AAPL", "portfolio_id": "paper-1", "quantity": 11}]
    provider = Scripted([size_call(), AssistantMessage(content="Buy 11 shares."), formatted("Buy 11 shares.", rows)])
    observation = await run(case("sizing_selection"), provider)
    assert observation["capture"]["status"] == "completed"
    assert evaluate_case(case("sizing_selection"), observation)["sizing_violations"]


@pytest.mark.asyncio
async def test_a_second_invalid_response_is_not_repaired_again():
    provider = Scripted([size_call(), AssistantMessage(content="No additional shares fit."), AssistantMessage(content="Still Markdown")])
    observation = await run(case(), provider)
    assert len(provider.calls) == 3 and not provider.replies
    assert observation["capture"]["status"] == "invalid_output_schema"


@pytest.mark.asyncio
async def test_repair_tool_calls_are_audited_and_never_executed():
    attempt = AssistantMessage(content='{"answer":"No additional shares fit.","recommendations":[]}',
        tool_calls=[ToolCall("forbidden", "execute_order", {"quantity": 1})])
    provider = Scripted([size_call(), AssistantMessage(content="No additional shares fit."), attempt])
    observation = await run(case(), provider)
    assert len(observation["tool_calls"]) == 1 and observation["actions_executed"] == []
    assert observation["capture"]["output_repair"]["rejected_tool_calls"][0]["function"]["name"] == "execute_order"
    assert observation["capture"]["status"] == "invalid_output_schema"


@pytest.mark.asyncio
async def test_repair_timeout_preserves_original_and_unknown_total_billing():
    class SlowRepair(Scripted):
        async def complete(self, messages, **kwargs):
            if len(self.calls) == 2:
                self.calls.append((messages, kwargs))
                await asyncio.sleep(60)
            return await super().complete(messages, **kwargs)

    provider = SlowRepair([size_call(), AssistantMessage(content="No additional shares fit.")])
    observation = await run(case(), provider, timeout_seconds=.8)
    assert observation["capture"]["status"] == "timeout"
    assert observation["capture"]["output_repair"]["original_answer"] == "No additional shares fit."
    assert observation["capture"]["output_repair"]["attempted"] is True
    assert observation["cost_usd"] is None


def test_current_digest_covers_actual_system_prompt_and_repair_mechanics(monkeypatch):
    original = capture.protocol_digest()
    assert capture.CAPTURE_PROTOCOL_VERSION == "frozen_capture_v6"
    monkeypatch.setattr(capture, "CAPTURE_SYSTEM_PROMPT", capture.CAPTURE_SYSTEM_PROMPT + " changed")
    assert capture.protocol_digest() != original
    before = capture.protocol_digest()
    monkeypatch.setattr(capture, "OUTPUT_REPAIR_INSTRUCTIONS", capture.OUTPUT_REPAIR_INSTRUCTIONS + " changed")
    assert capture.protocol_digest() != before
    assert capture.protocol_digest(output_repair=False) != capture.protocol_digest()


@pytest.mark.asyncio
@pytest.mark.parametrize("symbol,book,expected", [("AAPL", "paper-1", "completed"),
                                               ("MSFT", "paper-1", "invalid_output_schema"),
                                               ("AAPL", "another-book", "invalid_output_schema")])
async def test_suggested_quantity_repair_cannot_change_explicit_symbol_or_portfolio(symbol, book, expected):
    original = json.dumps({"answer": "Buy 10 shares.", "suggested_quantity": 10,
                           "symbol": "AAPL", "portfolio_id": "paper-1"})
    repaired = formatted("Buy 10 shares.", [{"symbol": symbol, "portfolio_id": book, "quantity": 10}])
    provider = Scripted([size_call(), AssistantMessage(content=original), repaired])
    observation = await run(case("sizing_selection"), provider)
    assert observation["capture"]["status"] == expected
    if expected != "completed":
        assert observation["capture"]["output_repair"]["protocol_status"] == "identity_changed"


@pytest.mark.asyncio
@pytest.mark.parametrize("draft,rows", [
    ("Buy -10 AAPL shares in portfolio paper-1.", [{"symbol": "AAPL", "portfolio_id": "paper-1", "quantity": 10}]),
    ("Buy -10 shares.", []),
])
async def test_negative_draft_quantity_cannot_be_promoted_or_silently_removed(draft, rows):
    provider = Scripted([size_call(), AssistantMessage(content=draft), formatted(draft, rows)])
    observation = await run(case("sizing_selection"), provider)
    assert observation["capture"]["status"] == "invalid_output_schema"
    assert observation["capture"]["output_repair"]["protocol_status"] in {"quantity_changed", "identity_changed"}
    assert observation["capture"]["output_repair"]["original_answer"] == draft
    assert not evaluate_case(case("sizing_selection"), observation)["passed"]
