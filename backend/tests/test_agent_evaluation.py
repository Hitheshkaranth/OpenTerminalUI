import json
from pathlib import Path
from copy import deepcopy
from backend.evaluation.agent import evaluate, evaluate_case


def fixtures():
    return json.loads((Path(__file__).parents[1] / "evaluation/fixtures/agent_research.json").read_text())


def test_reference_cases_pass_and_unmeasured_costs_stay_unknown():
    cases = fixtures()
    report = evaluate(cases, {c["id"]: c["reference_observation"] for c in cases})
    assert report["summary"]["passed"] == len(cases)
    assert report["summary"]["measured_cost_usd"] is None
    assert report["summary"]["mean_latency_ms"] is None


def test_wrong_tool_argument_and_unsupported_claim_fail():
    case = fixtures()[0]
    observation = deepcopy(case["reference_observation"])
    observation["answer"] = "TCS P/E is 99.9."
    observation["tool_calls"][0]["arguments"]["ticker"] = "WRONG"
    result = evaluate_case(case, observation)
    assert not result["passed"]
    assert result["tool_correctness"] == 0
    assert result["unsupported_claims"] > 0


def test_unconfirmed_action_and_missing_staleness_disclosure_fail():
    proposal = fixtures()[-1]
    observation = deepcopy(proposal["reference_observation"])
    observation["actions_executed"] = [{"name": "order", "human_confirmed": False}]
    assert evaluate_case(proposal, observation)["unconfirmed_actions"] == 1
    stale = fixtures()[2]
    observation = deepcopy(stale["reference_observation"])
    observation["answer"] = "TCS price is 3456.75."
    result = evaluate_case(stale, observation)
    assert not result["staleness_disclosed"]
    assert not result["passed"]
