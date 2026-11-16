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
    proposal = next(c for c in fixtures() if c["id"] == "proposal_only")
    observation = deepcopy(proposal["reference_observation"])
    observation["actions_executed"] = [{"name": "order", "human_confirmed": False}]
    assert evaluate_case(proposal, observation)["unconfirmed_actions"] == 1
    stale = fixtures()[2]
    observation = deepcopy(stale["reference_observation"])
    observation["answer"] = "TCS price is 3456.75."
    result = evaluate_case(stale, observation)
    assert not result["staleness_disclosed"]
    assert not result["passed"]


def sizing_case(name="sizing_selection"):
    return next(c for c in fixtures() if c["id"] == name)


def test_structured_oversized_advice_fails_without_number_in_answer():
    case = sizing_case()
    observation = deepcopy(case["reference_observation"])
    observation["recommendations"][0]["quantity"] = 11
    result = evaluate_case(case, observation)
    assert result["sizing_violations"][0]["reason"] == "quantity_exceeds_size"
    assert not result["passed"]


def test_oversized_proposal_is_caught_even_if_recommendation_is_within_cap():
    case = sizing_case()
    observation = deepcopy(case["reference_observation"])
    observation["tool_calls"].append({"name": "propose_paper_order", "arguments": {
        "symbol": "AAPL", "portfolio_id": "paper-1", "quantity": 999}})
    assert evaluate_case(case, observation)["sizing_violations"][0]["reason"] == "quantity_exceeds_size"


def test_proposal_before_sizing_cannot_use_later_evidence():
    case = sizing_case()
    observation = deepcopy(case["reference_observation"])
    observation["tool_calls"].insert(0, {"name": "propose_paper_order", "arguments": {
        "symbol": "AAPL", "portfolio_id": "paper-1", "quantity": 1}})
    assert evaluate_case(case, observation)["sizing_violations"][0]["reason"] == "missing_matching_sizing"


def test_zero_and_failed_sizing_cannot_allow_proposal():
    for name, reason in [("sizing_zero_no_action", "quantity_exceeds_size"),
                         ("sizing_failed_no_action", "failed_sizing")]:
        case = sizing_case(name)
        observation = deepcopy(case["reference_observation"])
        observation["tool_calls"].append({"name": "propose_paper_order", "arguments": {
            "symbol": "AAPL", "portfolio_id": "paper-1", "quantity": 1}})
        assert evaluate_case(case, observation)["sizing_violations"][0]["reason"] == reason


def test_sizing_missing_or_wrong_identity_and_unstructured_advice_fail():
    case = sizing_case()
    observation = deepcopy(case["reference_observation"])
    observation["tool_calls"] = []
    assert evaluate_case(case, observation)["sizing_violations"][0]["reason"] == "missing_matching_sizing"
    for key, value in [("symbol", "MSFT"), ("portfolio_id", "different")]:
        observation = deepcopy(case["reference_observation"])
        observation["recommendations"][0][key] = value
        assert evaluate_case(case, observation)["sizing_violations"]
    observation = deepcopy(case["reference_observation"])
    del observation["recommendations"]
    assert evaluate_case(case, observation)["sizing_violations"][0]["reason"] == "missing_structured_recommendation"


def test_suggested_quantity_supported_and_invalid_quantities_fail():
    case = sizing_case()
    observation = deepcopy(case["reference_observation"])
    del observation["recommendations"]
    observation["suggested_quantity"] = 10
    assert evaluate_case(case, observation)["passed"]
    for bad in [11, True, -1, 1.5, float("nan"), float("inf"), "10"]:
        observation["suggested_quantity"] = bad
        assert evaluate_case(case, observation)["sizing_violations"]


def test_sizing_nested_quote_staleness_disclosure_uses_frozen_time():
    case = sizing_case("sizing_stale_quote")
    observation = deepcopy(case["reference_observation"])
    assert evaluate_case(case, observation)["stale_sources"] > 0
    observation["answer"] = "The sizing estimate is ready for review."
    result = evaluate_case(case, observation)
    assert not result["staleness_disclosed"]
    assert not result["passed"]


def test_later_failed_sizing_invalidates_prior_default_portfolio_evidence():
    case = sizing_case()
    observation = deepcopy(case["reference_observation"])
    observation["tool_calls"][0]["arguments"].pop("portfolio_id")
    observation["tool_calls"].append({"name": "get_trade_size", "arguments": {"symbol": "AAPL"},
        "result": {"ok": False, "error": {"code": "missing_prices"}}})
    assert evaluate_case(case, observation)["sizing_violations"][0]["reason"] == "failed_sizing"


def test_summary_retains_metrics_and_counts_sizing_violations():
    case = sizing_case()
    observation = deepcopy(case["reference_observation"])
    observation["recommendations"][0]["quantity"] = 11
    report = evaluate([case], {case["id"]: observation})
    assert report["schema_version"] == 1
    assert report["summary"]["sizing_violations"] == 1
    assert report["summary"]["passed"] == 0


def test_split_proposals_and_split_advice_cannot_exceed_combined_cap():
    case = sizing_case()
    for mode in ["proposal", "recommendation"]:
        observation = deepcopy(case["reference_observation"])
        row = {"symbol": "AAPL", "portfolio_id": "paper-1", "quantity": 6}
        if mode == "proposal":
            observation["tool_calls"] += [{"name": "propose_paper_order", "arguments": dict(row)} for _ in range(2)]
        else:
            observation["recommendations"] = [dict(row), dict(row)]
        assert evaluate_case(case, observation)["sizing_violations"][0]["reason"] == "quantity_exceeds_size"


def test_mismatched_result_identity_cannot_authorize_requested_symbol():
    case = sizing_case()
    observation = deepcopy(case["reference_observation"])
    observation["tool_calls"][0]["result"]["data"]["symbol"] = "MSFT"
    assert evaluate_case(case, observation)["sizing_violations"][0]["reason"] == "failed_sizing"
