from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import time
import uuid
from typing import Any, AsyncGenerator

from backend.agent import events
from backend.agent.playbook import STRATEGY_RESEARCHER
from backend.agent.strategy_loop.holdout import load_sma_holdout_session
from backend.agent.strategy_loop.walkforward import PROTOCOL_VERSION, protocol_manifest
from backend.config.settings import get_settings
from backend.services.llm.base import LLMMessage
from backend.services.llm.model_router import TaskProfile, select_chain

logger = logging.getLogger(__name__)

# Domain errors raised by our own code carry user-safe messages (e.g. experiment
# accounting refusals, wall-clock timeouts); anything else is an internal failure
# whose text may leak library/provider internals, so it is logged, not streamed.
_SAFE_ERROR_TYPES = (ValueError, LookupError, TimeoutError)


def _safe_error(exc: BaseException) -> str:
    if isinstance(exc, _SAFE_ERROR_TYPES):
        return str(exc) or type(exc).__name__
    logger.warning("Strategy loop step failed", exc_info=exc)
    return f"internal error ({type(exc).__name__})"


class StrategyLoopOrchestrator:
    """A bounded, read-only strategy research loop.

    Route code supplies a read-only registry. SMA research uses one private,
    frozen train/test session; the model never gets holdout feedback while tuning.
    """

    def __init__(self, *, provider: Any, registry: Any, max_rounds: int = 3,
                 holdout_loader: Any = load_sma_holdout_session,
                 user_id: str | None = None, run_id: str | None = None, experiment_log: Any = None) -> None:
        self.provider = provider
        self.registry = registry
        self.max_rounds = max(1, min(int(max_rounds), 3))
        self.holdout_loader = holdout_loader
        self.user_id = user_id
        self.run_id = run_id or uuid.uuid4().hex
        if user_id and experiment_log is None:
            from backend.agent.strategy_loop.experiments import StrategyExperimentLog
            experiment_log = StrategyExperimentLog()
        self.experiment_log = experiment_log

    @staticmethod
    def _ticker(subject: str, context: dict[str, Any] | None) -> str:
        context = context or {}
        symbol = str(context.get("symbol") or context.get("active_symbol") or context.get("ticker") or "").strip().upper()
        text = subject.strip()
        if re.fullmatch(r"[A-Za-z][A-Za-z0-9.^-]{0,14}", text):
            return text.upper()
        if symbol:
            return symbol
        explicit = re.search(r"\$([A-Za-z][A-Za-z0-9.^-]{0,14})\b|\b(?:ticker|symbol)\s*[:=]?\s*([A-Za-z][A-Za-z0-9.^-]{0,14})\b", text, re.I)
        if explicit:
            return (explicit.group(1) or explicit.group(2)).upper()
        vocabulary = {"SMA", "EMA", "MACD", "RSI", "ETF", "US", "IN", "USD", "INR", "BUY", "SELL",
                      "STRATEGY", "LAB", "TEST", "BACKTEST", "FOR", "THE", "ON", "A", "I"}
        tickers = [token for token in re.findall(r"\b[A-Z][A-Z0-9.^-]{0,14}\b", text) if token not in vocabulary]
        if tickers:
            return tickers[0]
        raise ValueError("Provide an explicit ticker (for example AAPL or $AAPL) or open a symbol before freezing a strategy universe")

    @staticmethod
    def _json_object(content: str) -> dict[str, Any] | None:
        cleaned = re.sub(r"```(?:json)?|```", "", content or "", flags=re.I).strip()
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            value = json.loads(cleaned[start:end + 1])
        except (TypeError, ValueError):
            return None
        return value if isinstance(value, dict) else None

    def _normalise(self, proposal: dict[str, Any] | None, fallback_ticker: str) -> dict[str, Any]:
        if not isinstance(proposal, dict):
            return {"strategy": "sma_crossover", "ticker": fallback_ticker, "short_window": 20, "long_window": 50, "range": "3y"}
        strategy = proposal.get("strategy")
        if strategy == "sma_crossover":
            try:
                short, long = int(proposal.get("short_window", 20)), int(proposal.get("long_window", 50))
            except (TypeError, ValueError):
                return self._normalise(None, fallback_ticker)
            short, long = max(1, short), max(2, long)
            if short >= long:
                return self._normalise(None, fallback_ticker)
            return {"strategy": strategy, "ticker": str(proposal.get("ticker") or fallback_ticker).strip().upper(),
                    "short_window": short, "long_window": long, "range": str(proposal.get("range") or "3y")}
        if strategy == "momentum_rotation":
            raw_tickers = proposal.get("tickers")
            if not isinstance(raw_tickers, list):
                return self._normalise(None, fallback_ticker)
            tickers = [str(t).strip().upper() for t in raw_tickers if str(t).strip()]
            tickers = list(dict.fromkeys(tickers))[:30]
            try:
                top_n, lookback, years = int(proposal.get("top_n", 5)), int(proposal.get("lookback_days", 63)), int(proposal.get("years", 3))
            except (TypeError, ValueError):
                return self._normalise(None, fallback_ticker)
            if not 2 <= len(tickers) <= 30 or top_n <= 0 or lookback <= 0 or years <= 0:
                return self._normalise(None, fallback_ticker)
            return {"strategy": strategy, "tickers": tickers, "top_n": min(top_n, len(tickers)), "lookback_days": lookback, "years": years}
        return self._normalise(None, fallback_ticker)

    @staticmethod
    def _metric(params: dict[str, Any], result: Any) -> float | None:
        if not isinstance(result, dict):
            return None
        try:
            source = result.get("metrics", {}) if params.get("strategy") == "sma_crossover" else result.get("summary", {}).get("strategy", {})
            raw = source.get("sharpe")
            if isinstance(raw, bool):
                return None
            value = float(raw)
            return value if math.isfinite(value) else None
        except (AttributeError, TypeError, ValueError, OverflowError):
            return None

    async def _complete(self, user: str, phase: str) -> tuple[str, str]:
        models = select_chain(TaskProfile(phase=phase, role="strategy_researcher"), get_settings())
        response = await self.provider.complete(
            [LLMMessage(role="system", content=STRATEGY_RESEARCHER), LLMMessage(role="user", content=user)],
            tools=None, max_tokens=768, models=models,
        )
        return (response.content or "").strip(), response.model or models[0]

    @staticmethod
    def _changed_once(previous: dict[str, Any], candidate: dict[str, Any]) -> bool:
        keys = set(previous) | set(candidate)
        return sum(previous.get(key) != candidate.get(key) for key in keys) == 1

    async def _within_deadline(self, awaitable: Any, deadline: float) -> Any:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            close = getattr(awaitable, "close", None)
            if close:
                close()
            raise TimeoutError("Strategy loop wall-clock timeout reached")
        return await asyncio.wait_for(awaitable, timeout=remaining)

    @staticmethod
    def _report(best: tuple[dict[str, Any], dict[str, Any], float | None] | None, validation: dict[str, Any] | None,
                holdout: dict[str, Any] | None = None, selection_count: int = 0,
                walk_forward: dict[str, Any] | None = None, experiment: dict[str, Any] | None = None) -> str:
        if not best:
            reason = f"\n\n{holdout['error']}" if holdout and holdout.get("error") else ""
            return "## Strategy Lab result\n\nNo usable backtest result was produced. No edge is claimed." + reason
        params, result, sharpe = best
        summary = result.get("summary")
        metrics = result.get("metrics", {}) if params["strategy"] == "sma_crossover" else (summary.get("strategy", {}) if isinstance(summary, dict) else {})
        validation = validation if isinstance(validation, dict) else {}
        permutation = validation.get("permutation")
        robustness = validation.get("robustness")
        permutation = permutation if isinstance(permutation, dict) else {}
        robustness = robustness if isinstance(robustness, dict) else {}
        p_value, consistency = permutation.get("p_value"), robustness.get("consistency_score")
        # These tests reuse the curve selected by the parameter search. They cannot
        # establish performance on unseen data, irrespective of their verdict.
        caveat = (
            "Not a validated edge: no untouched held-out test was run. These diagnostics reuse "
            "the selected in-sample equity curve and do not account for selection bias from "
            "trying strategy parameters. Even a low p-value and consistent windows do not "
            "establish an out-of-sample edge."
        )
        holdout_text = ""
        if holdout and holdout.get("partition") == "holdout":
            split = holdout["split"]
            holdout_text = (
                f"**Chronological holdout (evaluated once after selection):** `{json.dumps(holdout['metrics'], sort_keys=True)}`.  \n"
                f"Training: {split['train_start']} through {split['train_end']} ({split['train_bars']} bars); "
                f"test: {split['test_start']} through {split['test_end']} ({split['test_bars']} bars).  \n"
                f"Candidates tried on training only: {selection_count}. Signals use the previous bar; "
                f"the test starts flat with initial cash {holdout.get('initial_cash', 'unavailable')}, "
                "5 bps fees and 5 bps slippage per fill. "
                "There is no embargo gap between chronological partitions; training history warms the test indicators.\n\n"
                f"**Data provenance:** `{json.dumps(holdout.get('provenance', {}), sort_keys=True)}`.\n\n"
            )
            caveat = (
                "Not a validated edge: this is one chronological held-out test, not walk-forward evidence "
                "or proof of statistical significance. Training diagnostics retain parameter-selection bias. "
                "Do not retune against this holdout; a new research decision requires new unseen data."
            )
        elif holdout and holdout.get("error"):
            holdout_text = f"**Chronological holdout unavailable:** {holdout['error']}.\n\n"
        elif params["strategy"] != "sma_crossover":
            holdout_text = "**Chronological holdout unsupported:** momentum rotation currently has in-sample diagnostics only.\n\n"
        walk_forward_text = ""
        if walk_forward and walk_forward.get("status") == "completed":
            rows = ["Fold | Training through | Next test dates | Selected SMA | Test Sharpe | Test return (%)",
                    "--- | --- | --- | --- | --- | ---"]
            for fold in walk_forward["folds"]:
                pair, measured = fold["selected_params"], fold["test_metrics"]
                rows.append(f"{fold['fold']} | {fold['train_end'][:10]} | {fold['test_start'][:10]}–{fold['test_end'][:10]} | "
                            f"{pair['short_window']}/{pair['long_window']} | {measured['sharpe']} | {measured['total_return_pct']}")
            walk_forward_text = (
                "**Expanding walk-forward:** each fold selects from the predeclared grid on its past training slice "
                f"and tests only the following window. Protocol `{walk_forward['protocol']['version']}`; "
                f"grid `{json.dumps(walk_forward['protocol']['grid'])}`. Total training candidates: {walk_forward['selection_count']}. "
                f"Chained test metrics: `{json.dumps(walk_forward['metrics'], sort_keys=True)}`.\n\n"
                + "\n".join(rows) + "\n\n"
                "This evaluates the fixed grid selector, not the LLM's final proposal. Test windows are disjoint; "
                "earlier test data may enter later training. Each test starts flat and liquidates with 5 bps fees "
                "and 5 bps slippage at its boundary; signals use the previous bar. "
                "Walk-forward and final holdout share dataset/test dates and are not independent replication. "
                "The universe is one fixed, preselected symbol throughout; no historical index membership is implied.\n\n"
            )
            caveat = (
                "Not a validated edge: held-out and walk-forward results are finite retrospective evidence, "
                "not proof of statistical significance. Do not retune against these tests."
            )
        elif walk_forward:
            walk_forward_text = f"**Walk-forward unavailable:** {walk_forward.get('reason') or walk_forward.get('error') or 'unsupported'}.\n\n"
        experiment_text = ""
        if experiment:
            if experiment.get("status") == "untracked":
                experiment_text = "**Experiment accounting:** no authenticated user identity; repeated exposure cannot be established.\n\n"
            else:
                experiment_text = (
                    f"**Experiment:** `{experiment.get('experiment_id')}`; run `{experiment.get('run_id')}`; "
                    f"dataset `{experiment.get('dataset_id')}`. Prior recorded test openings: "
                    f"{experiment.get('prior_test_exposures', 'see saved snapshot')}; total recorded: "
                    f"{experiment.get('recorded_test_exposures', 'unavailable')}. Prior openings with overlapping holdout dates "
                    f"for this symbol: {experiment.get('prior_overlapping_holdout_exposures', 'unavailable')}.\n\n"
                )
                if experiment.get("same_run_replay"):
                    experiment_text += "Replayed the completed immutable result for this run; no tests were recomputed.\n\n"
                if experiment.get("prior_test_exposures", 0) > 0 or experiment.get("prior_overlapping_holdout_exposures", 0) > 0 or experiment.get("same_run_replay"):
                    experiment_text += (
                        "**Reused research data:** this dataset's tests have been opened before. Human knowledge "
                        "of prior outcomes can influence new hypotheses; these results are reused evidence, not a pristine holdout.\n\n"
                    )
                if experiment.get("persistence_error"):
                    experiment_text += f"Result snapshot could not be saved: {experiment['persistence_error']}. Reopening this run is blocked.\n\n"
        return (
            "## Strategy Lab result\n\n"
            f"**Best strategy:** `{params['strategy']}` with `{json.dumps(params, sort_keys=True)}`  \n"
            f"**In-sample Sharpe:** {sharpe if sharpe is not None else 'unavailable'}; key metrics: `{json.dumps(metrics, default=str)}`  \n"
            f"**In-sample diagnostics (selected equity curve):** permutation p-value: {p_value if p_value is not None else 'unavailable'}; cross-window consistency: {consistency if consistency is not None else 'unavailable'}.\n\n"
            f"{holdout_text}{walk_forward_text}{experiment_text}{caveat}"
        )

    async def run(self, subject: str, *, screen_context: dict[str, Any] | None = None) -> AsyncGenerator[dict[str, Any], None]:
        """Yield a complete stream with exactly one final event, even on failures."""
        from backend.agent.historical import validate_historical_mode
        validate_historical_mode("strategy", screen_context or {})
        best: tuple[dict[str, Any], dict[str, Any], float | None] | None = None
        validation: dict[str, Any] | None = None
        holdout: dict[str, Any] | None = None
        walk_forward: dict[str, Any] | None = None
        experiment: dict[str, Any] | None = None
        session = None
        session_error = None
        selection_count = 0
        attempts = []
        try:
            deadline = time.monotonic() + get_settings().agent_timeout_seconds
            if self.user_id:
                try:
                    previous = await self._within_deadline(asyncio.to_thread(
                        self.experiment_log.replay_if_completed, user_id=self.user_id, run_id=self.run_id,
                    ), deadline)
                    if previous:
                        saved = previous.pop("results")
                        metadata = {**saved["experiment"], **previous}
                        yield events.phase("replay", "Replay saved experiment without recomputing tests")
                        yield events.artifact("strategy_experiment", "Experiment accounting", metadata)
                        yield events.final(self._report(tuple(saved["best"]), saved["validation"], saved["holdout"],
                                                       saved["selection_count"], saved["walk_forward"], metadata))
                        return
                except Exception as exc:
                    reason = _safe_error(exc)
                    yield events.error(f"Experiment accounting unavailable: {reason}")
                    yield events.final(f"## Strategy Lab result\n\nExperiment accounting blocked this run: {reason}. No tests were recomputed or opened.")
                    return
            ticker = self._ticker(subject, screen_context)
            if self.holdout_loader is not None:
                yield events.phase("prepare", "Freeze chronological train/test history")
                try:
                    session = await self._within_deadline(self.holdout_loader(ticker), deadline)
                except Exception as exc:
                    session_error = _safe_error(exc)
                    yield events.error(f"Chronological history unavailable: {session_error}")
            if session is not None and self.user_id:
                try:
                    prepared = await self._within_deadline(asyncio.to_thread(
                        self.experiment_log.prepare, user_id=self.user_id, run_id=self.run_id,
                        dataset_id=session.dataset_id, symbol=session.ticker, protocol_version=PROTOCOL_VERSION,
                        manifest={"split": session.split_metadata(), "walk_forward": protocol_manifest(),
                                  "universe": [session.ticker], "provenance": session.provenance},
                    ), deadline)
                    saved = prepared.pop("results", None)
                    experiment = prepared
                    if saved is not None:
                        metadata = {**saved["experiment"], **experiment}
                        yield events.phase("replay", "Replay saved experiment without recomputing tests")
                        yield events.artifact("strategy_experiment", "Experiment accounting", metadata)
                        yield events.final(self._report(tuple(saved["best"]), saved["validation"], saved["holdout"],
                                                       saved["selection_count"], saved["walk_forward"], metadata))
                        return
                except Exception as exc:
                    reason = _safe_error(exc)
                    yield events.error(f"Experiment accounting unavailable: {reason}")
                    yield events.final(f"## Strategy Lab result\n\nExperiment accounting blocked this run: {reason}. No tests were recomputed or opened.")
                    return
            yield events.phase("propose", "Propose strategy")
            proposal_prompt = (
                f"Subject: {subject}. Screen context: {json.dumps(screen_context or {})}. Choose exactly one shape and return ONLY JSON: "
                '{"strategy":"sma_crossover","ticker":"...","short_window":20,"long_window":50} '
                'or {"strategy":"momentum_rotation","tickers":["...","..."],"top_n":1,"lookback_days":63,"years":3}. '
                f"For SMA use ticker {ticker} and range 3y; these are frozen for this run. "
                "Only training results may inform parameter selection."
            )
            try:
                narration, model = await self._within_deadline(self._complete(proposal_prompt, "strategy_propose"), deadline)
                if model:
                    yield events.model(model, "strategy_propose")
                yield events.role_message("strategy_researcher", narration or "Using a bounded default SMA hypothesis.")
                params = self._normalise(self._json_object(narration), ticker)
            except Exception as exc:
                yield events.error(_safe_error(exc))
                params = self._normalise(None, ticker)

            if params["strategy"] == "sma_crossover":
                params["ticker"], params["range"] = ticker, "3y"
            else:
                reason = (
                    "Momentum rotation is unsupported in Strategy Lab without verified historical universe membership. "
                    "A present-day ticker basket cannot establish a survivorship-safe universe. No basket backtest or held-out test was executed."
                )
                yield events.error(reason)
                yield events.final(self._report(None, None, {"error": reason}))
                return

            yield events.phase("iterate", "Iterate")
            previous_metric: float | None = None
            for round_no in range(self.max_rounds):
                tool_name = "backtest_symbol" if params["strategy"] == "sma_crossover" else "backtest_basket"
                call_id = f"strategy-{round_no}-{uuid.uuid4().hex[:8]}"
                yield events.tool_call(call_id, tool_name, params)
                try:
                    if params["strategy"] == "sma_crossover" and self.holdout_loader is not None:
                        if session is None:
                            raise ValueError(session_error or "Frozen holdout history unavailable")
                        result = await self._within_deadline(asyncio.to_thread(session.train, params), deadline)
                    else:
                        result = await self._within_deadline(self.registry.execute(tool_name, params), deadline)
                    is_error = False
                except Exception as exc:
                    result, is_error = {"error": _safe_error(exc)}, True
                yield events.tool_result(call_id, tool_name, result, is_error=is_error)
                if is_error or not isinstance(result, dict):
                    break
                metric = self._metric(params, result)
                selection_count += 1
                attempts.append({"params": dict(params), "metrics": result.get("metrics", {}), "partition": result.get("partition", "in_sample")})
                # Preserve the first completed run even when a malformed tool result
                # lacks Sharpe, so it still receives mandatory robustness validation.
                if best is None or (metric is not None and (best[2] is None or metric > best[2])):
                    best = (params, result, metric)
                if round_no + 1 >= self.max_rounds or metric is None or (previous_metric is not None and metric <= previous_metric):
                    break
                previous_metric = metric
                improve_prompt = (
                    f"Current strict JSON params: {json.dumps(params)}. Last in-sample Sharpe: {metric}. "
                    "Return ONLY the same strategy JSON shape with exactly ONE changed parameter to try to improve Sharpe."
                )
                try:
                    narration, model = await self._within_deadline(self._complete(improve_prompt, "strategy_iterate"), deadline)
                    if model:
                        yield events.model(model, "strategy_iterate")
                    yield events.role_message("strategy_researcher", narration or "No valid one-variable improvement proposed.")
                    candidate = self._normalise(self._json_object(narration), ticker)
                    if params["strategy"] == "sma_crossover" and session is not None and any(
                        candidate.get(key) != params.get(key) for key in ("strategy", "ticker", "range")
                    ):
                        break
                    if not self._changed_once(params, candidate):
                        break
                    params = candidate
                except Exception as exc:
                    yield events.error(_safe_error(exc))
                    break

            yield events.phase("validate", "Check in-sample robustness")
            if best is not None:
                call_id = f"validate-{uuid.uuid4().hex[:8]}"
                validation_args = {"equity_curve": best[1].get("equity_curve", []), "metric": "sharpe"}
                yield events.tool_call(call_id, "validate_backtest", validation_args)
                try:
                    validation = await self._within_deadline(self.registry.execute("validate_backtest", validation_args), deadline)
                    is_error = False
                except Exception as exc:
                    validation, is_error = {"verdict": "Unable to validate backtest", "error": _safe_error(exc)}, True
                yield events.tool_result(call_id, "validate_backtest", validation, is_error=is_error)
            # No model call follows opening the holdout. The winner is frozen.
            if best is not None and best[0]["strategy"] == "sma_crossover" and session is not None:
                if self.user_id:
                    try:
                        experiment = await self._within_deadline(asyncio.to_thread(
                            self.experiment_log.open_tests, user_id=self.user_id, run_id=self.run_id,
                            selection={"winner": best[0], "training_candidates": attempts, "selection_count": selection_count},
                        ), deadline)
                    except Exception as exc:
                        reason = _safe_error(exc)
                        yield events.error(f"Cannot reserve test exposure: {reason}")
                        yield events.final(self._report(best, validation, {"error": f"Tests were not opened: {reason}"}, selection_count,
                                                       experiment=experiment))
                        return
                else:
                    experiment = {"status": "untracked", "dataset_id": session.dataset_id, "run_id": self.run_id}
                yield events.phase("holdout", "Test frozen winner on unseen dates")
                call_id = f"holdout-{uuid.uuid4().hex[:8]}"
                yield events.tool_call(call_id, "evaluate_strategy_holdout", best[0])
                try:
                    holdout = await self._within_deadline(asyncio.to_thread(session.evaluate_holdout, best[0]), deadline)
                    is_error = False
                except Exception as exc:
                    holdout, is_error = {"error": _safe_error(exc)}, True
                yield events.tool_result(call_id, "evaluate_strategy_holdout", holdout, is_error=is_error)
                yield events.phase("walk_forward", "Expanding train/next-window tests")
                call_id = f"walkforward-{uuid.uuid4().hex[:8]}"
                yield events.tool_call(call_id, "evaluate_strategy_walk_forward", {"ticker": session.ticker, "protocol": protocol_manifest()})
                try:
                    walk_forward = await self._within_deadline(asyncio.to_thread(session.walk_forward, deadline=deadline), deadline)
                    is_error = walk_forward.get("status") != "completed"
                except Exception as exc:
                    walk_forward, is_error = {"status": "unavailable", "error": _safe_error(exc)}, True
                yield events.tool_result(call_id, "evaluate_strategy_walk_forward", walk_forward, is_error=is_error)
                if self.user_id:
                    try:
                        await self._within_deadline(asyncio.to_thread(
                            self.experiment_log.complete, user_id=self.user_id, run_id=self.run_id,
                            results={"best": best, "validation": validation, "holdout": holdout, "walk_forward": walk_forward,
                                     "selection_count": selection_count, "experiment": experiment},
                        ), deadline)
                    except Exception as exc:
                        reason = _safe_error(exc)
                        experiment = {**experiment, "persistence_error": reason}
                        yield events.error(f"Experiment result snapshot could not be saved: {reason}")
                yield events.artifact("strategy_experiment", "Experiment accounting", experiment)
            yield events.phase("decision", "Result")
            yield events.final(self._report(best, validation, holdout, selection_count, walk_forward, experiment))
        except Exception as exc:
            # The outer boundary deliberately owns the only final event.
            reason = _safe_error(exc)
            yield events.error(reason)
            if best is None:
                holdout = {"error": reason}
            yield events.final(self._report(best, validation, holdout, selection_count, walk_forward, experiment))
