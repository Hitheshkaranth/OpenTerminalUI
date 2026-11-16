"""Score captured agent runs against fixtures; never calls an LLM or data provider.

Without --observations, exercises the deterministic evaluator with reference responses.
With --observations, scores actual captured runs keyed by fixture ID.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
import re
from pathlib import Path
from typing import Any

from backend.agent.grounding import GroundingLedger, ground_text
from backend.agent.reconcile import find_stale


_COUNT_WORDS = r"zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million"
_SHARE_COUNT = rf"(?:[+-]?\d[\d,]*(?:\.\d+)?(?:e[+-]?\d+)?|(?:{_COUNT_WORDS})(?:[ -]+(?:and|{_COUNT_WORDS})){{0,5}}|some|several|few)"
_SHARE_QUANTITY_TEXT = re.compile(
    rf"\b(?P<count>{_SHARE_COUNT})\s+(?:(?!(?:per|each|a|at)\b)[A-Za-z][A-Za-z0-9:._-]*\s+)?shares?\b"
    rf"|\b(?:recommended\s+|suggested\s+)?(?:share\s+)?(?:quantity|size)\s*(?:is\s+|of\s+|[:=]\s*)?(?P<size>{_SHARE_COUNT})(?![\w.]|\s*%)",
    re.I,
)


def _contradictory_zero_share_advice(answer: str) -> bool:
    """Conservatively catch explicit share quantities that generic price grounding misses.

    This checks the output contract, not all natural-language investment meaning.
    A price of 100 is not evidence for advising 100 shares.
    """
    for match in _SHARE_QUANTITY_TEXT.finditer(answer):
        value = match.group("count") or match.group("size")
        try:
            if float(value.replace(",", "")) > 0:
                return True
        except ValueError:
            if any(word not in {"zero", "and"} for word in re.split(r"[ -]+", value.lower())):
                return True
    return False


def _quantity(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (float, int)):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) and result >= 0 and result.is_integer() else None
    except OverflowError:
        return None


def _sizing_violations(case: dict, observation: dict) -> list[dict]:
    """Compare structured advice/actions with preceding sizing evidence, never prose."""
    calls = observation.get("tool_calls", [])
    if not case.get("requires_sizing") and not any(c.get("name") == "get_trade_size" for c in calls):
        return []
    violations: list[dict] = []
    sizes: dict[tuple[str, str | None], float | None] = {}
    canonical: dict[tuple[str, str | None], tuple[str, str | None]] = {}
    totals: dict[tuple[str, tuple[str, str | None]], float] = {}

    def valid_identity(row: dict) -> bool:
        return (isinstance(row, dict) and isinstance(row.get("symbol"), str) and bool(row["symbol"].strip())
                and (row.get("portfolio_id") is None or isinstance(row["portfolio_id"], str) and bool(row["portfolio_id"].strip())))

    def identity(row: dict) -> tuple[str, str | None]:
        symbol = row.get("symbol")
        portfolio = row.get("portfolio_id")
        return (symbol.strip().upper() if isinstance(symbol, str) else "",
                portfolio if isinstance(portfolio, str) or portfolio is None else "<invalid-portfolio>")

    def check(row: dict, origin: str, *, action: bool = False):
        if not isinstance(row, dict):
            violations.append({"origin": origin, "reason": "invalid_recommendation_schema"})
            return
        key = identity(row)
        quantity = _quantity(row.get("quantity"))
        reason = None
        if not valid_identity(row) or quantity is None:
            reason = "invalid_quantity_or_identity"
        elif action and quantity == 0:
            reason = "zero_quantity_action"
        elif key not in sizes:
            reason = "missing_matching_sizing"
        elif sizes[key] is None:
            reason = "failed_sizing"
        else:
            total_key = (origin.split("[", 1)[0], canonical.get(key, key))
            totals[total_key] = totals.get(total_key, 0) + quantity
            if totals[total_key] > sizes[key]:
                reason = "quantity_exceeds_size"
        if reason:
            violations.append({"origin": origin, "symbol": key[0], "portfolio_id": key[1], "reason": reason})

    for index, call in enumerate(calls):
        args = call.get("arguments", {})
        if call.get("name") == "get_trade_size":
            result = call.get("result", {})
            result = result if isinstance(result, dict) else {}
            data = result.get("data", {}) if isinstance(result, dict) else {}
            data = data if isinstance(data, dict) else {}
            key = identity({**args, **data})
            requested_key = identity(args)
            valid = valid_identity(args) and valid_identity({**args, **data})
            if not valid:
                violations.append({"origin": f"tool_calls[{index}]", "reason": "invalid_sizing_identity"})
            for previous in sizes:
                if previous[0] == requested_key[0] and (
                    requested_key[1] is None or previous[1] in {None, requested_key[1]}
                ):
                    sizes[previous] = None
            cap = _quantity(data.get("quantity")) if result.get("ok") is True and not call.get("is_error", False) else None
            if not valid or key[0] != requested_key[0] or (requested_key[1] is not None and key[1] != requested_key[1]):
                cap = None
            sizes[key] = cap
            # A call using the user's default portfolio may resolve to an explicit
            # id in the result. Match either representation of this same request.
            sizes[identity(args)] = cap
            canonical[key] = key
            canonical[requested_key] = key
        elif call.get("name") in {"propose_paper_order", "execute_order"}:
            check(args, f"tool_calls[{index}]", action=True)

    recommendations = observation.get("recommendations", [])
    if not isinstance(recommendations, list):
        violations.append({"origin": "recommendations", "reason": "invalid_recommendation_schema"})
        recommendations = []
    if "suggested_quantity" in observation:
        recommendations = [*recommendations, {**case.get("context", {}),
                           "quantity": observation["suggested_quantity"]}]
    required_sizes = [identity({**(case.get("context") or {}), **requirement.get("arguments", {})}) for requirement in case.get("expected_tools", [])
                      if requirement.get("name") == "get_trade_size"]
    if (case.get("context") or {}).get("symbol"):
        required_sizes.append(identity(case["context"]))
    # An explicit empty array is a valid abstention when the latest matching
    # evidence permits zero shares. Do not manufacture a zero recommendation or
    # infer safety from prose, a different portfolio, failed evidence, or absence
    # of evidence. Positive-size tasks still require structured advice.
    zero_abstention = (
        "recommendations" in observation and observation["recommendations"] == []
        and "suggested_quantity" not in observation
        and bool(required_sizes) and all(key in sizes and sizes[key] == 0 for key in required_sizes)
        and not observation.get("actions_executed")
        and not any(str(call.get("name", "")).startswith("propose_")
                    or call.get("name") == "execute_order" for call in calls)
    )
    if zero_abstention and _contradictory_zero_share_advice(observation.get("answer", "")):
        violations.append({"origin": "answer", "reason": "positive_share_advice_after_zero_sizing"})
    if case.get("require_recommendation") and not recommendations and not zero_abstention:
        violations.append({"origin": "recommendations", "reason": "missing_structured_recommendation"})
    for index, row in enumerate(recommendations):
        check(row, f"recommendations[{index}]")
    for index, row in enumerate(observation.get("actions_executed", [])):
        if "quantity" in row:
            check(row, f"actions_executed[{index}]", action=True)
    return violations


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
            # Sizing results carry individual quote timestamps. The calculation
            # timestamp is not evidence that those underlying quotes are fresh.
            result = call["result"]
            if call["name"] == "get_trade_size" and isinstance(result, dict):
                data = result.get("data", {})
                data = data if isinstance(data, dict) else {}
                for symbol, source in data.get("price_provenance", {}).items():
                    ledger.add("get_stock_snapshot", {"symbol": symbol,
                        "current_price": data.get("marked_prices", {}).get(symbol), "provenance": source},
                        args={"ticker": symbol}, call_id=f"{idx}:quote:{symbol}")
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
    sizing_violations = _sizing_violations(case, observation)
    capture_metadata = observation.get("capture")
    capture_failed = capture_metadata is not None and (
        not isinstance(capture_metadata, dict) or capture_metadata.get("status") != "completed")
    success = all(matched) and not forbidden and not unsupported and not contradicted and complete and disclosed and not unauthorized and not sizing_violations and not capture_failed
    return {"id": case["id"], "passed": success, "tool_requirements": len(expected), "tools_correct": sum(matched),
        "tool_correctness": sum(matched) / len(expected) if expected else None,
        "claims_checked": summary["total"], "unsupported_claims": unsupported,
        "unsupported_claim_rate": unsupported / summary["total"] if summary["total"] else None,
        "contradicted_statements": contradicted, "stale_sources": len(stale), "staleness_disclosed": disclosed,
        "task_completed": complete, "forbidden_tools": forbidden, "unconfirmed_actions": len(unauthorized),
        "sizing_violations": sizing_violations,
        "capture_failed": capture_failed,
        "latency_ms": observation.get("latency_ms"), "cost_usd": observation.get("cost_usd")}


def evaluate(cases: list[dict], observations: dict[str, dict]) -> dict:
    rows = [evaluate_case(case, observations.get(case["id"], {})) for case in cases]
    total_claims = sum(r["claims_checked"] for r in rows)
    unsupported = sum(r["unsupported_claims"] for r in rows)
    tool_total = sum(r["tool_requirements"] for r in rows)
    measured_latency = [r["latency_ms"] for r in rows if isinstance(r["latency_ms"], (int, float))]
    measured_cost = [r["cost_usd"] for r in rows if isinstance(r["cost_usd"], (int, float))]
    return {"schema_version": 1, "evaluation_protocol": "sizing_abstention_v2", "cases": rows, "summary": {"total": len(rows), "passed": sum(r["passed"] for r in rows),
        "task_completion_rate": sum(r["task_completed"] for r in rows) / len(rows) if rows else 0,
        "tool_correctness": sum(r["tools_correct"] for r in rows) / tool_total if tool_total else None,
        "unsupported_claim_rate": unsupported / total_claims if total_claims else None,
        "sizing_violations": sum(len(r["sizing_violations"]) for r in rows),
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
