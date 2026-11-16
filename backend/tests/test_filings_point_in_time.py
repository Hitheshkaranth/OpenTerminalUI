"""Historical asks must filter publication availability before ranking/model context."""

from datetime import datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.agent.tools import filings_tools
from backend.filings_rag import analyze, retrieve, store
from backend.filings_rag.availability import cutoff_utc, publication_time
from backend.filings_rag.models import FilingChunkORM, FilingDocumentORM
from backend.shared.db import Base


@pytest.fixture
def filings_db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[FilingDocumentORM.__table__, FilingChunkORM.__table__])
    db = sessionmaker(bind=engine)()
    yield db
    db.close()
    engine.dispose()


def add(db, name, filed_at, *, source="sec", period="2020", symbol="ACME"):
    doc = FilingDocumentORM(symbol=symbol, market="US", doc_type="annual_report", title=f"{name} fiscal 2020",
                            period=period, source=source, filed_at=filed_at, sha256=name,
                            created_at=datetime(2020, 1, 1))
    db.add(doc)
    db.flush()
    db.add(FilingChunkORM(document_id=doc.id, symbol=symbol, ordinal=1, page_start=1, page_end=1,
                         text=f"Operating margin {name} was twenty percent."))
    db.commit()
    return doc.id


def seed(db):
    ids = {}
    ids["past"] = add(db, "PAST_SAFE", "2024-05-01T20:00:00+00:00")
    ids["future"] = add(db, "FUTURE_POISON", "2025-01-01T12:00:00+00:00")
    ids["undated"] = add(db, "UNDATED_POISON", None)
    ids["upload"] = add(db, "UNVERIFIED_POISON", "2020-01-01", source="upload")
    ids["offset_future"] = add(db, "OFFSET_FUTURE_POISON", "2024-06-30T23:30:00-05:00")
    ids["offset_past"] = add(db, "OFFSET_SAFE", "2024-07-01T01:00:00+05:30")
    return ids


def test_actual_store_filters_metadata_before_fetching_text(filings_db):
    ids = seed(filings_db)
    chunks = store.get_chunks(filings_db, "ACME", as_of="2024-06-30", require_verified_availability=True)
    assert {chunk["document_id"] for chunk in chunks} == {ids["past"], ids["offset_past"]}
    assert all("POISON" not in chunk["text"] for chunk in chunks)


def test_future_and_undated_never_enter_vectorizer_or_reranker(filings_db, monkeypatch):
    ids = seed(filings_db)
    original = retrieve._fit_vectorizer
    observed = []

    def fit(symbol, vectors):
        observed.extend(vectors)
        assert all("POISON" not in text for text in vectors)
        return original(symbol, vectors)

    def rerank(query, chunks):
        assert {chunk["document_id"] for chunk in chunks} == {ids["past"], ids["offset_past"]}
        assert all("POISON" not in chunk["text"] for chunk in chunks)
        return chunks

    monkeypatch.setattr(retrieve, "_fit_vectorizer", fit)
    results = retrieve.search(filings_db, "ACME", "operating margin", as_of="2024-06-30",
                              require_verified_availability=True, reranker=rerank)
    assert len(observed) == len(results) == 2


@pytest.mark.asyncio
async def test_actual_ask_builds_llm_prompt_from_only_cutoff_eligible_chunks(filings_db, monkeypatch):
    ids = seed(filings_db)
    prompts = []

    async def complete(system, prompt, **kwargs):
        prompts.append(prompt)
        assert "POISON" not in prompt
        assert "PAST_SAFE" in prompt and "OFFSET_SAFE" in prompt
        return {"answer": "Known margin evidence [1].", "citations": [{"chunk_id": 1, "quote": "Operating margin PAST_SAFE was twenty percent."}]}

    monkeypatch.setattr(analyze, "llm_available", lambda: True)
    monkeypatch.setattr(analyze, "complete_json", complete)
    monkeypatch.setattr(analyze, "get_llm_provider", lambda: SimpleNamespace(model="offline-fixture"))
    result = await analyze.ask(filings_db, "ACME", "operating margin", as_of="2024-06-30")
    assert len(prompts) == 1
    assert result["as_of"] == "2024-06-30"
    assert result["engine"] == "llm"
    assert all(citation["doc_id"] in {ids["past"], ids["offset_past"]} for citation in result["citations"])


@pytest.mark.asyncio
async def test_no_verified_historical_evidence_returns_unsupported_before_llm(filings_db, monkeypatch):
    add(filings_db, "UNDATED_POISON", None)
    add(filings_db, "FUTURE_POISON", "2025-01-01")
    add(filings_db, "UPLOAD_POISON", "2020-01-01", source="upload")
    monkeypatch.setattr(analyze, "llm_available", lambda: pytest.fail("LLM must not be consulted"))
    result = await analyze.ask(filings_db, "ACME", "operating margin", as_of="2024-06-30")
    assert result["status"] == "unsupported"
    assert result["code"] == "historical_evidence_unavailable"
    assert result["citations"] == [] and result["engine"] == "none"


@pytest.mark.asyncio
async def test_default_current_ask_keeps_all_documents_available(filings_db, monkeypatch):
    seed(filings_db)
    prompts = []

    async def complete(system, prompt, **kwargs):
        prompts.append(prompt)
        return {"answer": "Current answer", "citations": []}

    monkeypatch.setattr(analyze, "llm_available", lambda: True)
    monkeypatch.setattr(analyze, "complete_json", complete)
    monkeypatch.setattr(analyze, "get_llm_provider", lambda: SimpleNamespace(model="fixture"))
    result = await analyze.ask(filings_db, "ACME", "operating margin", k=20)
    assert "as_of" not in result
    assert "FUTURE_POISON" in prompts[0] and "UNDATED_POISON" in prompts[0]
    assert "UNVERIFIED_POISON" in prompts[0]


@pytest.mark.parametrize("value", ["2024-06-30T00:00:00Z", "2024-06-30anything", "2024-02-30", "20240630", ""])
def test_cutoff_format_is_strict(value):
    with pytest.raises(ValueError):
        cutoff_utc(value)


def test_date_only_sec_availability_is_conservative_and_period_never_substitutes():
    available = publication_time({"source": "sec", "filed_at": "2024-06-30"}, verified=True)
    assert available > cutoff_utc("2024-06-30")
    assert available < cutoff_utc("2024-07-01")
    assert publication_time({"source": "sec", "period": "2020", "created_at": "2020-01-01"}, verified=True) is None
    assert publication_time({"source": "nse", "filed_at": "01-Jul-2024 02:00:00"}, verified=True) < cutoff_utc("2024-06-30")


@pytest.mark.parametrize("flag", ["filed_at_estimated", "release_date_estimated", "availability_estimated"])
def test_estimated_availability_is_rejected(flag):
    assert publication_time({"source": "sec", "filed_at": "2020-01-01", flag: True}, verified=True) is None


@pytest.mark.asyncio
async def test_tool_validates_cutoff_and_propagates_unsupported(monkeypatch):
    calls = []

    class DB:
        def close(self):
            pass

    async def ask(db, symbol, question, **kwargs):
        calls.append(kwargs)
        return {"status": "unsupported", "code": "historical_evidence_unavailable", "answer": "No verified historical evidence"}

    monkeypatch.setattr(filings_tools, "SessionLocal", DB)
    monkeypatch.setattr(filings_tools, "filings_ask", ask)
    bad = await filings_tools.search_company_filings({"symbol": "ACME", "question": "operating margin", "as_of": "2024-06-30T12:00:00Z"})
    assert bad["error"]["code"] == "bad_request" and not calls
    unavailable = await filings_tools.search_company_filings({"symbol": "ACME", "question": "operating margin", "as_of": "2024-06-30"})
    assert calls == [{"k": 6, "as_of": "2024-06-30"}]
    assert unavailable["ok"] is False
    assert unavailable["error"]["code"] == "historical_evidence_unavailable"
    assert filings_tools.filings_tool_specs()[0].parameters["properties"]["as_of"]["format"] == "date"
