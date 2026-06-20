from backend.agent import playbook
from backend.agent.debate import roles


def test_compose_joins_non_empty_parts() -> None:
    assert playbook.compose("a", "", "  ", "b") == "a\n\nb"


def test_generalist_prompt_includes_read_only_notice_and_checklist() -> None:
    assert "read-only" in playbook.GENERALIST_SYSTEM_PROMPT.lower()
    assert "checklist" in playbook.GENERALIST_SYSTEM_PROMPT.lower()


def test_analysts_include_shared_evidence_discipline() -> None:
    for _, persona in roles.ANALYSTS:
        assert playbook.EVIDENCE_DISCIPLINE in persona


def test_portfolio_manager_preserves_decision_format_markers() -> None:
    assert "DECISION:" in roles.PORTFOLIO_MANAGER
    assert "CONVICTION:" in roles.PORTFOLIO_MANAGER


def test_analysts_have_expected_keys() -> None:
    assert len(roles.ANALYSTS) == 3
    assert [key for key, _ in roles.ANALYSTS] == [
        "fundamental",
        "sentiment",
        "technical",
    ]
