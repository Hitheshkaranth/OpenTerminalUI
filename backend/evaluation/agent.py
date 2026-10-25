"""Score captured agent runs against fixtures; never calls an LLM or data provider.

Without --observations, exercises the deterministic evaluator with reference responses.
With --observations, scores actual captured runs keyed by fixture ID.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

from backend.agent.grounding import GroundingLedger, ground_text
from backend.agent.reconcile import find_stale


def evaluate_case(case: dict, observation: dict) -> dict:
    calls = observation.get("tool_calls", [])
    expected = case.get("expected_tools", [])
    matched = []
    for requirement in expected:
        matched.append(any(call.get("name") == requirement["name"] and
            all(call.get("arguments", {}).get(k) == v for k, v in requirement.get("arguments", {}).items()) for call in calls))
    forbidden = [call["name"] for call in calls if call.get("name") in case.get("forbidden_tools", [])]
    ledger = GroundingLedger(case["prompt"])
    for idx, call in enumerate(calls):
        if "result" in call:
            ledger.add(call["name"], call["result"], args=call.get("arguments", {}), call_id=str(idx))
    answer = observation.get("answer", "")
    report = ground_text(answer, ledger)
    summary = report["summary"]
    unsupported = summary["mismatch"] + summary["unsourced"]
    contradicted = summary.get("statements_contradicted", 0)
    snippets = case.get("required_answer_fragments", [])
    complete = bool(answer.strip()) and all(s.lower() in answer.lower() for s in snippets)
    now = datetime.fromisoformat(case["evaluation_time"].replace("Z", "+00:00")) if case.get("evaluation_time") else datetime.now(timezone.utc)
    stale = find_stale(ledger, now=now)
    disclosed = not stale or any(word in answer.lower() for word in ("stale", "outdated", "old data"))
    approved = observation.get("actions_executed", [])
    unauthorized = [a for a in approved if not a.get("human_confirmed", False)]
    success = all(matched) and not forbidden and not unsupported and not contradicted and complete and disclosed and not unauthorized
    return {"id": case["id"], "passed": success, "tool_requirements": len(expected), "tools_correct": sum(matched),
        "tool_correctness": sum(matched) / len(expected) if expected else None,
        "claims_checked": summary["total"], "unsupported_claims": unsupported,
        "unsupported_claim_rate": unsupported / summary["total"] if summary["total"] else None,
        "contradicted_statements": contradicted, "stale_sources": len(stale), "staleness_disclosed": disclosed,
        "task_completed": complete, "forbidden_tools": forbidden, "unconfirmed_actions": len(unauthorized),
        "latency_ms": observation.get("latency_ms"), "cost_usd": observation.get("cost_usd")}


def evaluate(cases: list[dict], observations: dict[str, dict]) -> dict:
    rows = [evaluate_case(case, observations.get(case["id"], {})) for case in cases]
    total_claims = sum(r["claims_checked"] for r in rows)
    unsupported = sum(r["unsupported_claims"] for r in rows)
    tool_total = sum(r["tool_requirements"] for r in rows)
    measured_latency = [r["latency_ms"] for r in rows if isinstance(r["latency_ms"], (int, float))]
    measured_cost = [r["cost_usd"] for r in rows if isinstance(r["cost_usd"], (int, float))]
    return {"schema_version": 1, "cases": rows, "summary": {"total": len(rows), "passed": sum(r["passed"] for r in rows),
        "task_completion_rate": sum(r["task_completed"] for r in rows) / len(rows) if rows else 0,
        "tool_correctness": sum(r["tools_correct"] for r in rows) / tool_total if tool_total else None,
        "unsupported_claim_rate": unsupported / total_claims if total_claims else None,
        "mean_latency_ms": sum(measured_latency) / len(measured_latency) if measured_latency else None,
        "measured_cost_usd": sum(measured_cost) if measured_cost else None,
        "latency_observation_count": len(measured_latency), "cost_observation_count": len(measured_cost)}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", type=Path, default=Path(__file__).parent / "fixtures" / "agent_research.json")
    parser.add_argument("--observations", type=Path, help="Actual run outputs keyed by fixture id")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    cases = json.loads(args.fixtures.read_text())
    observations = json.loads(args.observations.read_text()) if args.observations else {c["id"]: c["reference_observation"] for c in cases}
    result = evaluate(cases, observations)
    result["mode"] = "captured_runs" if args.observations else "reference_fixture_self_check"
    text = json.dumps(result, indent=2)
    if args.output:
        args.output.write_text(text + "\n")
    print(text)
    return 0 if result["summary"]["passed"] == result["summary"]["total"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
