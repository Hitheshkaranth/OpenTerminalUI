from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.business_metrics import service
from backend.business_metrics.routes import router as business_router
from backend.shared.db import Base


def _make_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


# --------------------------------------------------------------------------- #
# Lexical extraction
# --------------------------------------------------------------------------- #
def test_lexical_order_book_extraction(monkeypatch) -> None:
    chunk = {
        "id": "c1",
        "text": "Order book stood at Rs 1,23,456 crore as of March 31, 2025. Management discussed diversification.",
        "page_start": 12,
        "page_end": 14,
        "section": "Overview",
        "title": "Annual Report FY25",
        "source_url": None,
    }

    def _search(db, symbol, query, *, k=8, **kw):  # noqa: ANN001
        return [chunk]

    monkeypatch.setattr(service.retrieve, "search", _search)

    db = _make_session()
    result = asyncio.run(service.extract(db, "TATA", use_llm=False))

    kpis = {s["key"]: s for s in result["kpis"]}
    assert "order_book" in kpis
    series = kpis["order_book"]
    assert series["unit"] == "crore"
    assert series["category"] == "order_book"
    points = series["points"]
    assert points, "expected at least one order-book point"
    assert points[0]["value"] == 123456
    assert points[0]["period"] == "FY25"
    assert result["engine"] == "lexical"


# --------------------------------------------------------------------------- #
# LLM verification: reject rows whose value is not literally in the quote
# --------------------------------------------------------------------------- #
def test_llm_row_with_value_not_in_quote_is_rejected(monkeypatch) -> None:
    chunk = {
        "id": "c1",
        "text": "The order book stood at Rs 5,000 crore during the year. The company expanded operations materially.",
        "page_start": 5,
        "page_end": 7,
        "section": "MD Discussion",
        "title": "Q1 FY26 Report",
        "source_url": None,
    }

    def _search(db, symbol, query, *, k=8, **kw):  # noqa: ANN001
        return [chunk]

    monkeypatch.setattr(service.retrieve, "search", _search)
    monkeypatch.setattr(service.llm, "llm_available", lambda: True)
    monkeypatch.setattr(service.llm, "verify_quote", lambda quote, text: True)

    good_rows = [
        {
            "kind": "kpi", "key": "order_book", "label": "Order book", "unit": "crore",
            "category": "order_book", "dimension": None, "name": None, "period": "FY25",
            "value": 5000, "share_pct": None, "chunk_id": "c1",
            "quote": "The order book stood at Rs 5,000 crore during the year",
        },
        {
            "kind": "kpi", "key": "margin", "label": "EBITDA margin", "unit": None,
            "category": "financial", "dimension": None, "name": None, "period": "FY25",
            "value": 9999, "share_pct": None, "chunk_id": "c1",
            "quote": "Margins remained healthy throughout the year",
        },
    ]

    async def _complete_json(system, user, *, max_tokens=1200):  # noqa: ANN001, ANN002
        return {"rows": good_rows}

    monkeypatch.setattr(service.llm, "complete_json", _complete_json)

    db = _make_session()
    result = asyncio.run(service.extract(db, "TATA", use_llm=True))

    kpis = {s["key"]: s for s in result["kpis"]}
    assert result["engine"] == "llm"
    # The quoted, verified figure survives.
    assert "order_book" in kpis
    assert kpis["order_book"]["points"][0]["value"] == 5000
    # The value that does not appear in the quote is dropped.
    assert "margin" not in kpis
    all_values = [p["value"] for s in result["kpis"] for p in s["points"]]
    assert 9999 not in all_values


# --------------------------------------------------------------------------- #
# Empty GET shape
# --------------------------------------------------------------------------- #
def test_get_metrics_empty_shape() -> None:
    db = _make_session()
    result = service.get_metrics(db, "ACME")
    assert result["symbol"] == "ACME"
    assert result["updated_at"] is None
    assert result["kpis"] == []
    assert result["revenue_mix"] == []
    assert result["market_share"] == []
    assert result["warnings"] == []


# --------------------------------------------------------------------------- #
# Grouped response shapes after a lexical extraction
# --------------------------------------------------------------------------- #
def test_response_groups_kpis_mix_and_share(monkeypatch) -> None:
    chunk = {
        "id": "c1",
        "text": (
            "Textiles contributed 40% of revenue. Real estate contributed 25% of revenue. "
            "The company holds an 18% share of the Indian market. "
            "The order book stood at Rs 2,000 crore as of 31 March 2025."
        ),
        "page_start": 8,
        "page_end": 10,
        "section": "Business Review",
        "title": "Annual Report",
        "source_url": None,
    }

    def _search(db, symbol, query, *, k=8, **kw):  # noqa: ANN001
        return [chunk]

    monkeypatch.setattr(service.retrieve, "search", _search)

    db = _make_session()
    result = asyncio.run(service.extract(db, "TATA", use_llm=False))

    # KPI
    kpis = {s["key"]: s for s in result["kpis"]}
    assert "order_book" in kpis
    assert kpis["order_book"]["points"][0]["value"] == 2000

    # Revenue mix grouped by (period, dimension); mix rows carry the share directly.
    mix = result["revenue_mix"]
    assert mix, "expected a revenue-mix snapshot"
    snapshot = mix[0]
    assert snapshot["dimension"] == "segment"
    items = snapshot["items"]
    assert len(items) == 2
    shares = sorted(it["share_pct"] for it in items)
    assert shares == [25.0, 40.0]

    # Market share grouped by market.
    shares_out = result["market_share"]
    assert shares_out, "expected a market-share series"
    assert shares_out[0]["points"][0]["share_pct"] == 18


# --------------------------------------------------------------------------- #
# Re-extraction replaces the previous rows for a symbol
# --------------------------------------------------------------------------- #
def test_mix_share_pct_computed_from_absolute_values(monkeypatch) -> None:
    chunk = {
        "id": "c1",
        "text": "Textiles and real estate drove revenue. Real estate and textiles both expanded.",
        "page_start": 8,
        "page_end": 11,
        "section": "Business Review",
        "title": "Annual Report",
        "source_url": None,
    }

    def _search(db, symbol, query, *, k=8, **kw):  # noqa: ANN001
        return [chunk]

    monkeypatch.setattr(service.retrieve, "search", _search)
    monkeypatch.setattr(service.llm, "llm_available", lambda: True)
    monkeypatch.setattr(service.llm, "verify_quote", lambda quote, text: True)

    llm_rows = [
        {
            "kind": "mix", "key": "revenue_mix", "label": "Textiles", "unit": None,
            "category": "financial", "dimension": "segment", "name": "Textiles", "period": "FY25",
            "value": 40, "share_pct": None, "chunk_id": "c1",
            "quote": "Textiles contributed 40 units of revenue",
        },
        {
            "kind": "mix", "key": "revenue_mix", "label": "Real estate", "unit": None,
            "category": "financial", "dimension": "segment", "name": "Real estate", "period": "FY25",
            "value": 60, "share_pct": None, "chunk_id": "c1",
            "quote": "Real estate contributed 60 units of revenue",
        },
    ]

    async def _complete_json(system, user, *, max_tokens=1200):  # noqa: ANN001, ANN002
        return {"rows": llm_rows}

    monkeypatch.setattr(service.llm, "complete_json", _complete_json)

    db = _make_session()
    result = asyncio.run(service.extract(db, "TATA", use_llm=True))

    assert result["engine"] == "llm"
    mix = result["revenue_mix"]
    assert len(mix) == 1
    by_name = {it["name"]: it for it in mix[0]["items"]}
    assert by_name["Textiles"]["share_pct"] == 40.0
    assert by_name["Real estate"]["share_pct"] == 60.0


def test_reextract_replaces_previous_rows(monkeypatch) -> None:
    def _chunk(value_text):
        return {
            "id": "c1",
            "text": value_text,
            "page_start": 1,
            "page_end": 2,
            "section": None,
            "title": "R",
            "source_url": None,
        }

    def _search_factory(chunks):
        def _search(db, symbol, query, *, k=8, **kw):  # noqa: ANN001
            return list(chunks)

        return _search

    db = _make_session()

    monkeypatch.setattr(
        service.retrieve, "search",
        _search_factory([_chunk("Order book stood at Rs 1,000 crore as of 31 March 2025.")]),
    )
    first = asyncio.run(service.extract(db, "TATA", use_llm=False))
    assert first["kpis"][0]["points"][0]["value"] == 1000

    monkeypatch.setattr(
        service.retrieve, "search",
        _search_factory([_chunk("Order book stood at Rs 9,000 crore as of 31 March 2026.")]),
    )
    second = asyncio.run(service.extract(db, "TATA", use_llm=False))
    assert second["kpis"][0]["points"][0]["value"] == 9000

    persisted = db.query(service.BusinessMetricORM).count()
    assert persisted == 1


# --------------------------------------------------------------------------- #
# Route layer via TestClient
# --------------------------------------------------------------------------- #
def _build_client(monkeypatch) -> TestClient:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SessionLocal = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.include_router(business_router)

    def _db_override():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db_override
    return TestClient(app)


def test_route_get_empty_and_extract_then_get(monkeypatch) -> None:
    chunk = {
        "id": 1,
        "text": "Order book stood at Rs 1,23,456 crore as of March 31, 2025.",
        "page_start": 3,
        "page_end": 4,
        "section": None,
        "title": "R",
        "source_url": None,
    }

    def _search(db, symbol, query, *, k=8, **kw):  # noqa: ANN001
        return [chunk]

    monkeypatch.setattr(service.retrieve, "search", _search)
    client = _build_client(monkeypatch)

    before = client.get("/api/business/TATA/metrics")
    assert before.status_code == 200
    body = before.json()
    assert body["symbol"] == "TATA"
    assert body["kpis"] == []
    assert body["revenue_mix"] == []
    assert body["market_share"] == []

    extracted = client.post("/api/business/TATA/metrics/extract", json={"use_llm": False})
    assert extracted.status_code == 200
    body = extracted.json()
    assert body["engine"] == "lexical"
    keys = {s["key"] for s in body["kpis"]}
    assert "order_book" in keys

    after = client.get("/api/business/TATA/metrics")
    assert after.status_code == 200
    body = after.json()
    assert body["kpis"], "expected persisted KPIs after extraction"
    assert body["updated_at"] is not None


def test_route_extract_with_use_llm_true(monkeypatch) -> None:
    chunk = {
        "id": 1,
        "text": "Order book stood at Rs 7,777 crore as of 31 March 2025.",
        "page_start": 2,
        "page_end": 3,
        "section": None,
        "title": "R",
        "source_url": None,
    }

    def _search(db, symbol, query, *, k=8, **kw):  # noqa: ANN001
        return [chunk]

    monkeypatch.setattr(service.retrieve, "search", _search)
    monkeypatch.setattr(service.llm, "llm_available", lambda: True)
    monkeypatch.setattr(service.llm, "verify_quote", lambda quote, text: True)

    async def _complete_json(system, user, *, max_tokens=1200):  # noqa: ANN001, ANN002
        return {"rows": [
            {
                "kind": "kpi", "key": "order_book", "label": "Order book", "unit": "crore",
                "category": "order_book", "dimension": None, "name": None, "period": "FY25",
                "value": 7777, "share_pct": None, "chunk_id": 1,
                "quote": "Order book stood at Rs 7,777 crore as of 31 March 2025",
            }
        ]}

    monkeypatch.setattr(service.llm, "complete_json", _complete_json)
    client = _build_client(monkeypatch)

    extracted = client.post("/api/business/TATA/metrics/extract", json={"use_llm": True})
    assert extracted.status_code == 200
    body = extracted.json()
    assert body["engine"] == "llm"
    assert body["kpis"][0]["key"] == "order_book"
    assert body["kpis"][0]["points"][0]["value"] == 7777
    citation = body["kpis"][0]["points"][0]["citation"]
    assert citation is not None
    assert citation["quote"] == "Order book stood at Rs 7,777 crore as of 31 March 2025"

def test_qc_numeric_check_rejects_substring_and_periods_are_honest():
    # QC (orchestrator): 12 must not "appear" in "1,234"; September is not FY24; bare years give no period.
    assert service._check_numeric_in_quote(12, "order book of 1,234 crore") is None
    assert service._check_numeric_in_quote(1234, "order book of 1,234 crore") == 1234.0
    assert service._check_numeric_in_quote(45000, "orders worth ₹45,000.5 crore") is None
    assert service._period_from_text("order book as of September 30, 2024 was 500 crore") == "Sep 2024"
    assert service._period_from_text("as on March 31, 2025") == "FY25"
    assert service._period_from_text("founded in 2012, the order book is 500 crore") is None
    order = ["FY24", "Q1FY25", "Sep 2024", "Q3FY25", "FY25"]
    assert sorted(reversed(order), key=service._period_sort_key) == order


def test_qc_lexical_rows_cite_document_with_quote_and_dedupe():
    chunk = {"id": 77, "document_id": 5, "text": "Highlights. Our order book stood at Rs 2,500 crore as of March 31, 2025. Other text.",
             "page_start": 3, "page_end": 3, "section": None, "title": "AR", "source_url": None}
    rows = service._lexical_extract([chunk, dict(chunk, id=78)])
    order_rows = [r for r in rows if r["key"] == "order_book"]
    assert len(order_rows) == 1
    assert order_rows[0]["document_id"] == "5"
    assert "order book stood at Rs 2,500 crore" in order_rows[0]["quote"]
    assert order_rows[0]["period"] == "FY25"
