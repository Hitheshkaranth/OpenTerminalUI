from __future__ import annotations

import json
import logging
from typing import Any, AsyncGenerator

from backend.agent import events
from backend.agent.streaming import complete_with_status
from backend.agent.playbook import GENERALIST_SYSTEM_PROMPT
from backend.agent.tools.registry import ToolRegistry
from backend.config.settings import get_settings
from backend.services.llm.model_router import TaskProfile, classify_intent, select_chain
from backend.services.llm.base import (
    AssistantMessage, LLMError, LLMMessage,
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = GENERALIST_SYSTEM_PROMPT


class Orchestrator:
    def __init__(
        self,
        *,
        provider: Any,
        registry: ToolRegistry,
        max_steps: int = 12,
        system_prompt: str = SYSTEM_PROMPT,
    ) -> None:
        self.provider = provider
        self.registry = registry
        self.max_steps = max_steps
        self.system_prompt = system_prompt

    @staticmethod
    def _context_directive(ctx: dict[str, Any]) -> str:
        """Turn the screen context into an explicit instruction so the agent
        defaults to the stock the user currently has open."""
        symbol = str(ctx.get("symbol") or "").strip().upper()
        market = str(ctx.get("market") or "").strip().upper()
        parts = [f"Current screen context: {json.dumps(ctx)}"]
        if symbol:
            hint = f"The user currently has {symbol} open"
            if market:
                hint += f" on {market}"
            parts.append(
                hint + ". Treat " + symbol + " as the default subject when the user refers to "
                '"this stock"/"it" or gives an ambiguous or partial company name without an '
                "explicit ticker. Resolve company names to the ticker for the user's market "
                + (f"({market}) " if market else "")
                + "before claiming a stock is unavailable."
            )
        elif market:
            parts.append(
                f"Resolve company names on the user's market ({market}) before claiming a "
                "stock is unavailable."
            )
        return "\n".join(parts)

    @staticmethod
    def _looks_like_screening_task(prompt: str) -> bool:
        text = prompt.lower()
        screening_terms = (
            "find", "screen", "screener", "scan", "filter", "shortlist",
            "rank", "stocks with", "companies with", "matching", "criteria",
        )
        metric_terms = (
            "pe", "p/e", "roe", "roce", "debt", "market cap", "growth",
            "margin", "dividend", "value", "quality", "momentum", "breakout",
        )
        return any(term in text for term in screening_terms) and any(term in text for term in metric_terms)

    @staticmethod
    def _screening_directive(prompt: str, screen_context: dict[str, Any] | None) -> str:
        market = str((screen_context or {}).get("market") or "").strip().upper()
        universe = "sp_500" if market == "US" else "nse_500"
        return (
            "This user request is a stock screening/filtering task. Before answering, call the "
            "screen_stocks tool exactly once using the user's criteria as the query unless a prior "
            "tool result in this run already contains screen_stocks output. "
            f"Default to market={market or 'IN'} and universe={universe} if the user does not specify them. "
            "Base the shortlist and explanation on the tool result's filters_applied, analysis, "
            "top_candidates, and results fields."
        )

    async def run(
        self, user_prompt: str, *, screen_context: dict[str, Any] | None = None,
        history: list[LLMMessage] | None = None, memory_directive: str | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        settings = get_settings()
        intent = classify_intent(user_prompt)
        tool_models = select_chain(
            TaskProfile(mode="deep" if self.max_steps > 12 else "standard", phase="tool_use", intent=intent),
            settings,
        )
        messages: list[LLMMessage | AssistantMessage] = [
            LLMMessage(role="system", content=self.system_prompt),
        ]
        if screen_context:
            messages.append(LLMMessage(
                role="system",
                content=self._context_directive(screen_context),
            ))
        if self._looks_like_screening_task(user_prompt):
            messages.append(LLMMessage(
                role="system",
                content=self._screening_directive(user_prompt, screen_context),
            ))
        if memory_directive:
            messages.append(LLMMessage(role="system", content=memory_directive))
        # Strict chat templates (vLLM/Qwen, some LM Studio models) accept a single system
        # message at index 0 — fold every directive into one block.
        system_parts = [m.content for m in messages if isinstance(m, LLMMessage) and m.role == "system" and m.content]
        messages = [LLMMessage(role="system", content="\n\n".join(system_parts))]
        if history:
            messages.extend(history)
        messages.append(LLMMessage(role="user", content=user_prompt))

        tool_defs = self.registry.tool_defs()
        tools_used = False
        yield events.model(tool_models[0], "tool_use")
        for _step in range(self.max_steps):
            try:
                assistant: AssistantMessage | None = None
                async for ev in complete_with_status(
                    self.provider, messages, tools=tool_defs, models=tool_models,
                ):
                    if ev["type"] == "result":
                        assistant = ev["message"]
                    else:
                        yield ev
                assert assistant is not None
            except LLMError as exc:
                yield events.error(str(exc))
                yield events.final("The model request failed; please try again.")
                return
            except Exception as exc:  # unexpected provider error: don't crash the stream
                logger.exception("Unexpected provider error")
                yield events.error(str(exc))
                yield events.final("The model request failed unexpectedly; please try again.")
                return

            if not assistant.tool_calls:
                original_answer = assistant.content or ""
                if not tools_used:
                    yield events.final(original_answer)
                    return
                messages.append(assistant)
                synthesis_models = select_chain(
                    TaskProfile(phase="synthesis", intent=intent), settings,
                )
                yield events.model(synthesis_models[0], "synthesis")
                try:
                    synthesis: AssistantMessage | None = None
                    async for ev in complete_with_status(
                        self.provider, messages, models=synthesis_models,
                    ):
                        if ev["type"] == "result":
                            synthesis = ev["message"]
                        else:
                            yield ev
                    assert synthesis is not None
                    if synthesis.model and synthesis.model != synthesis_models[0]:
                        yield events.model(synthesis.model, "synthesis")
                    yield events.final(synthesis.content or original_answer)
                except Exception as exc:
                    logger.warning("Synthesis model failed; using tool-loop answer: %s", exc)
                    yield events.final(original_answer)
                return

            messages.append(assistant)
            for call in assistant.tool_calls:
                tools_used = True
                yield events.tool_call(call.id, call.name, call.arguments)
                try:
                    result = await self.registry.execute(call.name, call.arguments)
                    is_error = False
                except Exception as exc:  # tool failures are fed back, not raised
                    logger.warning("Tool %s failed: %s", call.name, exc)
                    result = {"error": str(exc)}
                    is_error = True

                yield events.tool_result(call.id, call.name, result, is_error=is_error)
                if not is_error and call.name in events.ARTIFACT_KINDS:
                    yield events.artifact(
                        events.ARTIFACT_KINDS[call.name], call.name, result)

                messages.append(LLMMessage(
                    role="tool", tool_call_id=call.id,
                    content=json.dumps(result, default=str)[:8000],
                ))

        yield events.final(
            "I reached the step budget for this run. Here is what I gathered so far; "
            "ask a follow-up to continue.")
