import pytest

from backend.agent.strategy_loop import StrategyLoopOrchestrator
from backend.services.llm.base import AssistantMessage


class ScriptedProvider:
    def __init__(self, *, fail_after=None):
        self.calls = 0
        self.fail_after = fail_after

    async def complete(self, messages, tools=None, **kwargs):
        self.calls += 1
        if self.fail_after and self.calls >= self.fail_after:
            raise RuntimeError("provider unavailable")
        replies = [
            '{"strategy":"sma_crossover","ticker":"AAPL","short_window":20,"long_window":50}',
            '{"strategy":"sma_crossover","ticker":"AAPL","short_window":15,"long_window":50}',
            '{"strategy":"sma_crossover","ticker":"AAPL","short_window":10,"long_window":50}',
        ]
        return AssistantMessage(content=replies[min(self.calls - 1, len(replies) - 1)], model="fixture-model")


class FixtureRegistry:
    def __init__(self):
        self.calls = []

    async def execute(self, name, args):
        self.calls.append((name, args))
        if name == "backtest_symbol":
            short = args["short_window"]
            return {
                "metrics": {"sharpe": 1 + (20 - short) / 10},
                "equity_curve": [{"date": "2024-01-01", "equity": 100}, {"date": "2024-01-02", "equity": 101}, {"date": "2024-01-03", "equity": 103}],
            }
        assert name == "validate_backtest"
        return {
            "verdict": "Indistinguishable from random",
            "permutation": {"p_value": 0.20},
            "robustness": {"consistency_score": 0.3, "interpretation": "Inconsistent performance across windows"},
        }


@pytest.mark.asyncio
async def test_strategy_loop_is_bounded_validates_and_reports_non_significance():
    registry = FixtureRegistry()
    events = [event async for event in StrategyLoopOrchestrator(
        provider=ScriptedProvider(), registry=registry, max_rounds=2,
    ).run("AAPL")]

    finals = [event for event in events if event["type"] == "final"]
    assert len(finals) == 1
    assert sum(event["type"] == "tool_call" and event["name"] == "backtest_symbol" for event in events) <= 2
    validate_index = next(i for i, event in enumerate(events) if event.get("name") == "validate_backtest")
    final_index = next(i for i, event in enumerate(events) if event["type"] == "final")
    assert validate_index < final_index
    assert "Not a validated edge" in finals[0]["content"]


@pytest.mark.asyncio
async def test_strategy_loop_never_raises_when_provider_fails_mid_loop():
    events = [event async for event in StrategyLoopOrchestrator(
        provider=ScriptedProvider(fail_after=2), registry=FixtureRegistry(), max_rounds=3,
    ).run("AAPL")]

    assert len([event for event in events if event["type"] == "final"]) == 1


def test_string_tickers_fall_back_instead_of_splitting_characters():
    orch = StrategyLoopOrchestrator(provider=None, registry=None)
    out = orch._normalise({"strategy": "momentum_rotation", "tickers": "AAPL,GOOGL,MSFT"}, "SPY")
    assert out["strategy"] == "sma_crossover" and out["ticker"] == "SPY"


def test_non_dict_summary_does_not_crash_metric_or_report():
    params = {"strategy": "momentum_rotation", "tickers": ["A", "B"]}
    result = {"summary": "text"}
    assert StrategyLoopOrchestrator._metric(params, result) is None
    assert "Strategy Lab result" in StrategyLoopOrchestrator._report((params, result, None), None)
