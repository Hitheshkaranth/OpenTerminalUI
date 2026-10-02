import pytest
from backend.agent.orchestrator import Orchestrator
from backend.agent.tools.registry import ToolRegistry, ToolSpec
from backend.services.llm.base import AssistantMessage, ToolCall


class ScriptedProvider:
    """Returns a queued list of AssistantMessages, one per complete() call."""
    def __init__(self, scripted):
        self._scripted = list(scripted)
        self.calls = 0
        self.model_chains = []
        self.message_batches = []

    async def complete(self, messages, tools=None, *, temperature=0.1, max_tokens=1024, models=None, on_status=None):
        self.message_batches.append(messages)
        self.model_chains.append(models)
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
        AssistantMessage(content="Top idea: AAPL", tool_calls=[]),
    ])
    orch = Orchestrator(provider=provider, registry=_registry(), max_steps=5)
    events = [e async for e in orch.run("find cheap stocks")]
    kinds = [e["type"] for e in events]
    assert "tool_call" in kinds
    assert "tool_result" in kinds
    assert "model" in kinds
    assert provider.model_chains[0]
    assert provider.model_chains[-1]
    assert kinds[-1] == "final"
    assert events[-1]["content"] == "Top idea: AAPL"


@pytest.mark.asyncio
async def test_screening_prompt_gets_screen_stocks_directive():
    provider = ScriptedProvider([
        AssistantMessage(content=None, tool_calls=[
            ToolCall(id="c1", name="screen_stocks", arguments={"query": "roe > 15 and pe < 20", "market": "US", "universe": "sp_500"})]),
        AssistantMessage(content="AAPL fits the screen", tool_calls=[]),
        AssistantMessage(content="AAPL fits the screen", tool_calls=[]),
    ])
    orch = Orchestrator(provider=provider, registry=_registry(), max_steps=5)
    events = [e async for e in orch.run("find stocks with ROE > 15 and PE < 20", screen_context={"market": "US"})]
    tool_calls = [e for e in events if e["type"] == "tool_call"]
    assert tool_calls[0]["name"] == "screen_stocks"
    first_messages = provider.message_batches[0]
    assert any("stock screening/filtering task" in getattr(message, "content", "") for message in first_messages)
    assert any("market=US and universe=sp_500" in getattr(message, "content", "") for message in first_messages)


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
        AssistantMessage(content="Sorry, screener failed", tool_calls=[]),
    ])
    orch = Orchestrator(provider=provider, registry=reg, max_steps=5)
    events = [e async for e in orch.run("go")]
    tool_results = [e for e in events if e["type"] == "tool_result"]
    assert tool_results[0]["is_error"] is True
    assert events[-1]["type"] == "final"


@pytest.mark.asyncio
async def test_max_steps_budget_halts():
    loop_msg = AssistantMessage(content=None, tool_calls=[
        ToolCall(id="c", name="screen_stocks", arguments={})])
    provider = ScriptedProvider([loop_msg] * 10)
    orch = Orchestrator(provider=provider, registry=_registry(), max_steps=3)
    events = [e async for e in orch.run("loop forever")]
    assert events[-1]["type"] == "final"
    assert "step budget" in events[-1]["content"].lower()
    assert sum(1 for e in events if e["type"] == "tool_call") == 3


@pytest.mark.asyncio
async def test_synthesis_context_ends_on_tool_results_not_the_draft():
    # Feeding the draft answer back made Ornith reply "I've already answered your question".
    provider = ScriptedProvider([
        AssistantMessage(content=None, tool_calls=[
            ToolCall(id="c1", name="screen_stocks", arguments={"query": "x"})]),
        AssistantMessage(content="Draft: AAPL", tool_calls=[]),
        AssistantMessage(content="Final: AAPL", tool_calls=[]),
    ])
    orch = Orchestrator(provider=provider, registry=_registry(), max_steps=5)
    events = [e async for e in orch.run("find cheap stocks")]
    synthesis_messages = provider.message_batches[-1]
    assert getattr(synthesis_messages[-2], "role", None) == "tool"
    assert synthesis_messages[-1].role == "user"
    assert "Tools are no longer available" in synthesis_messages[-1].content
    assert all(getattr(m, "content", None) != "Draft: AAPL" for m in synthesis_messages)
    assert events[-1]["content"] == "Final: AAPL"
