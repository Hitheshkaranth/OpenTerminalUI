from __future__ import annotations

import asyncio
from typing import Any, AsyncGenerator

from backend.agent import events
from backend.agent.debate import roles
from backend.agent.orchestrator import Orchestrator
from backend.agent.streaming import complete_with_status
from backend.config.settings import get_settings
from backend.services.llm.base import LLMMessage
from backend.services.llm.model_router import TaskProfile, select_chain


class DebateOrchestrator:
    """Coordinates independent analysts and a short bull/bear investment debate."""

    def __init__(self, *, provider: Any, registry: Any, analyst_max_steps: int = 4) -> None:
        self.provider = provider
        self.registry = registry
        self.analyst_max_steps = analyst_max_steps

    async def _collect_analyst(
        self, role_key: str, system_prompt: str, subject: str,
        screen_context: dict[str, Any] | None,
    ) -> tuple[list[dict[str, Any]], str]:
        passthrough: list[dict[str, Any]] = []
        note = ""
        try:
            orchestrator = Orchestrator(
                provider=self.provider,
                registry=self.registry,
                max_steps=self.analyst_max_steps,
                system_prompt=system_prompt,
            )
            async for event in orchestrator.run(
                f"Analyze {subject}. Give a tight verdict with evidence.",
                screen_context=screen_context,
            ):
                if event.get("type") in {"tool_call", "tool_result", "error"}:
                    passthrough.append(event)
                elif event.get("type") == "final":
                    note = str(event.get("content") or "")
        except Exception as exc:  # defensive: one analyst must not abort the debate
            passthrough.append(events.error(str(exc)))
            note = f"{role_key} analysis was unavailable."
        return passthrough, note

    # Per-note cap kept modest so the combined bull/bear/PM context stays well
    # within small (free-tier) model context windows — large prompts caused some
    # models to return empty completions.
    _NOTE_CAP = 2500

    @staticmethod
    def _analyst_context(notes: dict[str, str]) -> str:
        return "\n\n".join(
            f"{role.upper()} ANALYST NOTE:\n{notes.get(role, '')[:DebateOrchestrator._NOTE_CAP]}"
            for role, _ in roles.ANALYSTS
        )

    async def _complete(self, system: str, user: str, role: str):
        """One LLM turn that tolerates empty completions, streaming progress.

        Some models intermittently return empty content on long prompts; retry
        once with a shorter prompt before giving up. Yields ``status`` events as
        the model layer works, then a single ``result`` event carrying
        ``(content, model)`` (content is '' if still empty).
        """
        models = select_chain(TaskProfile(phase="synthesis", role=role), get_settings())
        for user_text in (user, user[:4000]):
            response = None
            async for ev in complete_with_status(
                self.provider,
                [LLMMessage(role="system", content=system), LLMMessage(role="user", content=user_text)],
                tools=None,
                # Headroom for reasoning models (e.g. gpt-oss): a tight token cap
                # gets consumed by reasoning and yields empty content on long prompts.
                max_tokens=1536,
                models=models,
            ):
                if ev["type"] == "result":
                    response = ev["message"]
                else:
                    yield ev
            content = (response.content or "").strip()
            if content:
                yield {"type": "result", "content": content, "model": response.model or models[0]}
                return
        yield {"type": "result", "content": "", "model": models[0]}

    async def run(
        self, subject: str, *, screen_context: dict[str, Any] | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Yield a complete debate stream, containing one and only one final event."""
        try:
            yield events.phase("analysts", "Analyst team")
            # Local servers and free tiers generally need serialized requests.
            # Provider retry/backoff handles actual 429s instead of unconditional sleeps.
            model = str(getattr(self.provider, "model", ""))
            base_url = str(getattr(self.provider, "base_url", ""))
            constrained = (getattr(self.provider, "honor_model_chain", True) is False
                           or ":free" in model or "generativelanguage" in base_url)
            concurrency = 1 if constrained else 3
            semaphore = asyncio.Semaphore(concurrency)
            async def collect(role, prompt):
                async with semaphore:
                    return await self._collect_analyst(role, prompt, subject, screen_context)
            results = await asyncio.gather(*(collect(role, prompt) for role, prompt in roles.ANALYSTS))
            notes: dict[str, str] = {}
            for (role, _), (passthrough, note) in zip(roles.ANALYSTS, results):
                for event in passthrough:
                    yield event
                notes[role] = note
                yield events.role_message(role, note)

            yield events.phase("debate", "Bull vs Bear")
            analyst_context = self._analyst_context(notes)
            bull = bull_model = ""
            try:
                async for ev in self._complete(roles.BULL_RESEARCHER, analyst_context, "bull"):
                    if ev["type"] == "result":
                        bull, bull_model = ev["content"], ev["model"]
                    else:
                        yield ev
            except Exception as exc:
                yield events.error(str(exc))
                bull = ""
                bull_model = ""
            bull = bull or "Bull case unavailable (model returned no content)."
            if bull_model:
                yield events.model(bull_model, "synthesis")
            yield events.role_message("bull", bull)
            bear = bear_model = ""
            try:
                async for ev in self._complete(roles.BEAR_RESEARCHER, analyst_context, "bear"):
                    if ev["type"] == "result":
                        bear, bear_model = ev["content"], ev["model"]
                    else:
                        yield ev
            except Exception as exc:
                yield events.error(str(exc))
                bear = ""
                bear_model = ""
            bear = bear or "Bear case unavailable (model returned no content)."
            if bear_model:
                yield events.model(bear_model, "synthesis")
            yield events.role_message("bear", bear)

            yield events.phase("decision", "Portfolio manager")
            decision_context = f"{analyst_context}\n\nBULL CASE:\n{bull}\n\nBEAR CASE:\n{bear}"
            decision = decision_model = ""
            try:
                async for ev in self._complete(
                    roles.PORTFOLIO_MANAGER, decision_context, "portfolio_manager",
                ):
                    if ev["type"] == "result":
                        decision, decision_model = ev["content"], ev["model"]
                    else:
                        yield ev
            except Exception as exc:
                yield events.error(str(exc))
                decision = ""
                decision_model = ""
            # Guarantee the final always carries a usable DECISION line, even if
            # the model returned empty content or omitted the required format.
            if "DECISION:" not in decision:
                decision = (
                    f"{decision}\n\n" if decision.strip() else ""
                ) + "DECISION: HOLD | CONVICTION: 0 | Portfolio manager returned no decision; defaulting to HOLD."
            if decision_model:
                yield events.model(decision_model, "synthesis")
            yield events.final(decision)
        except Exception as exc:  # final defensive boundary for all coordinator failures
            yield events.error(str(exc))
            yield events.final(
                "Unable to complete the debate.\n"
                "DECISION: HOLD | CONVICTION: 0 | The debate coordinator encountered an unexpected error."
            )
