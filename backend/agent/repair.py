"""Self-repair for agent answers whose figures contradict their sources.

The grounding layer (``backend.agent.grounding``) *detects* a figure that disagrees with
the tool result it came from — the model wrote "INFY P/E 25.0" while the tool returned
24.1 — but a flagged wrong answer is still a wrong answer. ``repair_answer`` makes one
targeted revision call that lists each contradiction with the source value, then
re-grades the revision with the same deterministic check. The revision replaces the
original only if it is measurably better: fewer contradictions, no new mismatches, and
no correct figures lost. Otherwise the original (and its flags) stands.

Unsourced figures never trigger a repair: they are often the model's own arithmetic, and
forcing them out degrades answers.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any, Callable

from backend.services.llm.base import LLMMessage

_BEGIN = "<<<ORIGINAL_ANSWER>>>"
_END = "<<<END_ORIGINAL_ANSWER>>>"

_SYSTEM = (
    "You are a precise copy editor for a financial research assistant. You correct factual "
    "errors in an answer so it matches the data sources exactly, changing nothing else."
)

_PREAMBLE = re.compile(
    r"^\s*(?:\*\*)?(?:here(?:'s| is)\s+(?:the\s+)?(?:revised|corrected|updated|fixed)[^\n]*"
    r"|(?:revised|corrected|updated|fixed)\s+answer[^\n]*)\n+",
    re.IGNORECASE,
)
_FENCED = re.compile(r"^```[\w-]*\n(.*)\n```$", re.DOTALL)


def _summary(report: dict[str, Any] | None) -> dict[str, Any]:
    s = (report or {}).get("summary")
    return dict(s) if isinstance(s, dict) else {}


def _issues(summary: dict[str, Any]) -> int:
    return int(summary.get("mismatch", 0) or 0) + int(summary.get("statements_contradicted", 0) or 0)


def needs_repair(report: dict[str, Any]) -> bool:
    try:
        return _issues(_summary(report)) > 0
    except Exception:
        return False


def _describe_source(report: dict[str, Any], source_id: str | None) -> str:
    src = next((s for s in report.get("sources") or [] if s.get("id") == source_id), None)
    if not src:
        return f"source {source_id}" if source_id else "the tool data"
    args = src.get("args") or {}
    ticker = args.get("ticker") or args.get("symbol")
    bits = [f"tool {src.get('tool')}"]
    if ticker:
        bits.append(f"ticker {ticker}")
    if src.get("provider"):
        bits.append(f"provider {src['provider']}")
    if src.get("as_of"):
        bits.append(f"as of {src['as_of']}")
    return f"{source_id} ({', '.join(bits)})"


def build_repair_messages(text: str, report: dict[str, Any]) -> list[LLMMessage]:
    issues: list[str] = []
    for claim in report.get("claims") or []:
        if claim.get("status") != "mismatch":
            continue
        metric = f" for {claim['metric']}" if claim.get("metric") else ""
        subject = f" ({claim['subject']})" if claim.get("subject") else ""
        issues.append(
            f"- The answer writes \"{claim.get('text')}\"{metric}{subject}, but the source says "
            f"{claim.get('expected', claim.get('source_value'))} — {_describe_source(report, claim.get('source_id'))}."
        )
    for st in report.get("statements") or []:
        if st.get("status") != "contradicted":
            continue
        issues.append(
            f"- The statement \"{st.get('text')}\" is contradicted by the data: {st.get('explanation', '')}."
        )
    user = (
        "The answer below contains these errors against its data sources:\n"
        + "\n".join(issues)
        + "\n\nRewrite the answer correcting ONLY those items so they match the sources: fix each wrong "
        "number to the source value; rewrite a contradicted statement so it matches the evidence, or "
        "remove it. Keep everything else exactly as is — wording, structure, markdown, tables and all "
        "other figures. Do not add new figures. Do not mention that a correction was made. Output ONLY "
        "the revised answer: no preamble such as \"Here is\", no reasoning, no delimiters.\n\n"
        f"{_BEGIN}\n{text}\n{_END}"
    )
    return [LLMMessage(role="system", content=_SYSTEM), LLMMessage(role="user", content=user)]


def _clean(content: str, original: str) -> str:
    """Strip wrappers models add around the revised answer.

    Heuristic, kept small on purpose: (1) if the model echoed our delimiters, take what is
    between them; (2) local reasoning models may think aloud first — if the original's
    first line appears later in the output, start the answer there; (3) drop a leading
    "Here is the revised answer:" line and a fence wrapping the whole output.
    """
    out = content.strip()
    if _END in out:
        head = out.split(_END)[0]
        out = head.split(_BEGIN)[-1].strip()
    first = next((ln.strip() for ln in original.splitlines() if ln.strip()), "")
    if len(first) >= 12:
        idx = out.find(first[:40])
        if idx > 0:
            out = out[idx:]
    out = _PREAMBLE.sub("", out, count=1).strip()
    fenced = _FENCED.match(out)
    if fenced:
        out = fenced.group(1).strip()
    return out


def _info(attempted: bool, applied: bool, before: dict, after: dict, changes: list, reason: str) -> dict[str, Any]:
    return {"attempted": attempted, "applied": applied, "before": before, "after": after,
            "changes": changes, "reason": reason}


async def repair_answer(
    provider: Any,
    text: str,
    report: dict[str, Any],
    *,
    regrade: Callable[[str], dict[str, Any]],
    models: list[str] | None = None,
    max_tokens: int = 2048,
    timeout_s: float = 90.0,
) -> tuple[str, dict[str, Any], dict[str, Any]]:
    """Return ``(final_text, final_report, repair_info)``; never raises."""
    before = _summary(report)
    try:
        if not needs_repair(report):
            return text, report, _info(False, False, before, before, [], "no contradictions")

        def keep(reason: str) -> tuple[str, dict[str, Any], dict[str, Any]]:
            return text, report, _info(True, False, before, before, [], reason)

        try:
            resp = await asyncio.wait_for(
                provider.complete(build_repair_messages(text, report), tools=None,
                                  models=models, max_tokens=max_tokens),
                timeout_s,
            )
        except (asyncio.TimeoutError, TimeoutError):
            return keep(f"revision call failed: TimeoutError after {timeout_s:g}s")
        except Exception as exc:
            return keep(f"revision call failed: {type(exc).__name__}: {exc}"[:300])

        revised = _clean((getattr(resp, "content", None) or "").strip(), text)
        if not revised:
            return keep("revision was empty")
        if len(revised) < 0.5 * len(text):
            return keep(f"revision too short ({len(revised)} vs {len(text)} chars)")

        new_report = regrade(revised)
        after = _summary(new_report)
        mm_b, mm_a = int(before.get("mismatch", 0) or 0), int(after.get("mismatch", 0) or 0)
        ver_b, ver_a = int(before.get("verified", 0) or 0), int(after.get("verified", 0) or 0)
        un_b, un_a = int(before.get("unsourced", 0) or 0), int(after.get("unsourced", 0) or 0)
        # Removing a wrong figure is fine; losing a correct one, or inventing new ones, is not.
        better = _issues(after) < _issues(before) and ver_a >= ver_b - mm_b and mm_a <= mm_b and un_a <= un_b
        if not better:
            return text, report, _info(
                True, False, before, after, [],
                f"revision not strictly better (issues {_issues(before)} -> {_issues(after)}, "
                f"verified {ver_b} -> {ver_a}, mismatch {mm_b} -> {mm_a})",
            )

        verified = {(c.get("source_id"), c.get("path")): c for c in new_report.get("claims") or []
                    if c.get("status") == "verified"}
        changes = []
        for old in report.get("claims") or []:
            if old.get("status") != "mismatch":
                continue
            new = verified.get((old.get("source_id"), old.get("path")))
            if new is not None:
                changes.append({"from": old.get("text"), "to": new.get("text"), "source_id": old.get("source_id")})

        stmts = int(before.get("statements_contradicted", 0) or 0)
        parts = [f"{mm_b} figure(s) contradicted their sources" if mm_b else "",
                 f"{stmts} statement(s) contradicted the data" if stmts else ""]
        reason = "; ".join(p for p in parts if p)
        return revised, new_report, _info(True, True, before, after, changes, reason)
    except Exception as exc:
        return text, report, _info(True, False, before, before, [], f"repair failed: {type(exc).__name__}")
