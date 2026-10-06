from __future__ import annotations

import asyncio

from backend.agent.grounding import GroundingLedger, ground_text
from backend.agent.repair import build_repair_messages, needs_repair, repair_answer
from backend.services.llm.base import AssistantMessage

WRONG = "INFY's P/E is 25.0 and TCS's P/E is 27.4."
FIXED = "INFY's P/E is 24.1 and TCS's P/E is 27.4."


class FakeProvider:
    def __init__(self, content: str | None = None, *, exc: Exception | None = None, delay: float = 0.0):
        self.content, self.exc, self.delay = content, exc, delay
        self.calls: list[list] = []

    async def complete(self, messages, tools=None, *, models=None, max_tokens=1024, **kw):
        self.calls.append(messages)
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.exc:
            raise self.exc
        return AssistantMessage(content=self.content, tool_calls=[])


def _ledger() -> GroundingLedger:
    ledger = GroundingLedger()
    ledger.add("compare_stocks", {"rows": [{"symbol": "TCS", "pe": 27.43}, {"symbol": "INFY", "pe": 24.1}]})
    return ledger


def _run(provider, text=WRONG, **kw):
    ledger = _ledger()
    report = ground_text(text, ledger)
    return asyncio.run(repair_answer(provider, text, report, regrade=lambda t: ground_text(t, ledger), **kw)), report


def test_mismatch_fixed_is_applied():
    provider = FakeProvider(FIXED)
    (final, rep, info), report = _run(provider)
    sid = report["claims"][0]["source_id"]
    assert final == FIXED
    assert info["attempted"] and info["applied"]
    assert info["before"]["mismatch"] == 1 and info["after"]["mismatch"] == 0
    assert rep["summary"]["mismatch"] == 0
    assert info["changes"] == [{"from": "25.0", "to": "24.1", "source_id": sid}]
    assert info["reason"].startswith("1 figure(s) contradicted")
    assert set(info) == {"attempted", "applied", "before", "after", "changes", "reason"}


def test_fix_that_breaks_a_correct_figure_is_rejected():
    provider = FakeProvider("INFY's P/E is 24.1 and TCS's P/E is 29.9.")
    (final, rep, info), report = _run(provider)
    assert final == WRONG and rep is report
    assert info["attempted"] and not info["applied"]
    assert "not strictly better" in info["reason"]
    assert info["changes"] == []


def test_preamble_and_fences_are_stripped():
    provider = FakeProvider(f"Here is the revised answer:\n\n```markdown\n{FIXED}\n```")
    (final, _, info), _ = _run(provider)
    assert final == FIXED and info["applied"]


def test_reasoning_preamble_before_answer_is_dropped():
    original = "Valuation check for the two IT majors:\n" + WRONG
    fixed = "Valuation check for the two IT majors:\n" + FIXED
    provider = FakeProvider("Let me fix the INFY figure to match the source.\n\n" + fixed)
    (final, _, info), _ = _run(provider, original)
    assert final == fixed and info["applied"]


def test_empty_and_tiny_output_rejected():
    for content, needle in ((None, "empty"), ("", "empty"), ("P/E 24.1", "too short")):
        (final, _, info), _ = _run(FakeProvider(content))
        assert final == WRONG and not info["applied"] and needle in info["reason"]


def test_provider_error_and_timeout_do_not_propagate():
    (final, _, info), _ = _run(FakeProvider(exc=RuntimeError("boom")))
    assert final == WRONG and not info["applied"] and "RuntimeError" in info["reason"]
    (final, _, info), _ = _run(FakeProvider(FIXED, delay=1.0), timeout_s=0.05)
    assert final == WRONG and not info["applied"] and "Timeout" in info["reason"]


def test_regrade_crash_is_swallowed():
    ledger = _ledger()
    report = ground_text(WRONG, ledger)

    def bad(_t):
        raise ValueError("x")

    final, rep, info = asyncio.run(repair_answer(FakeProvider(FIXED), WRONG, report, regrade=bad))
    assert final == WRONG and rep is report and not info["applied"] and "ValueError" in info["reason"]


def test_only_unsourced_figures_skip_repair():
    provider = FakeProvider(FIXED)
    (final, rep, info), report = _run(provider, FIXED + " Combined that is 51.5.")
    assert report["summary"]["unsourced"] == 1 and report["summary"]["mismatch"] == 0
    assert not needs_repair(report)
    assert info == {"attempted": False, "applied": False, "before": report["summary"],
                    "after": report["summary"], "changes": [], "reason": "no contradictions"}
    assert provider.calls == [] and rep is report


def test_needs_repair_rules():
    assert needs_repair({"summary": {"mismatch": 1}})
    assert needs_repair({"summary": {"mismatch": 0, "statements_contradicted": 2}})
    assert not needs_repair({"summary": {"unsourced": 5}})
    assert not needs_repair({})
    assert not needs_repair({"summary": None})


def test_contradicted_statement_triggers_and_is_in_prompt():
    report = {
        "claims": [], "sources": [],
        "summary": {"total": 0, "verified": 0, "mismatch": 0, "statements_contradicted": 1},
        "statements": [
            {"text": "price is above its 50-day EMA", "status": "contradicted",
             "explanation": "price 310.0 < 50-day EMA 324.21"},
            {"text": "RSI is rising", "status": "verified", "explanation": "ok"},
        ],
    }
    assert needs_repair(report)
    user = build_repair_messages("AAPL price is above its 50-day EMA.", report)[1].content
    assert "price is above its 50-day EMA" in user and "324.21" in user
    assert "RSI is rising" not in user


def test_prompt_contains_source_value_tool_and_original():
    ledger = _ledger()
    ledger.add("get_stock_snapshot", {"price": 1500.0, "provenance": {"source": "yahoo", "quality": "delayed",
                                                                   "as_of": "2026-10-01"}},
               args={"ticker": "INFY"})
    report = ground_text(WRONG, ledger)
    msgs = build_repair_messages(WRONG, report)
    assert [m.role for m in msgs] == ["system", "user"]
    user = msgs[1].content
    assert "\"25.0\"" in user and "24.1" in user
    assert "compare_stocks" in user
    assert "<<<ORIGINAL_ANSWER>>>\n" + WRONG + "\n<<<END_ORIGINAL_ANSWER>>>" in user
    # provider/as_of rendered when the source reports them
    report["claims"][0]["source_id"] = "S2"
    user2 = build_repair_messages(WRONG, report)[1].content
    assert "provider yahoo" in user2 and "ticker INFY" in user2 and "2026-10-01" in user2
