from backend.filings_rag import retrieve
import pytest


def chunks():
    return [
        {"id": 1, "document_id": 1, "text": "Operating margin revenue 2024 20 100 40", "filed_at": "2024-03-01", "period": "FY24", "page_start": 2, "page_end": 2},
        {"id": 2, "document_id": 2, "text": "Operating margin revenue 2025 30 200 50", "filed_at": "2025-03-01", "period": "FY25", "page_start": 3, "page_end": 3},
        {"id": 3, "document_id": 3, "text": "Operating margin revenue undated", "filed_at": None, "period": None},
    ]


def test_point_in_time_excludes_future_and_unknown_dates(monkeypatch):
    monkeypatch.setattr(retrieve, "get_chunks", lambda *a, **k: chunks())
    results = retrieve.search(None, "TCS", "revenue margin", as_of="2024-12-31")
    assert [x["id"] for x in results] == [1]
    assert results[0]["passage_ref"]["page_start"] == 2
    assert results[0]["table_like"]
    assert retrieve.search(None, "TCS", "revenue", filed_after="2025-01-01", periods=["FY24"]) == []
    with pytest.raises(ValueError):
        retrieve.search(None, "TCS", "margin", as_of="2024-01-01", filed_after="2025-01-01")


def test_same_size_updated_corpus_invalidates_cache(monkeypatch):
    retrieve._CACHE.clear()
    data = [{"text": "revenue earnings", "id": 1}]
    monkeypatch.setattr(retrieve, "get_chunks", lambda *a, **k: data)
    assert retrieve.search(None, "TCS", "earnings")
    data[0]["text"] = "regulatory litigation"
    assert retrieve.search(None, "TCS", "litigation")


def test_optional_local_hybrid_and_reranker_cannot_invent_sources(monkeypatch):
    monkeypatch.setattr(retrieve, "get_chunks", lambda *a, **k: chunks())
    results = retrieve.search(None, "TCS", "margins", hybrid=True,
        reranker=lambda q, items: [{"content_sha256": "invented"}, *reversed(items)])
    assert results
    assert all(r["retrieval_method"] == "hybrid_lexical" for r in results)
    assert all(r["id"] in (1, 2, 3) for r in results)


def test_empty_text_and_query_do_not_crash(monkeypatch):
    monkeypatch.setattr(retrieve, "get_chunks", lambda *a, **k: [{"text": "..."}])
    assert retrieve.search(None, "TCS", "margin") == []
    assert retrieve.search(None, "TCS", "") == []
