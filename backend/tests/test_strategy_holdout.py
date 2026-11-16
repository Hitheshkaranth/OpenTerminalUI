"""Offline regressions for the strategy loop's private chronological split."""

import json

import numpy as np
import pandas as pd
import pytest

from backend.agent.strategy_loop.holdout import SMAHoldoutSession, load_sma_holdout_session
from backend.agent.strategy_loop.orchestrator import StrategyLoopOrchestrator
from backend.core.single_asset_backtest import BacktestEngine, generate_sma_crossover_signals
from backend.services.llm.base import AssistantMessage


PARAMS = {"strategy": "sma_crossover", "ticker": "AAPL", "range": "3y", "short_window": 20, "long_window": 50}


def history():
    prices = 100 + np.arange(240) * 0.1 + 8 * np.sin(np.arange(240) / 8)
    return pd.DataFrame({"date": pd.date_range("2024-01-01", periods=240),
                         "open": prices, "high": prices + 1, "low": prices - 1, "close": prices})


def test_future_test_prices_and_external_mutation_cannot_change_training():
    source = history()
    frozen = SMAHoldoutSession("AAPL", source)
    changed = source.copy()
    changed.loc[168:, ["open", "high", "low", "close"]] *= 10
    alternative = SMAHoldoutSession("AAPL", changed)
    before = frozen.train(PARAMS)
    other = alternative.train(PARAMS)
    assert before["metrics"] == other["metrics"]
    assert before["equity_curve"] == other["equity_curve"]
    source.loc[:, "close"] = 1
    assert frozen.train(PARAMS) == before
    assert frozen.dataset_id != alternative.dataset_id


def test_holdout_has_only_unseen_dates_and_is_one_use_then_training_closes():
    session = SMAHoldoutSession("AAPL", history())
    training = session.train(PARAMS)
    tested = session.evaluate_holdout(PARAMS)
    train_dates = [pd.Timestamp(row["date"]) for row in training["equity_curve"]]
    test_dates = [pd.Timestamp(row["date"]) for row in tested["equity_curve"]]
    assert max(train_dates) < min(test_dates)
    assert len(train_dates) == 168 and len(test_dates) == 72
    assert tested["partition"] == "holdout"
    assert tested["execution"] == {"fee_bps": 5, "slippage_bps": 5, "signal_delay_bars": 1, "start_flat": True}
    with pytest.raises(ValueError, match="only once"):
        session.evaluate_holdout(PARAMS)
    with pytest.raises(ValueError, match="closed"):
        session.train({**PARAMS, "short_window": 15})


def test_holdout_cannot_evaluate_an_untrained_candidate():
    session = SMAHoldoutSession("AAPL", history())
    session.train(PARAMS)
    with pytest.raises(ValueError, match="must have been evaluated"):
        session.evaluate_holdout({**PARAMS, "short_window": 15})
    assert session.evaluate_holdout(PARAMS)["partition"] == "holdout"


def test_warmup_is_past_only_and_test_orders_use_previous_bar_signal(monkeypatch):
    source = history()
    calls = []
    original_run = BacktestEngine.run

    def record(engine, symbol, frame, signals, **kwargs):
        calls.append((engine.config, frame.copy(), signals.copy()))
        return original_run(engine, symbol, frame, signals, **kwargs)

    monkeypatch.setattr(BacktestEngine, "run", record)
    session = SMAHoldoutSession("AAPL", source)
    session.train(PARAMS)
    tested = session.evaluate_holdout(PARAMS)
    config, frame, signals = calls[-1]
    expected = generate_sma_crossover_signals(source, 20, 50).shift(1).fillna(0).iloc[168:].reset_index(drop=True)
    assert signals.tolist() == expected.tolist()
    assert len(frame) == 72
    assert pd.Timestamp(frame.iloc[0]["date"]) == pd.Timestamp(source.iloc[168]["date"], tz="UTC")
    assert config.fee_bps == 5 and config.slippage_bps == 5
    assert config.position_fraction == 1 / 1.001  # leave entry cash for costs
    assert tested["bars"] == 72  # warmup prices do not enter test metrics


@pytest.mark.parametrize("change", [{"ticker": "MSFT"}, {"range": "5y"}, {"strategy": "momentum_rotation"},
                                     {"short_window": True}, {"long_window": 200}, {"short_window": 50}])
def test_session_rejects_scope_or_invalid_window_changes(change):
    with pytest.raises(ValueError):
        SMAHoldoutSession("AAPL", history()).train({**PARAMS, **change})


@pytest.mark.parametrize("bad", ["duplicate_date", "bad_date", "nonfinite", "zero", "short"])
def test_invalid_history_cannot_create_holdout_evidence(bad):
    frame = history()
    if bad == "duplicate_date":
        frame.loc[1, "date"] = frame.loc[0, "date"]
    elif bad == "bad_date":
        frame.loc[1, "date"] = pd.NaT
    elif bad == "nonfinite":
        frame.loc[1, "close"] = float("inf")
    elif bad == "zero":
        frame.loc[1, "close"] = 0
    else:
        frame = frame.iloc[:100]
    with pytest.raises(ValueError):
        SMAHoldoutSession("AAPL", frame)


@pytest.mark.asyncio
async def test_orchestrator_loads_once_before_proposal_and_opens_holdout_after_last_model_call():
    timeline = []
    session = SMAHoldoutSession("AAPL", history())

    async def loader(ticker):
        assert ticker == "AAPL"
        timeline.append("load")
        return session

    class Provider:
        calls = 0

        async def complete(self, messages, **kwargs):
            timeline.append("model")
            self.calls += 1
            # A single scope change must be rejected even if it improves Sharpe.
            params = PARAMS if self.calls == 1 else {**PARAMS, "ticker": "MSFT"}
            return AssistantMessage(content=json.dumps(params), model="fixture")

    class Registry:
        async def execute(self, name, args):
            assert name == "validate_backtest"  # never re-fetch full history to tune
            assert max(pd.to_datetime(row["date"], utc=True) for row in args["equity_curve"]) < pd.Timestamp(session.split_metadata()["test_start"])
            timeline.append("diagnostics")
            return {"permutation": {"p_value": 0.00001}, "robustness": {"consistency_score": 1}}

    events = [event async for event in StrategyLoopOrchestrator(
        provider=Provider(), registry=Registry(), holdout_loader=loader, max_rounds=3,
    ).run("AAPL")]
    assert timeline == ["load", "model", "model", "diagnostics"]
    calls = [event for event in events if event["type"] == "tool_call"]
    assert [event["name"] for event in calls] == ["backtest_symbol", "validate_backtest", "evaluate_strategy_holdout", "evaluate_strategy_walk_forward"]
    assert calls[-2]["arguments"] == PARAMS
    finals = [event for event in events if event["type"] == "final"]
    assert len(finals) == 1
    assert "Chronological holdout (evaluated once after selection)" in finals[0]["content"]
    assert "Candidates tried on training only: 1" in finals[0]["content"]
    assert "Not a validated edge" in finals[0]["content"]
    assert "no untouched held-out test was run" not in finals[0]["content"]


@pytest.mark.asyncio
async def test_failed_snapshot_does_not_fall_back_to_full_history_training():
    async def loader(ticker):
        raise ValueError("no data")

    class Provider:
        async def complete(self, messages, **kwargs):
            return AssistantMessage(content=json.dumps(PARAMS), model="fixture")

    class Registry:
        async def execute(self, name, args):
            pytest.fail("No registry backtest should run without a frozen SMA split")

    events = [event async for event in StrategyLoopOrchestrator(provider=Provider(), registry=Registry(), holdout_loader=loader).run("AAPL")]
    assert len([event for event in events if event["type"] == "final"]) == 1
    assert "No usable backtest" in events[-1]["content"]


@pytest.mark.asyncio
@pytest.mark.parametrize("source_name", ["yahoo", "fmp", None, "mock", "synthetic", "unknown"])
async def test_default_loader_fetches_once_and_session_never_refetches(monkeypatch, source_name):
    from backend.api import deps
    from backend.api.routes import chart

    requests = []

    class Fetcher:
        async def fetch_history(self, ticker, **kwargs):
            requests.append((ticker, kwargs))
            return {"_source": source_name}

    async def fetcher():
        return Fetcher()

    source = history().set_index("date").rename(columns={"open": "Open", "high": "High", "low": "Low", "close": "Close"})
    monkeypatch.setattr(deps, "get_unified_fetcher", fetcher)
    monkeypatch.setattr(chart, "_parse_yahoo_chart", lambda raw: source)
    if source_name not in {"yahoo", "fmp"}:
        with pytest.raises(ValueError, match="source-reported"):
            await load_sma_holdout_session("AAPL")
        return
    session = await load_sma_holdout_session("AAPL")
    session.train(PARAMS)
    session.train({**PARAMS, "short_window": 15})
    session.evaluate_holdout(PARAMS)
    assert requests == [("AAPL", {"range_str": "3y", "interval": "1d"})]


@pytest.mark.asyncio
async def test_valid_refinement_uses_train_only_then_frozen_winner_test_once():
    session = SMAHoldoutSession("AAPL", history())
    provider_calls = []

    async def loader(ticker):
        return session

    class Provider:
        async def complete(self, messages, **kwargs):
            provider_calls.append(messages[-1].content)
            params = PARAMS if len(provider_calls) == 1 else {**PARAMS, "short_window": 15}
            return AssistantMessage(content=json.dumps(params), model="fixture")

    class Registry:
        async def execute(self, name, args):
            assert name == "validate_backtest"
            return {}

    events = [event async for event in StrategyLoopOrchestrator(
        provider=Provider(), registry=Registry(), holdout_loader=loader, max_rounds=2,
    ).run("AAPL")]
    train_results = [event["result"] for event in events if event["type"] == "tool_result" and event["name"] == "backtest_symbol"]
    assert len(train_results) == 2 and len(provider_calls) == 2
    assert all(result["partition"] == "train" and result["bars"] == 168 for result in train_results)
    tests = [event for event in events if event["type"] == "tool_result" and event["name"] == "evaluate_strategy_holdout"]
    assert len(tests) == 1 and tests[0]["result"]["bars"] == 72
    expected = max(train_results, key=lambda result: result["metrics"]["sharpe"])
    assert tests[0]["result"]["params"] == expected["params"]
    assert "Last in-sample Sharpe:" in provider_calls[-1]
    assert "Candidates tried on training only: 2" in events[-1]["content"]


def test_momentum_report_explicitly_states_holdout_is_unsupported():
    report = StrategyLoopOrchestrator._report(({"strategy": "momentum_rotation"}, {"summary": {"strategy": {"sharpe": 2}}}, 2), {})
    assert "Chronological holdout unsupported" in report
    assert "momentum rotation currently has in-sample diagnostics only" in report
    assert "Not a validated edge" in report


def test_holdout_sharpe_and_drawdown_include_first_test_entry_cost():
    frame = history()
    # Rising training prices ensure the held-out account buys on its first bar;
    # flat held-out prices then isolate that entry's execution costs.
    frame.loc[:167, ["open", "high", "low", "close"]] = np.tile(np.arange(100, 268)[:, None], (1, 4))
    frame.loc[168:, ["open", "high", "low", "close"]] = 268.0
    session = SMAHoldoutSession("AAPL", frame)
    session.train(PARAMS)
    tested = session.evaluate_holdout(PARAMS)
    values = [100000.0, *(row["equity"] for row in tested["equity_curve"])]
    nav = pd.Series(values)
    returns = nav.pct_change().dropna()
    assert returns.iloc[0] < 0
    assert tested["metrics"]["sharpe"] == pytest.approx(returns.mean() * 252 / (returns.std() * np.sqrt(252)))
    assert tested["metrics"]["max_drawdown_pct"] == pytest.approx((nav / nav.cummax() - 1).min() * 100)
    assert tested["metrics"]["max_drawdown_pct"] < 0
