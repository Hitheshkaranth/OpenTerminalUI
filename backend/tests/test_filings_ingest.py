from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.filings_rag import parse, sources, store
from backend.filings_rag.models import FilingChunkORM
from backend.filings_rag.retrieve import search
from backend.filings_rag.routes import router as filings_router
from backend.filings_rag.sources import nse_documents, sec_documents
from backend.main import app
from backend.shared.db import Base

SYMBOL = "ACME"
FILLER = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor"


def _filler(n_words: int) -> str:
    out = []
    i = 0
    while len(" ".join(out)) < n_words * 6:
        out.append(f"{FILLER} {i}")
        i += 1
    return " ".join(out)


def _build_client() -> tuple[TestClient, sessionmaker]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def _override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override_get_db
    app.state.db_session_factory = TestingSessionLocal
    return TestClient(app), TestingSessionLocal


def _make_session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestingSessionLocal()


def _auth_headers(client: TestClient, email: str) -> dict[str, str]:
    password = "StrongPass123!"
    register = client.post("/api/auth/register", json={"email": email, "password": password, "role": "trader"})
    assert register.status_code == 200, register.text
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _sample_pages() -> list[str]:
    return [
        "RISK FACTORS\n\n" + _filler(160)
        + "\n\nOur company operates in a competitive market and faces numerous risks that could affect performance.\n",
        "ORDER BOOK\n\n"
        + "We maintain a large and growing order book backlog across every region we serve.\n"
        + "The order book backlog today stands at a record level. Our order book backlog of\n"
        + "products and services provides strong visibility into future revenue growth.\n"
        + _filler(160)
        + "\n",
        "FINANCIAL STATEMENTS\n\n"
        + "Consolidated statement of financial position. Assets, liabilities and equity are\n"
        + "summarized below. Total assets increased year over year. Net income rose.\n"
        + _filler(120)
        + "\n",
    ]


# --------------------------------------------------------------------------- #
# parse.py
# --------------------------------------------------------------------------- #


def test_clean_dephenylates_and_collapses() -> None:
    messy = "The ex-\npansion plan works. Our growth-\nstrategy is sound.\n\n\n\ndetailed.   spaced   text"
    cleaned = parse.clean(messy)
    assert "expansion" in cleaned
    assert "growth" in cleaned and "strategy" in cleaned
    assert "growthstrategy" not in cleaned
    assert "  " not in cleaned


def test_clean_drops_page_numbers_and_repeated_headers() -> None:
    header = "CONFIDENTIAL HEADER LINE"
    lines = [header, header, header, header, header, header, header, "Real paragraph content here.", "Page 12"]
    cleaned = parse.clean("\n".join(lines))
    assert "CONFIDENTIAL HEADER LINE" not in cleaned
    assert "Real paragraph content here" in cleaned
    assert "Page 12" not in cleaned


def test_html_pages_splits_and_strips() -> None:
    body = _filler(650)
    html = (
        "<html><head><title>Doc</title></head><body>"
        "<script>var x = 1; alert('should be stripped');</script>"
        "<nav>menu links that should go away</nav>"
        "<div><h1>ORDER BOOK</h1>" + body + "</div>"
        "<div><h1>RISK FACTORS</h1>" + _filler(650) + "</div>"
        "</body></html>"
    )
    pages = parse.html_pages(html.encode("utf-8"))
    assert len(pages) >= 2
    joined = " ".join(pages)
    assert "should be stripped" not in joined
    assert "menu links" not in joined
    assert pages[0].startswith("ORDER BOOK")
    # QC: a long section may span several pages, but each section heading starts a page,
    # stays attached to its content, and no pseudo-page is oversized (whole-10-K-as-page-1 bug).
    risk_pages = [p for p in pages if p.startswith("RISK FACTORS")]
    assert len(risk_pages) == 1 and len(risk_pages[0]) > len("RISK FACTORS") + 100
    assert all(len(p) <= parse.HTML_PSEUDO_PAGE_CHARS + 200 for p in pages)


def test_text_pages_returns_paragraphs() -> None:
    pages = parse.text_pages("Para one.\n\n\nPara two.\n\n\nPara three.")
    assert len(pages) == 3
    assert pages[0].startswith("Para one")


def test_pdf_pages_and_chunk() -> None:
    content_stream = "BT\n/F1 12 Tf\n"
    for index, line in enumerate(["RISK FACTORS", "Order book backlog is our key exposure.", "ORDER BOOK", "Order book backlog stands strong."]):
        content_stream += "72 %d Td\n(%s) Tj\n" % (760 - 28 * index, line)
    content_stream += "ET\n"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        (
            b"<< /Length " + str(len(content_stream.encode("latin-1"))).encode() + b" >>\nstream\n"
            + content_stream.encode("latin-1") + b"\nendstream"
        ),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    pdf = b"%PDF-1.4\n"
    offsets = []
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf += ("%d 0 obj\n" % i).encode() + obj + b"\nendobj\n"
    xref_pos = len(pdf)
    pdf += b"xref\n"
    pdf += ("0 %d\n" % (len(objects) + 1)).encode()
    pdf += b"0000000000 65535 f \n"
    for off in offsets:
        pdf += ("%010d 00000 n \n" % off).encode()
    pdf += b"trailer\n<< /Size " + str(len(objects) + 1).encode() + b" /Root 1 0 R >>\nstartxref\n" + str(xref_pos).encode() + b"\n%%EOF"

    pages = parse.pdf_pages(pdf)
    assert pages and any("order book backlog" in p.lower() for p in pages)
    chunks = parse.chunk_pages([parse.clean(p) for p in pages])
    assert chunks
    combined = "\n".join(c["text"] for c in chunks)
    assert "order book backlog" in combined.lower()


# --------------------------------------------------------------------------- #
# chunk_pages structure
# --------------------------------------------------------------------------- #


def test_chunk_pages_keeps_pages_and_sections() -> None:
    chunks = parse.chunk_pages(_sample_pages())
    assert len(chunks) >= 2
    sections = {c["section"] for c in chunks if c["section"]}
    assert "ORDER BOOK" in sections
    assert "RISK FACTORS" in sections
    assert [c["ordinal"] for c in chunks] == list(range(1, len(chunks) + 1))
    for chunk in chunks:
        assert len(chunk["text"]) >= 1
        assert chunk["page_end"] >= chunk["page_start"]


def test_chunk_pages_has_one_paragraph_overlap_and_no_gaps() -> None:
    chunks = parse.chunk_pages(_sample_pages())
    assert len(chunks) >= 2
    for chunk in chunks:
        assert chunk["text"].strip()
    overlaps = sum(1 for a, b in zip(chunks, chunks[1:]) if a["text"].splitlines()[-1] in b["text"])
    assert overlaps >= 1


# --------------------------------------------------------------------------- #
# store.py
# --------------------------------------------------------------------------- #


def test_add_document_dedupe_and_document_shape() -> None:
    _, factory = _build_client()
    session = factory()
    doc = store.add_document(
        session,
        symbol="acme",
        market="US",
        doc_type="10-k",
        title="Acme 10-K",
        period="2024-12-31",
        source="sec",
        source_url="https://www.sec.gov/",
        filed_at="2025-03-15",
        pages=_sample_pages(),
    )
    assert doc["symbol"] == "ACME"
    assert doc["doc_type"] == "annual_report"
    assert doc["pages"] == 3
    assert doc["chunks"] >= 2
    assert doc["chars"] > 0
    assert doc["created_at"].startswith("20")

    try:
        store.add_document(
            session,
            symbol="ACME",
            market="US",
            doc_type="10-k",
            title="Acme 10-K",
            period="2024-12-31",
            source="sec",
            source_url="https://www.sec.gov/",
            filed_at="2025-03-15",
            pages=_sample_pages(),
        )
    except ValueError as exc:
        assert str(exc) == "duplicate"
    else:
        raise AssertionError("expected duplicate")


def test_add_document_empty_raises() -> None:
    _, factory = _build_client()
    session = factory()
    try:
        store.add_document(session, symbol="ACME", market="US", doc_type="other", title="x", period=None, source="upload", source_url=None, filed_at=None, pages=["", "   "])
    except ValueError as exc:
        assert str(exc) == "empty"
    else:
        raise AssertionError("expected ValueError('empty')")


def test_list_and_delete_documents() -> None:
    _, factory = _build_client()
    session = factory()
    store.add_document(session, symbol="LISTSYM", market="US", doc_type="annual_report", title="First", period="2023-01-01", source="nse", source_url=None, filed_at=None, pages=_sample_pages())
    store.add_document(session, symbol="LISTSYM", market="US", doc_type="quarterly_filing", title="Second", period="2024-01-01", source="nse", source_url=None, filed_at=None, pages=[_filler(80) + " Another document."])
    session.commit()
    docs = store.list_documents(session, "LISTSYM")
    assert len(docs) == 2
    assert docs[0]["title"] == "Second"
    doc_id = docs[0]["id"]

    chunk_before = session.query(FilingChunkORM).count()
    assert store.delete_document(session, "LISTSYM", doc_id) is True
    assert len(store.list_documents(session, "LISTSYM")) == 1
    assert session.query(FilingChunkORM).count() < chunk_before
    assert store.delete_document(session, "LISTSYM", 999999) is False


# --------------------------------------------------------------------------- #
# retrieve.py
# --------------------------------------------------------------------------- #


def test_search_ranks_order_book_chunk_first() -> None:
    _, factory = _build_client()
    session = factory()
    store.add_document(
        session,
        symbol="RANK",
        market="US",
        doc_type="annual_report",
        title="Rank Me",
        period="2024-01-01",
        source="sec",
        source_url=None,
        filed_at=None,
        pages=_sample_pages(),
    )
    results = search(session, "RANK", "order book backlog", keywords=["order book backlog"])
    assert results
    assert "order book backlog" in results[0]["text"].lower()
    assert all(c["score"] > 0 for c in results)
    assert results[0]["section"] == "ORDER BOOK"


def test_search_doc_types_filter_and_zero_scores_dropped() -> None:
    _, factory = _build_client()
    session = factory()
    store.add_document(
        session,
        symbol="FILTER",
        market="US",
        doc_type="annual_report",
        title="Filter Me",
        period="2024-01-01",
        source="sec",
        source_url=None,
        filed_at=None,
        pages=_sample_pages(),
    )
    annual = search(session, "FILTER", "order book backlog", doc_types=["annual_report"])
    empty = search(session, "FILTER", "order book backlog", doc_types=["regulatory"])
    assert annual and all(c["doc_type"] == "annual_report" for c in annual)
    assert empty == []


# --------------------------------------------------------------------------- #
# sources.py
# --------------------------------------------------------------------------- #


def test_market_classifier() -> None:
    assert sources.market_for_symbol("RELIANCE.NS") == "IN"
    assert sources.market_for_symbol("TCS.BO") == "IN"
    assert sources.market_for_symbol("AAPL") == "US"
    assert sources.market_for_symbol("MSFT") == "US"


def test_nse_attachment_type_mapping() -> None:
    assert sources._nse_attachment_type("Quarterly Earnings Call Transcript") == "concall_transcript"
    assert sources._nse_attachment_type("Investor Presentation Q3") == "investor_presentation"
    assert sources._nse_attachment_type("Order Win Announcement") == "press_release"
    assert sources._nse_attachment_type("USFDA Warning Letter") == "regulatory"
    assert sources._nse_attachment_type("Outcome of Board Meeting on Financial Results") == "quarterly_filing"
    assert sources._nse_attachment_type("Miscellaneous notice") is None


# --------------------------------------------------------------------------- #
# routes_documents.py (TestClient)
# --------------------------------------------------------------------------- #


def _fetch_sec_payload() -> list[dict]:
    return [
        {"title": "Acme 10-K", "doc_type": "annual_report", "period": "2024-12-31", "source": "sec", "source_url": "https://www.sec.gov/", "filed_at": "2025-03-15", "content_type": "text/html", "data": ("<html><body><div><h1>ORDER BOOK</h1>" + _filler(400) + "</div></body></html>").encode("utf-8")},
        {"title": "Broken Filing", "doc_type": "annual_report", "period": "2024-12-31", "source": "sec", "source_url": None, "filed_at": None, "content_type": "text/html", "data": b""},
    ]


def test_upload_route_returns_document() -> None:
    html = "<html><body><div><h1>ORDER BOOK</h1>" + _filler(400) + "</div></body></html>"
    client, _ = _build_client()
    headers = _auth_headers(client, "upload@example.com")
    resp = client.post(
        f"/api/filings-rag/{SYMBOL}/documents/upload",
        headers=headers,
        files={"file": ("report.html", html.encode("utf-8"), "text/html")},
        data={"doc_type": "annual_report", "title": "Report", "period": "2024-12-31"},
    )
    assert resp.status_code == 200, resp.text
    doc = resp.json()
    assert doc["symbol"] == SYMBOL
    assert doc["doc_type"] == "annual_report"
    assert doc["chunks"] >= 1

    listed = client.get(f"/api/filings-rag/{SYMBOL}/documents", headers=headers)
    assert listed.status_code == 200
    assert [d["id"] for d in listed.json()["documents"]] == [doc["id"]]


def test_upload_route_duplicate_returns_409() -> None:
    html = "<html><body><div><h1>ORDER BOOK</h1>" + _filler(400) + "</div></body></html>"
    client, _ = _build_client()
    headers = _auth_headers(client, "dup@example.com")
    payload = {"doc_type": "annual_report", "title": "Report", "period": "2024-12-31"}
    first = client.post(f"/api/filings-rag/{SYMBOL}/documents/upload", headers=headers, files={"file": ("report.html", html.encode("utf-8"), "text/html")}, data=payload)
    second = client.post(f"/api/filings-rag/{SYMBOL}/documents/upload", headers=headers, files={"file": ("report.html", html.encode("utf-8"), "text/html")}, data=payload)
    assert first.status_code == 200
    assert second.status_code == 409


def test_upload_route_unsupported_type_returns_422() -> None:
    client, _ = _build_client()
    headers = _auth_headers(client, "unsupported@example.com")
    resp = client.post(
        f"/api/filings-rag/{SYMBOL}/documents/upload",
        headers=headers,
        files={"file": ("data.csv", b"a,b,c\n1,2,3", "text/csv")},
        data={"doc_type": "other"},
    )
    assert resp.status_code == 422


def test_upload_route_empty_pdf_returns_422() -> None:
    pdf = b"%PDF-1.4\n1 0 obj\n<< >>\nendobj\ntrailer\n<< >>\nstartxref\n0\n%%EOF"
    client, _ = _build_client()
    headers = _auth_headers(client, "empty@example.com")
    resp = client.post(
        f"/api/filings-rag/{SYMBOL}/documents/upload",
        headers=headers,
        files={"file": ("blank.pdf", pdf, "application/pdf")},
        data={"doc_type": "other"},
    )
    assert resp.status_code == 422


def test_fetch_route_imports_and_skips() -> None:
    client, _ = _build_client()
    headers = _auth_headers(client, "fetch@example.com")
    original = sec_documents
    backend_sources = __import__("backend.filings_rag.sources", fromlist=["sec_documents"])

    async def _fake_sec(symbol, limit=5):
        return _fetch_sec_payload()

    backend_sources.sec_documents = _fake_sec
    try:
        resp = client.post(f"/api/filings-rag/{SYMBOL}/documents/fetch", headers=headers, json={"sources": ["sec"], "limit": 5})
    finally:
        backend_sources.sec_documents = original

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["imported"]) == 1
    assert any(s.get("reason") == "download failed" for s in body["skipped"])


def test_fetch_route_inferred_source_and_delete() -> None:
    fake = [
        {"title": "Acme 10-Q", "doc_type": "quarterly_filing", "period": "2025-03-31", "source": "sec", "source_url": "https://www.sec.gov/", "filed_at": "2025-06-01", "content_type": "text/html", "data": ("<html><body><div><h1>RISK FACTORS</h1>" + _filler(400) + "</div></body></html>").encode("utf-8")},
    ]
    client, _ = _build_client()
    headers = _auth_headers(client, "inferred@example.com")
    original = sec_documents
    backend_sources = __import__("backend.filings_rag.sources", fromlist=["sec_documents"])

    async def _fake_sec(symbol, limit=5):
        return fake

    backend_sources.sec_documents = _fake_sec
    try:
        resp = client.post(f"/api/filings-rag/{SYMBOL}/documents/fetch", headers=headers, json={"limit": 3})
        assert resp.status_code == 200, resp.text
        doc_id = resp.json()["imported"][0]["id"]

        deleted = client.delete(f"/api/filings-rag/{SYMBOL}/documents/{doc_id}", headers=headers)
        assert deleted.status_code == 200
        assert deleted.json() == {"deleted": True}

        gone = client.delete(f"/api/filings-rag/{SYMBOL}/documents/{doc_id}", headers=headers)
        assert gone.status_code == 404
    finally:
        backend_sources.sec_documents = original