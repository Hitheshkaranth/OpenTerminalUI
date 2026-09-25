from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from typing import Any, AsyncGenerator

from backend.agent import events
from backend.agent.playbook import STRATEGY_RESEARCHER
from backend.config.settings import get_settings
from backend.services.llm.base import LLMMessage
from backend.services.llm.model_router import TaskProfile, select_chain


class StrategyLoopOrchestrator:
    """A bounded, read-only strategy research loop.

    The supplied registry is intentionally the only execution surface. Route code
    supplies ``build_strategy_registry()``, which contains no order/write tools.
    """

    def __init__(self, *, provider: Any, registry: Any, max_rounds: int = 3) -> None:
        self.provider = provider
        self.registry = registry
        self.max_rounds = max(1, min(int(max_rounds), 3))

    @staticmethod
    def _ticker(subject: str, context: dict[str, Any] | None) -> str:
        symbol = str((context or {}).get("symbol") or "").strip().upper()
        # A ticker-only prompt is explicit; otherwise the currently-open symbol is
        # the least surprising read-only research target.
        text = subject.strip().upper()
        if re.fullmatch(r"[A-Z][A-Z0-9.^-]{0,14}", text):
            return text
        return symbol or (re.findall(r"[A-Z]{1,10}", text) or ["SPY"])[0]

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
            value = float(source.get("sharpe"))
            return value if value == value else None
        except (AttributeError, TypeError, ValueError):
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
            raise TimeoutError("Strategy loop wall-clock timeout reached")
        return await asyncio.wait_for(awaitable, timeout=remaining)

    @staticmethod
    def _report(best: tuple[dict[str, Any], dict[str, Any], float | None] | None, validation: dict[str, Any] | None) -> str:
        if not best:
            return "## Strategy Lab result\n\nNo usable backtest result was produced. No edge is claimed."
        params, result, sharpe = best
        summary = result.get("summary")
        metrics = result.get("metrics", {}) if params["strategy"] == "sma_crossover" else (summary.get("strategy", {}) if isinstance(summary, dict) else {})
        validation = validation or {}
        permutation = validation.get("permutation", {}) if isinstance(validation, dict) else {}
        robustness = validation.get("robustness", {}) if isinstance(validation, dict) else {}
        p_value, consistency = permutation.get("p_value"), robustness.get("consistency_score")
        significant = isinstance(p_value, (int, float)) and p_value < 0.05
        consistent = robustness.get("interpretation") == "Robust performance across windows"
        caveat = "Validated edge: statistically significant and consistent across windows." if significant and consistent else "Not a validated edge: the in-sample result is not statistically significant and/or is inconsistent across windows; treat it as curve-fitting risk, not an edge."
        return (
            "## Strategy Lab result\n\n"
            f"**Best strategy:** `{params['strategy']}` with `{json.dumps(params, sort_keys=True)}`  \n"
            f"**In-sample Sharpe:** {sharpe if sharpe is not None else 'unavailable'}; key metrics: `{json.dumps(metrics, default=str)}`  \n"
            f"**Out-of-sample validation:** {validation.get('verdict', 'unavailable')}; p-value: {p_value if p_value is not None else 'unavailable'}; cross-window consistency: {consistency if consistency is not None else 'unavailable'}.\n\n"
            f"{caveat}"
        )

    async def run(self, subject: str, *, screen_context: dict[str, Any] | None = None) -> AsyncGenerator[dict[str, Any], None]:
        """Yield a complete stream with exactly one final event, even on failures."""
        best: tuple[dict[str, Any], dict[str, Any], float | None] | None = None
        validation: dict[str, Any] | None = None
        try:
            deadline = time.monotonic() + get_settings().agent_timeout_seconds
            ticker = self._ticker(subject, screen_context)
            yield events.phase("propose", "Propose strategy")
            proposal_prompt = (
                f"Subject: {subject}. Screen context: {json.dumps(screen_context or {})}. Choose exactly one shape and return ONLY JSON: "
                '{"strategy":"sma_crossover","ticker":"...","short_window":20,"long_window":50} '
                'or {"strategy":"momentum_rotation","tickers":["...","..."],"top_n":1,"lookback_days":63,"years":3}. '
                f"Use {ticker} when the subject is ambiguous."
            )
            try:
                narration, model = await self._within_deadline(self._complete(proposal_prompt, "strategy_propose"), deadline)
                if model:
                    yield events.model(model, "strategy_propose")
                yield events.role_message("strategy_researcher", narration or "Using a bounded default SMA hypothesis.")
                params = self._normalise(self._json_object(narration), ticker)
            except Exception as exc:
                yield events.error(str(exc))
                params = self._normalise(None, ticker)

            yield events.phase("iterate", "Iterate")
            previous_metric: float | None = None
            for round_no in range(self.max_rounds):
                tool_name = "backtest_symbol" if params["strategy"] == "sma_crossover" else "backtest_basket"
                call_id = f"strategy-{round_no}-{uuid.uuid4().hex[:8]}"
                yield events.tool_call(call_id, tool_name, params)
                try:
                    result = await self._within_deadline(self.registry.execute(tool_name, params), deadline)
                    is_error = False
                except Exception as exc:
                    result, is_error = {"error": str(exc)}, True
                yield events.tool_result(call_id, tool_name, result, is_error=is_error)
                if is_error or not isinstance(result, dict):
                    break
                metric = self._metric(params, result)
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
                    if not self._changed_once(params, candidate):
                        break
                    params = candidate
                except Exception as exc:
                    yield events.error(str(exc))
                    break

            yield events.phase("validate", "Validate out-of-sample")
            if best is not None:
                call_id = f"validate-{uuid.uuid4().hex[:8]}"
                validation_args = {"equity_curve": best[1].get("equity_curve", []), "metric": "sharpe"}
                yield events.tool_call(call_id, "validate_backtest", validation_args)
                try:
                    validation = await self._within_deadline(self.registry.execute("validate_backtest", validation_args), deadline)
                    is_error = False
                except Exception as exc:
                    validation, is_error = {"verdict": "Unable to validate backtest", "error": str(exc)}, True
                yield events.tool_result(call_id, "validate_backtest", validation, is_error=is_error)
            yield events.phase("decision", "Result")
            yield events.final(self._report(best, validation))
        except Exception as exc:
            # The outer boundary deliberately owns the only final event.
            yield events.error(str(exc))
            yield events.final(self._report(best, validation))
