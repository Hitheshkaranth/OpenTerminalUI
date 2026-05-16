"""Tests for the shared Gemma-backed LLM insight helper."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from backend.services import llm_insights


def _settings(enabled: bool = True) -> SimpleNamespace:
    return SimpleNamespace(lm_studio_enabled=enabled, lm_studio_model="google/gemma-4-26b-a4b")


class _FakeClient:
    def __init__(self, content: str) -> None:
        self._content = content

    async def health(self) -> bool:
        return True

    async def chat(self, messages, **kwargs) -> str:  # noqa: ANN001
        return self._content


def test_run_insight_unavailable_when_disabled(monkeypatch) -> None:
    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings(False))
    result = asyncio.run(llm_insights.run_insight("system", "user"))
    assert result["engine"] == "unavailable"
    assert result["sections"] == []
    assert result["summary"]


def test_run_insight_parses_model_output(monkeypatch) -> None:
    content = (
        '{"summary":"Solid fundamentals with rising revenue.","sections":['
        '{"title":"Bull Case","tone":"positive","points":["Growing revenue","Strong ROE"]},'
        '{"title":"Bear Case","tone":"negative","points":["Stretched valuation"]}]}'
    )
    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings(True))
    monkeypatch.setattr(llm_insights, "get_lm_studio_client", lambda: _FakeClient(content))
    result = asyncio.run(llm_insights.run_insight("system", "user"))
    assert result["engine"] == "lmstudio"
    assert result["summary"] == "Solid fundamentals with rising revenue."
    assert len(result["sections"]) == 2
    assert result["sections"][0]["tone"] == "positive"
    assert result["sections"][0]["points"] == ["Growing revenue", "Strong ROE"]


def test_run_insight_falls_back_on_unparseable_output(monkeypatch) -> None:
    monkeypatch.setattr(llm_insights, "get_settings", lambda: _settings(True))
    monkeypatch.setattr(llm_insights, "get_lm_studio_client", lambda: _FakeClient("not json at all"))
    result = asyncio.run(llm_insights.run_insight("system", "user"))
    assert result["engine"] == "unavailable"


def test_sanitize_sections_filters_invalid() -> None:
    raw = [
        {"title": "Good", "tone": "weird", "points": ["a", "b"]},
        {"title": "", "tone": "positive", "points": ["x"]},
        {"title": "NoPoints", "tone": "negative", "points": []},
        "garbage",
    ]
    out = llm_insights._sanitize_sections(raw)
    assert len(out) == 1
    assert out[0]["title"] == "Good"
    assert out[0]["tone"] == "neutral"
    assert out[0]["points"] == ["a", "b"]
