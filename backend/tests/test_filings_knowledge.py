from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.filings_rag import knowledge, llm, store
from backend.filings_rag.models import FilingKnowledgeORM
from backend.filings_rag.routes_knowledge import router as knowledge_router
from backend.shared.db import Base

SYMBOL = "TESTCO"


def _make_chunk(
    chunk_id: int,
    document_id: int,
    *,
    title: str,
    period: str | None,
    filed_at: str | None,
    text: str,
    section: str = "",
    source_url: str | None = None,
    doc_type: str = "concall_transcript",
) -> dict:
    return {
        "id": chunk_id,
        "document_id": document_id,
        "title": title,
        "doc_type": doc_type,
        "period": period,
        "filed_at": filed_at,
        "source_url": source_url,
        "page_start": 1,
        "page_end": 3,
        "section": section,
        "text": text,
    }


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _patch_chunks(monkeypatch, chunks):
    monkeypatch.setattr(store, "get_chunks", lambda db, symbol, doc_types=None: list(chunks))


def _patch_llm(monkeypatch, *, available=True, output=None):
    monkeypatch.setattr(llm, "llm_available", lambda: available)

    def fake_verify_quote(quote, text):
        q = " ".join(str(quote).lower().split())
        t = " ".join(str(text).lower().split())
        return bool(q) and q in t

    monkeypatch.setattr(llm, "verify_quote", fake_verify_quote)

    def fake_citation_for(chunk, quote):
        return {
            "doc_id": chunk.get("document_id"),
            "title": chunk.get("title"),
            "page_start": chunk.get("page_start"),
            "page_end": chunk.get("page_end"),
            "section": chunk.get("section"),
            "quote": quote,
            "source_url": chunk.get("source_url"),
        }

    monkeypatch.setattr(llm, "citation_for", fake_citation_for)

    if output is not None:
        async def fake_complete_json(system, user, **kwargs):  # noqa: ARG001
            return output

        monkeypatch.setattr(llm, "complete_json", fake_complete_json)


# Q1 then Q2, ordered by filed_at oldest-first.
def _two_guidance_chunks() -> list[dict]:
    return [
        _make_chunk(1, 1, title="ABC Ltd — Q1 FY24 Call", period="Q1", filed_at="2024-01-15",
                    text="During the call, management said they expect revenue growth of 15% this year."),
        _make_chunk(2, 2, title="ABC Ltd — Q2 FY24 Call", period="Q2", filed_at="2024-04-15",
                    text="Management now expect revenue growth of 18% this year."),
    ]


def test_guidance_status_raised(db, monkeypatch) -> None:
    _patch_chunks(monkeypatch, _two_guidance_chunks())

    result = asyncio.run(knowledge.build_knowledge(db, SYMBOL, use_llm=False))

    guidance = result["guidance"]
    by_status = [g for g in guidance if g["status"] == "raised"]
    assert len(by_status) == 1
    raised = by_status[0]
    assert raised["metric"] == "Revenue growth"
    assert raised["target"] == "18%"
    assert raised["said_in"]["doc_id"] == 2
    assert raised["said_in"]["period"] == "Q2"
    assert raised["citation"]["quote"] == "Management now expect revenue growth of 18% this year."
    assert raised["citation"]["doc_id"] == 2

    first = guidance[0]
    assert first["status"] == "new"
    assert first["target"] == "15%"


_LLM_OUTPUT = {
    "highlights": [
        "Record revenue achieved",
        "Margin expansion ahead",
        "18% growth guidance raised",
        "Workforce doubling next year",
    ],
    "quotes": [
        {"quote": "record revenue", "highlight": "Record revenue achieved"},
        {"quote": "strong margin expansion", "highlight": "Margin expansion ahead"},
        {"quote": "now expect 18% growth", "highlight": "18% growth guidance raised"},
        {"quote": "we will double our workforce next year", "highlight": "Workforce doubling next year"},
    ],
    "management_tone": "positive",
    "key_numbers": [{"label": "growth", "value": 18.0, "unit": "%"}],
    "qa_themes": ["Q&A on market expansion"],
}


def test_hallucinated_highlight_is_dropped(db, monkeypatch) -> None:
    chunks = [
        _make_chunk(1, 1, title="ABC Ltd Q1 Call", period="Q1", filed_at="2024-01-15",
                    text=(
                        "Management reported record revenue this quarter. We expect strong margin "
                        "expansion and healthy order pipeline. In the Q&A they now expect 18% growth. "
                        "FX volatility remains a headwind."
                    )),
    ]
    _patch_chunks(monkeypatch, chunks)
    _patch_llm(monkeypatch, available=True, output=_LLM_OUTPUT)

    result = asyncio.run(knowledge.build_knowledge(db, SYMBOL, use_llm=True))

    concalls = result["concalls"]
    assert len(concalls) == 1
    summary = concalls[0]
    assert summary["engine"] == "llm"
    assert "Record revenue achieved" in summary["highlights"]
    assert "Margin expansion ahead" in summary["highlights"]
    assert "18% growth guidance raised" in summary["highlights"]
    assert "Workforce doubling next year" not in summary["highlights"]
    assert summary["highlights"]  # at least the three backed highlights survive
    assert summary["management_tone"] == "positive"
    assert summary["key_numbers"][0]["value"] == 18.0
    assert summary["citations"], "verified quotes should produce citations"
    for citation in summary["citations"]:
        assert citation["quote"] in chunks[0]["text"]


def test_lexical_path_when_llm_unavailable(db, monkeypatch) -> None:
    _patch_chunks(monkeypatch, _two_guidance_chunks())
    _patch_llm(monkeypatch, available=False)

    result = asyncio.run(knowledge.build_knowledge(db, SYMBOL, use_llm=True))

    assert result["engine"] == "lexical"
    for summary in result["concalls"]:
        assert summary["engine"] == "lexical"
        assert summary["highlights"], "lexical highlights should be produced from keyword+number sentences"
        assert summary["management_tone"] in ("positive", "neutral", "negative")
    assert result["guidance"]


def test_no_eligible_documents_returns_warnings(db, monkeypatch) -> None:
    _patch_chunks(monkeypatch, [])
    _patch_llm(monkeypatch, available=True)

    result = asyncio.run(knowledge.build_knowledge(db, SYMBOL, use_llm=True))

    assert result["concalls"] == []
    assert result["guidance"] == []
    assert result["warnings"]
    assert "No eligible documents" in result["warnings"][0]


def _build_app(monkeypatch, chunks):
    _patch_chunks(monkeypatch, chunks)
    _patch_llm(monkeypatch, available=False)

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    app = FastAPI()
    app.include_router(knowledge_router)

    def _db_override():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db_override
    return TestClient(app), SessionLocal()


def test_routes_build_and_read(monkeypatch) -> None:
    client, session = _build_app(monkeypatch, _two_guidance_chunks())

    # Never built -> 404.
    not_built = client.get(f"/{SYMBOL}/knowledge")
    assert not_built.status_code == 404

    built = client.post(f"/{SYMBOL}/knowledge/build", json={"use_llm": False})
    assert built.status_code == 200
    payload = built.json()
    assert payload["symbol"] == SYMBOL
    assert "concalls" in payload and "guidance" in payload

    fetched = client.get(f"/{SYMBOL}/knowledge")
    assert fetched.status_code == 200
    assert fetched.json() == payload

    # Confirm it was persisted to FilingKnowledgeORM.
    rows = session.query(FilingKnowledgeORM).filter(FilingKnowledgeORM.symbol == SYMBOL).all()
    assert rows, "knowledge should be persisted to FilingKnowledgeORM"


def test_routes_build_accepts_use_llm_true_flag(monkeypatch) -> None:
    client, _ = _build_app(monkeypatch, _two_guidance_chunks())
    resp = client.post(f"/{SYMBOL}/knowledge/build", json={"use_llm": False})
    assert resp.status_code == 200
    assert resp.json()["engine"] == "lexical"

def test_qc_guidance_compares_like_with_like():
    # QC (orchestrator): no metric carry-over, no cross-period or cross-unit comparisons, target after the keyword.
    from backend.filings_rag import knowledge as kn

    def chunk(doc_id, filed, text):
        return {"id": doc_id * 10, "document_id": doc_id, "title": f"Call {doc_id}", "doc_type": "concall_transcript",
                "period": None, "filed_at": filed, "source_url": None, "page_start": 1, "page_end": 1,
                "section": None, "text": text, "ordinal": 0}

    chunks = [
        chunk(1, "2024-05-01", "We expect revenue growth of 15% in FY25. We plan to open 50 stores."),
        chunk(2, "2024-08-01", "We now expect revenue growth of 20% in FY26."),
        chunk(3, "2024-11-01", "Revenue grew 12% last year and we expect revenue growth of 15% in FY25."),
    ]
    items = kn._extract_guidance(chunks)
    by_stmt = {i["statement"]: i for i in items}
    stores = by_stmt["We plan to open 50 stores."]
    assert stores["metric"] == "Other" and stores["status"] == "new"
    assert by_stmt["We now expect revenue growth of 20% in FY26."]["status"] == "new"  # different period
    third = by_stmt["Revenue grew 12% last year and we expect revenue growth of 15% in FY25."]
    assert third["target"] == "15%" and third["status"] == "reiterated"
