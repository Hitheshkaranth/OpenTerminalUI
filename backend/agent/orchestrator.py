from __future__ import annotations

import json
import logging
from typing import Any, AsyncGenerator

from backend.agent import events
from backend.agent.playbook import GENERALIST_SYSTEM_PROMPT
from backend.agent.tools.registry import ToolRegistry
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

    async def run(
        self, user_prompt: str, *, screen_context: dict[str, Any] | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        messages: list[LLMMessage | AssistantMessage] = [
            LLMMessage(role="system", content=self.system_prompt),
        ]
        if screen_context is not None:
            messages.append(LLMMessage(
                role="system",
                content="Current screen context: " + json.dumps(screen_context),
            ))
        messages.append(LLMMessage(role="user", content=user_prompt))

        tool_defs = self.registry.tool_defs()
        for _step in range(self.max_steps):
            try:
                assistant = await self.provider.complete(messages, tools=tool_defs)
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
                yield events.final(assistant.content or "")
                return

            messages.append(assistant)
            for call in assistant.tool_calls:
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
