"""Tests for the filings-intelligence analysis stack (agent B).

Cross-agent surface (backend.filings_rag.retrieve.search, store.get_chunks) is
monkeypatched so nothing touches the network or a real LLM; the LLM entry
backend.filings_rag.analyze.complete_json / llm_available are monkeypatched.
DB-only code (analysis persistence) runs against the conftest throwaway SQLite DB.
"""

from __future__ import annotations

import backend.filings_rag.analyze as analyze
import pytest
from backend.filings_rag import taxonomy
from backend.filings_rag.llm import citation_for, verify_quote
from fastapi import FastAPI
from fastapi.testclient import TestClient


# --------------------------------------------------------------------------- fixtures
@pytest.fixture
def session():
    from sqlalchemy.orm import sessionmaker
    from backend.filings_rag.models import FilingAnalysisORM
    from backend.shared.db import Base, engine

    Base.metadata.create_all(bind=engine, tables=[FilingAnalysisORM.__table__])
    Session = sessionmaker(bind=engine)
    s = Session()
    yield s
    s.rollback()
    s.close()


@pytest.fixture
def chunks():
    return [
        {
            "id": 101, "document_id": 501, "title": "Annual Report FY24",
            "doc_type": "annual_report", "period": "2023-24", "filed_at": "2024-08-01",
            "source_url": None, "page_start": 12, "page_end": 14,
            "section": "MD&A", "score": 0.95,
            "text": ("The company secured an order book of ₹45,000 crore this fiscal year, "
                     "up 32% year on year. Gross margin contracted 200 bps to 58.1% amid "
                     "rising raw-material costs."),
        },
        {
            "id": 102, "document_id": 502, "title": "Investor Presentation",
            "doc_type": "investor_presentation", "period": "2024-06", "filed_at": "2024-07-15",
            "source_url": "https://example.com/investor", "page_start": 3, "page_end": 5,
            "section": None, "score": 0.85,
            "text": ("Management is guiding full-year revenue growth of 15% for FY25, driven by "
                     "strong demand. Net debt stood at ₹1,200 crore with interest coverage of 6.8x."),
        },
        {
            "id": 103, "document_id": 503, "title": "USFDA Notification",
            "doc_type": "regulatory", "period": "2024-02", "filed_at": "2024-02-20",
            "source_url": "https://example.com/fda", "page_start": 1, "page_end": 1,
            "section": "Regulatory", "score": 0.80,
            "text": "The USFDA issued a warning letter with Form 483 observations during the January inspection.",
        },
    ]


def _stub_retrieval(monkeypatch, chunks_list, llm_available=False, disable_lexical=False):
    monkeypatch.setattr(analyze, "store_get_chunks", lambda db, symbol: list(chunks_list))
    monkeypatch.setattr(analyze, "retrieve_search",
                        lambda *a, **k: list(chunks_list))
    monkeypatch.setattr(analyze, "llm_available", lambda: llm_available)
    if disable_lexical:
        monkeypatch.setattr(analyze, "_extract_lexical_findings",
                            lambda chunks, keywords: [])


def _finding(chunk_id, magnitude, confidence, metric="Metric", value=1.0, unit="unit", quote=None):
    return {
        "claim": "test claim", "quote": quote or QUOTE_101, "chunk_id": chunk_id,
        "metric": metric, "value": value, "unit": unit,
        "period": "FY24", "magnitude": magnitude, "confidence": confidence,
    }


def _find_driver(result, driver_id):
    merged = result["growth"] + result["headwinds"]
    return next(d for d in merged if d["id"] == driver_id)


# quote 101 substring used by LLM-path tests
QUOTE_101 = ("order book of ₹45,000 crore this fiscal year, up 32% year on year")
LABELS = [d["label"] for d in taxonomy.DRIVERS]


def _detect_label(prompt):
    for label in LABELS:
        if f"DRIVER: {label}" in prompt:
            return label
    return None


class _LLMPlan:
    """Mutable plan consumed by the monkeypatched complete_json, keyed by driver label."""
    def __init__(self):
        self.by_label: dict[str, list[dict]] = {}

    def set(self, label, findings):
        self.by_label[label] = findings

    async def __call__(self, system, user, *, max_tokens=1200):
        label = _detect_label(user)
        findings = self.by_label.get(label)
        if findings is None:
            return {"findings": [], "summary": ""}
        return {"findings": findings, "summary": "plan"}


@pytest.fixture
def llm_plan(monkeypatch):
    plan = _LLMPlan()
    monkeypatch.setattr(analyze, "complete_json", plan)
    return plan


# --------------------------------------------------------------------------- verify_quote
def test_verify_quote_exact_and_case_insensitive():
    text = "The company secured an order book of ₹45,000 crore this fiscal year."
    assert verify_quote("order book of ₹45,000 crore", text) is True
    assert verify_quote("ORDER BOOK OF ₹45,000 CRORE", text) is True


def test_verify_quote_accepts_single_word_edit_but_not_changed_number():
    text = "the company secured an order book of 45000 crore this fiscal year"
    # one non-numeric word differs: still the same statement
    assert verify_quote("the company won an order book of 45000 crore this fiscal year", text) is True
    # QC: a changed figure is a different claim and must never verify (this test used to assert True)
    assert verify_quote("the company secured an order book of 46000 crore this fiscal year", text) is False


def test_verify_quote_rejects_unrelated_quote():
    text = "the company secured an order book of 45000 crore this fiscal year"
    assert verify_quote("gross margin contracted 200 bps to 58 percent", text) is False


def test_verify_quote_rejects_empty():
    assert verify_quote("", "anything") is False
    assert verify_quote("something", "") is False


def test_verify_quote_truncated_match():
    text = "the company secured an order book of 45000 crore this fiscal year"
    # drop the final token -> still a verbatim prefix, so a substring match
    assert verify_quote("the company secured an order book of 45000", text) is True


# --------------------------------------------------------------------------- citation_for
def test_citation_for_shapes_citation_and_trims_quote():
    chunk = {
        "document_id": 501, "title": "Annual Report", "page_start": 12, "page_end": 14,
        "section": "MD&A", "source_url": "https://example.com",
    }
    citation = citation_for(chunk, "the order book  ")
    assert citation == {
        "doc_id": 501, "title": "Annual Report", "page_start": 12, "page_end": 14,
        "section": "MD&A", "quote": "the order book", "source_url": "https://example.com",
    }


def test_citation_for_trims_quote_to_400_chars():
    chunk = {"document_id": 501, "title": "T", "page_start": 1, "page_end": 2,
             "section": None, "source_url": None}
    long_quote = "word " * 200 + "long"
    assert len(citation_for(chunk, long_quote)["quote"]) <= 400


# --------------------------------------------------------------------------- LLM path
@pytest.mark.asyncio
async def test_analyze_llm_path_drops_hallucination(monkeypatch, session, chunks, llm_plan):
    _stub_retrieval(monkeypatch, chunks, llm_available=True)
    llm_plan.set("Order book & backlog", [
        _finding(101, "high", 0.9),  # verbatim -> survives
        _finding(101, "high", 0.9, quote="the gross margin contracted sharply in the period",
                   metric="Margin"),  # not in the source -> dropped
        _finding(999, "high", 0.9),  # chunk id absent from supplied set -> dropped
    ])
    result = await analyze.analyze(session, "ABC.NS", use_llm=True, drivers=["order_book_backlog"])

    driver = _find_driver(result, "order_book_backlog")
    assert len(driver["findings"]) == 1
    finding = driver["findings"][0]
    assert finding["citation"]["doc_id"] == 501
    assert finding["citation"]["page_start"] == 12
    assert result["engine"] == "llm"


# --------------------------------------------------------------------------- lexical path
@pytest.mark.asyncio
async def test_analyze_lexical_picks_order_book_number(monkeypatch, session, chunks):
    _stub_retrieval(monkeypatch, chunks, llm_available=False)
    result = await analyze.analyze(session, "ABC.NS", use_llm=False)

    driver = _find_driver(result, "order_book_backlog")
    values = [(f["value"], f["unit"]) for f in driver["findings"]]
    assert (45000.0, "crore") in values
    assert result["engine"] == "lexical"


@pytest.mark.asyncio
async def test_analyze_no_chunks_reports_insufficient(monkeypatch, session, llm_plan):
    monkeypatch.setattr(analyze, "store_get_chunks", lambda db, symbol: [])
    monkeypatch.setattr(analyze, "retrieve_search", lambda *a, **k: [])
    monkeypatch.setattr(analyze, "llm_available", lambda: False)
    result = await analyze.analyze(session, "EMPTY.NS", use_llm=False)
    assert result["stance"] == "insufficient_evidence"
    assert any("No filings" in w for w in result["warnings"])


# --------------------------------------------------------------------------- stance logic
@pytest.mark.asyncio
async def test_stance_constructive(monkeypatch, session, chunks, llm_plan):
    _stub_retrieval(monkeypatch, chunks, llm_available=True, disable_lexical=True)
    llm_plan.set("Order book & backlog", [_finding(101, "high", 0.9)])
    result = await analyze.analyze(session, "GROWTH.NS", use_llm=True)
    assert result["stance"] == "constructive"
    assert result["scores"]["net"] >= 15


@pytest.mark.asyncio
async def test_stance_cautious(monkeypatch, session, chunks, llm_plan):
    _stub_retrieval(monkeypatch, chunks, llm_available=True, disable_lexical=True)
    llm_plan.set("Adverse regulatory action", [_finding(101, "high", 0.9)])
    result = await analyze.analyze(session, "HEAD.NS", use_llm=True)
    assert result["stance"] == "cautious"
    assert result["scores"]["net"] <= -15


@pytest.mark.asyncio
async def test_stance_balanced(monkeypatch, session, chunks, llm_plan):
    _stub_retrieval(monkeypatch, chunks, llm_available=True, disable_lexical=True)
    llm_plan.set("Order book & backlog", [_finding(101, "medium", 0.35)])
    llm_plan.set("Adverse regulatory action", [_finding(101, "medium", 0.35)])
    result = await analyze.analyze(session, "BAL.NS", use_llm=True)
    assert result["stance"] == "balanced"


@pytest.mark.asyncio
async def test_stance_insufficient_when_single_document(monkeypatch, session, chunks, llm_plan):
    # force documents_used < 2 so stance is insufficient regardless of findings
    one_doc = [dict(chunks[0], document_id=501)]
    monkeypatch.setattr(analyze, "store_get_chunks", lambda db, symbol: one_doc)
    monkeypatch.setattr(analyze, "retrieve_search", lambda *a, **k: one_doc)
    monkeypatch.setattr(analyze, "llm_available", lambda: True)
    llm_plan.set("Order book & backlog", [_finding(101, "high", 0.9)])
    result = await analyze.analyze(session, "SING.NS", use_llm=True)
    assert result["stance"] == "insufficient_evidence"


# --------------------------------------------------------------------------- ask (lexical)
@pytest.mark.asyncio
async def test_ask_lexical_returns_matching_sentences(monkeypatch, session, chunks):
    _stub_retrieval(monkeypatch, chunks, llm_available=False)
    out = await analyze.ask(session, "ABC.NS", "order book backlog", k=6)
    assert out["engine"] == "lexical"
    assert "order book of ₹45,000 crore" in out["answer"]
    assert out["citations"]


# --------------------------------------------------------------------------- routes
@pytest.fixture
def filings_app(session, monkeypatch, chunks):
    from backend.api.deps import get_db
    from backend.filings_rag import routes_analysis as ra

    _stub_retrieval(monkeypatch, chunks, llm_available=False)

    app = FastAPI()
    app.include_router(ra.router)

    def _db_dep():
        yield session

    app.dependency_overrides[get_db] = _db_dep
    return app


def test_taxonomy_route(filings_app):
    client = TestClient(filings_app)
    resp = client.get("/taxonomy")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["growth"]) == 10
    assert len(body["headwind"]) == 11
    assert set(body["growth"][0].keys()) == {"id", "label", "kind", "description"}


def test_analyze_route_then_analysis_route(filings_app):
    client = TestClient(filings_app)
    resp = client.post("/ROUTE.NS/analyze", json={"use_llm": False})
    assert resp.status_code == 200
    body = resp.json()
    assert body["engine"] == "lexical"
    # latest is now persisted -> readable back
    resp2 = client.get("/ROUTE.NS/analysis")
    assert resp2.status_code == 200
    assert resp2.json()["engine"] == "lexical"


def test_analysis_route_404_when_none(filings_app):
    client = TestClient(filings_app)
    resp = client.get("/NOPE.NS/analysis")
    assert resp.status_code == 404


def test_ask_route_validation_and_success(filings_app):
    client = TestClient(filings_app)
    short = client.post("/ABC.NS/ask", json={"question": "ab"})
    assert short.status_code == 422
    ok_resp = client.post("/ABC.NS/ask", json={"question": "What is the order book?", "k": 3})
    assert ok_resp.status_code == 200
    assert ok_resp.json()["engine"] == "lexical"


# --------------------------------------------------------------------------- tool
def test_filings_tool_spec_and_registration():
    from backend.agent.tools import filings_tools as ft
    from backend.agent.tools.market_tools import build_default_registry

    specs = ft.filings_tool_specs()
    assert [s.name for s in specs] == ["search_company_filings"]
    spec = specs[0]
    assert spec.read_only is True
    assert spec.write_class == "none"

    # QC: must be in the registry the agent and MCP server actually build, not a side registry.
    registry = build_default_registry()
    assert "search_company_filings" in registry.names()


@pytest.mark.asyncio
async def test_search_company_filings_handler(monkeypatch, session, chunks):
    from backend.agent.tools import filings_tools as ft

    _stub_retrieval(monkeypatch, chunks, llm_available=False)
    result = await ft.search_company_filings({"symbol": "abc.ns", "question": "order book backlog"})
    assert result["ok"] is True
    data = result["data"]
    assert data["engine"] == "lexical"
    assert "order book of ₹45,000 crore" in data["answer"]


@pytest.mark.asyncio
async def test_search_company_filings_requires_symbol(monkeypatch, session, chunks):
    from backend.agent.tools import filings_tools as ft
    _stub_retrieval(monkeypatch, chunks)
    result = await ft.search_company_filings({"symbol": "", "question": "order book"})
    assert result["ok"] is False
    assert result["error"]["code"] == "bad_request"

def test_qc_verify_quote_rejects_altered_numbers():
    # QC (orchestrator): a long quote with one changed figure used to pass the 85% token rule.
    from backend.filings_rag.llm import verify_quote

    text = ("During the year the company secured several large contracts and its order book stood at "
            "₹40,000 crore as of March 31, 2025, providing strong revenue visibility for the next three years.")
    good = "its order book stood at ₹40,000 crore as of March 31, 2025, providing strong revenue visibility"
    altered = "its order book stood at ₹45,000 crore as of March 31, 2025, providing strong revenue visibility"
    assert verify_quote(good, text)
    assert not verify_quote(altered, text)
    assert verify_quote("Its  order book stood at ₹40,000 crore.", text)  # whitespace/case/punctuation tolerant
    assert not verify_quote("order book ₹45,000", text)  # short quotes must match exactly
    # a dropped filler word in a long quote is still accepted
    assert verify_quote("the company secured several large contracts and order book stood at ₹40,000 crore", text)


def test_qc_scoring_negation_and_string_chunk_ids():
    from backend.filings_rag import analyze as an

    # mean of the top 5, not sum(top 5) / all drivers
    assert an._mean_top([80, 60, 40, 20, 10, 5, 5, 5, 5, 5], 5) == 42.0
    chunk = {"id": 7, "document_id": 1, "text": "There is no material litigation pending against the company. "
             "A penalty of Rs 12 crore was levied by SEBI.", "title": "AR", "page_start": 4, "page_end": 4,
             "section": None, "source_url": None}
    found = an._extract_lexical_findings([chunk], [r"litigation|penalty"])
    assert [f["claim"] for f in found] == ["A penalty of Rs 12 crore was levied by SEBI."]
    finding = {"claim": "x", "quote": "A penalty of Rs 12 crore was levied by SEBI.", "chunk_id": "7",
               "magnitude": "high", "confidence": 0.9}
    assert an._extract_llm_finding(finding, {7: chunk}) is not None
