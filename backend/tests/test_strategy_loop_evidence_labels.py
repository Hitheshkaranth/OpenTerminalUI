"""Selected-curve diagnostics must never masquerade as held-out evidence."""

import pytest

from backend.agent.strategy_loop import StrategyLoopOrchestrator
from backend.services.llm.base import AssistantMessage


PARAMS = {"strategy": "sma_crossover", "ticker": "AAPL", "short_window": 20, "long_window": 50}
CURVE = [{"date": "2024-01-01", "equity": 100}, {"date": "2024-01-02", "equity": 110},
         {"date": "2024-01-03", "equity": 120}]
STRONG_DIAGNOSTICS = {
    "verdict": "Validated edge",
    "permutation": {"p_value": 0.00001},
    "robustness": {"consistency_score": 1.0, "interpretation": "Robust performance across windows"},
}


def test_spectacular_selected_curve_diagnostics_do_not_establish_an_edge():
    report = StrategyLoopOrchestrator._report((PARAMS, {"metrics": {"sharpe": 9}}, 9), STRONG_DIAGNOSTICS)
    assert "In-sample diagnostics (selected equity curve)" in report
    assert "1e-05" in report and "consistency: 1.0" in report
    assert "Not a validated edge" in report
    assert "no untouched held-out test was run" in report
    assert "selection bias" in report
    assert "**Out-of-sample validation:**" not in report
    assert "Validated edge" not in report


@pytest.mark.parametrize("diagnostics", [None, {}, {"error": "unavailable"},
                                         {"permutation": None, "robustness": "malformed"}])
def test_missing_diagnostics_do_not_hide_the_holdout_limitation(diagnostics):
    report = StrategyLoopOrchestrator._report((PARAMS, {}, None), diagnostics)
    assert "p-value: unavailable" in report
    assert "consistency: unavailable" in report
    assert "no untouched held-out test was run" in report
    assert "Not a validated edge" in report


@pytest.mark.parametrize("strategy", ["sma_crossover", "momentum_rotation"])
@pytest.mark.parametrize("value", [float("inf"), float("-inf"), float("nan"), "Infinity", "-Infinity", True, False])
def test_nonfinite_or_boolean_sharpe_cannot_win_the_parameter_search(strategy, value):
    result = {"metrics": {"sharpe": value}} if strategy == "sma_crossover" else {"summary": {"strategy": {"sharpe": value}}}
    assert StrategyLoopOrchestrator._metric({"strategy": strategy}, result) is None


@pytest.mark.parametrize("value", [0, -1.5, "2.25"])
def test_finite_sharpe_remains_usable(value):
    assert StrategyLoopOrchestrator._metric(PARAMS, {"metrics": {"sharpe": value}}) == float(value)


@pytest.mark.asyncio
@pytest.mark.parametrize("diagnostics_fail", [False, True])
async def test_stream_preserves_validation_contract_and_one_final(diagnostics_fail):
    class Provider:
        async def complete(self, messages, **kwargs):
            return AssistantMessage(content='{"strategy":"sma_crossover","ticker":"AAPL","short_window":20,"long_window":50}', model="fixture")

    class Registry:
        calls = []

        async def execute(self, name, args):
            self.calls.append((name, args))
            if name == "backtest_symbol":
                return {"metrics": {"sharpe": 9}, "equity_curve": CURVE}
            assert name == "validate_backtest"
            if diagnostics_fail:
                raise RuntimeError("diagnostics unavailable")
            return STRONG_DIAGNOSTICS

    registry = Registry()
    stream = [event async for event in StrategyLoopOrchestrator(provider=Provider(), registry=registry, max_rounds=1, holdout_loader=None).run("AAPL")]
    assert [name for name, _ in registry.calls] == ["backtest_symbol", "validate_backtest"]
    assert registry.calls[-1][1] == {"equity_curve": CURVE, "metric": "sharpe"}
    assert {"type": "phase", "key": "validate", "label": "Check in-sample robustness"} in stream
    diagnostics_event = next(event for event in stream if event["type"] == "tool_result" and event["name"] == "validate_backtest")
    assert diagnostics_event["is_error"] is diagnostics_fail
    finals = [event for event in stream if event["type"] == "final"]
    assert len(finals) == 1
    assert "Not a validated edge" in finals[0]["content"]
    assert "no untouched held-out test was run" in finals[0]["content"]
