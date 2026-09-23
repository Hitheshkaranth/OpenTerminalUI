"""Tests for backend/mcp/prompts.py."""

from __future__ import annotations

import pytest

EXPECTED_PROMPTS = {
    "morning_brief",
    "position_review",
    "screen_to_thesis",
    "risk_check",
    "idea_to_backtest",
}


def test_list_prompts_has_all_five():
    from backend.mcp.prompts import list_prompts

    names = {p["name"] for p in list_prompts()}
    assert names == EXPECTED_PROMPTS


def test_list_prompts_shape():
    from backend.mcp.prompts import list_prompts

    for p in list_prompts():
        assert set(p.keys()) == {"name", "description", "arguments"}
        assert isinstance(p["description"], str) and p["description"]
        for arg in p["arguments"]:
            assert set(arg.keys()) == {"name", "description", "required"}
            assert isinstance(arg["required"], bool)


def test_position_review_requires_ticker_arg():
    from backend.mcp.prompts import list_prompts

    spec = next(p for p in list_prompts() if p["name"] == "position_review")
    ticker_arg = next(a for a in spec["arguments"] if a["name"] == "ticker")
    assert ticker_arg["required"] is True


def test_risk_check_has_no_required_arguments():
    from backend.mcp.prompts import list_prompts

    spec = next(p for p in list_prompts() if p["name"] == "risk_check")
    assert spec["arguments"] == []


@pytest.mark.parametrize("name,args", [
    ("morning_brief", {}),
    ("morning_brief", {"market": "NSE"}),
    ("position_review", {"ticker": "NSE:RELIANCE"}),
    ("screen_to_thesis", {"criteria": "PE < 15 and ROE > 20"}),
    ("screen_to_thesis", {"criteria": "PE < 15", "market": "US"}),
    ("risk_check", {}),
    ("idea_to_backtest", {"idea": "buy the dip after a 5% drop"}),
])
def test_get_prompt_returns_valid_message_structure(name, args):
    from backend.mcp.prompts import get_prompt

    result = get_prompt(name, args)
    assert set(result.keys()) == {"description", "messages"}
    assert isinstance(result["description"], str) and result["description"]
    assert len(result["messages"]) >= 1
    for msg in result["messages"]:
        assert msg["role"] in {"user", "assistant"}
        assert msg["content"]["type"] == "text"
        assert isinstance(msg["content"]["text"], str) and msg["content"]["text"]


def test_get_prompt_unknown_name_raises_keyerror():
    from backend.mcp.prompts import get_prompt

    with pytest.raises(KeyError):
        get_prompt("does_not_exist", {})


@pytest.mark.parametrize("name,args", [
    ("position_review", {}),
    ("screen_to_thesis", {}),
    ("screen_to_thesis", {"market": "US"}),  # criteria omitted
    ("idea_to_backtest", {}),
])
def test_get_prompt_missing_required_argument_raises(name, args):
    from backend.mcp.prompts import get_prompt

    with pytest.raises(ValueError):
        get_prompt(name, args)


def test_get_prompt_missing_required_argument_handles_none_arguments():
    from backend.mcp.prompts import get_prompt

    with pytest.raises(ValueError):
        get_prompt("position_review", None)


@pytest.mark.parametrize("name,args", [
    ("morning_brief", {}),
    ("position_review", {"ticker": "AAPL"}),
    ("screen_to_thesis", {"criteria": "high momentum"}),
    ("risk_check", {}),
    ("idea_to_backtest", {"idea": "breakout above 50-day high"}),
])
def test_every_prompt_mentions_provenance(name, args):
    from backend.mcp.prompts import get_prompt

    result = get_prompt(name, args)
    text = " ".join(m["content"]["text"] for m in result["messages"]).lower()
    assert "provenance" in text
    assert "synthetic" in text


def test_prompts_name_real_tools():
    """Every prompt should drive at least one tool that actually exists in the registry."""
    from backend.mcp.prompts import get_prompt

    real_tool_names = {
        "screen_stocks", "get_stock_snapshot", "compare_stocks", "analyze_technicals",
        "scan_setups", "search_research", "get_portfolio", "get_paper_positions",
        "get_watchlists", "get_alerts", "get_upcoming_events", "get_provider_status",
        "propose_paper_order", "propose_alert", "propose_watchlist_add",
        "validate_backtest", "backtest_symbol", "backtest_basket",
    }

    cases = {
        "morning_brief": {},
        "position_review": {"ticker": "AAPL"},
        "screen_to_thesis": {"criteria": "high momentum"},
        "risk_check": {},
        "idea_to_backtest": {"idea": "breakout above 50-day high"},
    }
    for name, args in cases.items():
        result = get_prompt(name, args)
        text = " ".join(m["content"]["text"] for m in result["messages"])
        mentioned = {t for t in real_tool_names if f"`{t}`" in text}
        assert mentioned, f"{name} does not name any real tool"
