from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.filings_rag.models import FilingAnalysisORM
from backend.ideas import routes, service
from backend.models.core import FundamentalsPitORM, InsiderTrade
from backend.shared.db import Base


@pytest.fixture(autouse=True)
def _no_market_wide_network(monkeypatch):
    # QC: the market-wide NSE feed must never hit the network in unit tests; failing it makes
    # the service fall back to the per-symbol path these tests already fake.
    async def _offline(*_a, **_k):
        raise RuntimeError("network disabled in tests")

    monkeypatch.setattr(service, "_fetch_nse_market_announcements", _offline)


@pytest.fixture(autouse=True)
def _clear_cache() -> None:
    service._CACHE.clear()


class _FakeHotlist:
    def __init__(self, fixture: dict | None) -> None:
        self._fixture = fixture or {}

    async def get_hotlist(self, list_type, market, limit):
        return self._fixture.get(list_type, [])


class _Client:
    def __init__(self, app: TestClient, factory: sessionmaker) -> None:
        self.app = app
        self._factory = factory

    def seed(self, *rows: InsiderTrade | FilingAnalysisORM) -> None:
        with self._factory() as session:
            session.add_all(rows)
            session.commit()

    def board(self, market: str = "IN") -> dict:
        resp = self.app.get("/api/ideas", params={"market": market})
        assert resp.status_code == 200
        return resp.json()

    def timeline(self, symbols: str, market: str = "IN") -> list[dict]:
        resp = self.app.get("/api/ideas/timeline", params={"symbols": symbols, "market": market})
        assert resp.status_code == 200
        return resp.json()["items"]


def _trade(symbol: str, kind: str, value: float, source: str = "NSE", days_ago: int = 1) -> InsiderTrade:
    day = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days_ago)
    return InsiderTrade(
        symbol=symbol,
        insider_name="Director",
        insider_title="Director",
        transaction_type=kind,
        shares=100,
        price=value / 100 if value else 0.0,
        value=value,
        date=day,
        filing_date=day,
        source=source,
    )


def _ids(board: dict) -> dict[str, dict]:
    return {category["id"]: category for category in board["categories"]}


def _build_client(rows: list[InsiderTrade] | None = None) -> _Client:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[InsiderTrade.__table__, FundamentalsPitORM.__table__, FilingAnalysisORM.__table__])
    factory = sessionmaker(bind=engine)
    if rows:
        with factory() as session:
            session.add_all(rows)
            session.commit()

    def _db():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[get_db] = _db
    return _Client(TestClient(app), factory)


def _patched(app: _Client, monkeypatch, *, filings: dict | None = None, raise_bulk: bool = False, hotlist_fixture: dict | None = None) -> None:
    async def fake_filings(symbol, market):
        return (filings or {}).get(symbol, [])

    monkeypatch.setattr(service, "fetch_public_filings", fake_filings)
    monkeypatch.setattr(service, "get_hotlist_service", lambda: _FakeHotlist(hotlist_fixture))
    if raise_bulk:
        async def _boom():
            raise RuntimeError("boom")

        monkeypatch.setattr(service, "bulk_deals", _boom)
    else:
        async def _empty():  # the real bulk_deals is an async route function
            return {"data": []}

        monkeypatch.setattr(service, "bulk_deals", _empty)


# ---------------------------------------------------------------------------
# Direct classifier unit tests
# ---------------------------------------------------------------------------
def test_order_win_metric_and_regulatory_rules() -> None:
    category, metric = service.classify("LT bags order worth ₹ 1,250 crore", "work order for a new plant")
    assert category == "order_wins"
    assert metric == 1250.0

    assert service.classify("DCGI approval granted", "ANDA submitted")[0] == "regulatory_approvals"
    assert service.classify("greenfield capex new plant commissioning", "")[0] == "capex_expansion"
    assert service.classify("USFDA warning letter", "fix violations")[0] is None  # a warning letter is never an idea


def test_insider_buys_populate_board(monkeypatch) -> None:
    app = _build_client()
    app.seed(_trade("LT", "buy", 5_000_000, "NSE"), _trade("TATA", "sell", 1_000_000, "NSE"))
    _patched(app, monkeypatch)

    by_id = _ids(app.board("IN"))
    assert "LT" in {item["symbol"] for item in by_id["insider_buying"]["items"]}
    assert "TATA" not in {item["symbol"] for item in by_id["insider_buying"]["items"]}


def test_all_categories_present(monkeypatch) -> None:
    app = _build_client()
    _patched(app, monkeypatch)

    board = app.board("IN")
    assert list(_ids(board).keys()) == [
        "insider_buying",
        "bulk_block_deals",
        "order_wins",
        "capex_expansion",
        "regulatory_approvals",
        "results_momentum",
        "near_52w_high",
        "volume_breakouts",
    ]


def test_broken_bulk_source_yields_warning_not_500(monkeypatch) -> None:
    app = _build_client()
    _patched(app, monkeypatch, raise_bulk=True)

    response = app.app.get("/api/ideas", params={"market": "IN"})
    assert response.status_code == 200

    board = response.json()
    assert any("bulk deals source failed" in warning for warning in board["warnings"])
    assert _ids(board)["bulk_block_deals"]["items"] == []


def test_order_win_regulatory_capex_from_announcements(monkeypatch) -> None:
    filings = {
        "LT": [{"title": "LT bags order worth ₹ 1,250 crore", "text": "work order", "published_at": "2024-05-10", "attchmntText": ""}],
        "HDFCBANK": [{"title": "HDFC Bank gets USFDA ANDA approval granted", "text": "approval ofANDA", "published_at": "2024-05-09", "attchmntText": ""}],
        "ITC": [{"title": "ITC announces capacity expansion of greenfield new plant", "text": "commissioning", "published_at": "2024-05-08", "attchmntText": ""}],
        "SBIN": [{"title": "SBI receives letter of warning from regulator", "text": "warning letter show cause", "published_at": "2024-05-07", "attchmntText": ""}],
    }
    app = _build_client()
    _patched(app, monkeypatch, filings=filings)

    by_id = _ids(app.board("IN"))

    order_items = by_id["order_wins"]["items"]
    assert order_items[0]["symbol"] == "LT"
    assert order_items[0]["metric_value"] == 1250.0

    regulatory = {item["symbol"] for item in by_id["regulatory_approvals"]["items"]}
    assert "HDFCBANK" in regulatory
    assert "SBIN" not in regulatory

    assert "ITC" in {item["symbol"] for item in by_id["capex_expansion"]["items"]}


def test_cluster_buys_used_for_us_board(monkeypatch) -> None:
    monkeypatch.setattr(service, "get_cluster_buys", lambda db: {"clusters": [{"symbol": "AAPL", "name": "Apple", "total_value": 5_000_000.0, "date": "2024-05-01"}]})
    async def _no_filings(symbol, market):  # type: ignore[no-untyped-def]
        return []

    monkeypatch.setattr(service, "fetch_public_filings", _no_filings)
    monkeypatch.setattr(service, "get_hotlist_service", lambda: _FakeHotlist())
    monkeypatch.setattr(service, "bulk_deals", lambda: {"data": []})

    insider_category = _ids(_build_client().board("US"))["insider_buying"]
    assert insider_category["items"][0]["symbol"] == "AAPL"


def test_near_52w_high_and_volume_breakouts(monkeypatch) -> None:
    hotlist_fixture = {
        "52w_high": [{"symbol": "RELIANCE", "name": "Reliance", "change_pct": 1.5, "volume": 100}],
        "unusual_volume": [{"symbol": "TCS", "name": "Tata Consultancy", "change_pct": 40.0, "volume": 9999}],
    }
    app = _build_client()
    _patched(app, monkeypatch, hotlist_fixture=hotlist_fixture)

    by_id = _ids(app.board("IN"))
    assert by_id["near_52w_high"]["items"][0]["symbol"] == "RELIANCE"
    assert by_id["volume_breakouts"]["items"][0]["symbol"] == "TCS"


def test_lists_capped_at_twelve_items(monkeypatch) -> None:
    many = [{"symbol": f"SYM{i}", "name": f"Name {i}", "change_pct": 0.5, "volume": 1} for i in range(20)]
    app = _build_client()
    _patched(app, monkeypatch, hotlist_fixture={"52w_high": many, "unusual_volume": []})

    by_id = _ids(app.board("IN"))
    assert len(by_id["near_52w_high"]["items"]) == 12
    assert len(by_id["volume_breakouts"]["items"]) == 0


# ---------------------------------------------------------------------------
# Results momentum
# ---------------------------------------------------------------------------
def _pit_row(symbol: str, metric: str, value: float, as_of: str) -> FundamentalsPitORM:
    return FundamentalsPitORM(
        symbol=symbol,
        metric=metric,
        value=value,
        fiscal_period=as_of[:7],
        as_of_date=as_of,
        data_version_id="test-version",
    )


def test_results_momentum_requires_both_growth_over_twenty_percent(monkeypatch) -> None:
    app = _build_client()
    app.seed(
        _pit_row("LT", "revenue", 100.0, "2023-03-31"),
        _pit_row("LT", "revenue", 130.0, "2024-03-31"),
        _pit_row("LT", "net_income", 20.0, "2023-03-31"),
        _pit_row("LT", "net_income", 30.0, "2024-03-31"),
        _pit_row("TCS", "revenue", 100.0, "2023-03-31"),
        _pit_row("TCS", "revenue", 110.0, "2024-03-31"),
        _pit_row("TCS", "net_income", 20.0, "2023-03-31"),
        _pit_row("TCS", "net_income", 25.0, "2024-03-31"),
    )
    _patched(app, monkeypatch)

    by_id = _ids(app.board("IN"))
    momentum = by_id["results_momentum"]["items"]
    symbols = {item["symbol"] for item in momentum}
    assert "LT" in symbols  # revenue +30% and profit +50%
    assert "TCS" not in symbols  # revenue only +10%
    lt_item = next(i for i in momentum if i["symbol"] == "LT")
    assert lt_item["metric_value"] == 30.0


# ---------------------------------------------------------------------------
# Timeline
# ---------------------------------------------------------------------------
def test_timeline_sorted_by_date_desc(monkeypatch) -> None:
    filing_docs = [
        {"title": "Q1 results filing", "filed_at": "2024-03-10", "source_url": "https://example/1", "attchmntText": ""},
        {"title": "Annual filing", "filed_at": "2024-01-05", "source_url": "https://example/2", "attchmntText": ""},
    ]

    async def fake_filings(symbol, market):
        return [{"title": f"{symbol} bags order ₹500 crore", "text": "work order", "published_at": "2024-02-01", "attchmntText": ""}]

    app = _build_client()
    monkeypatch.setattr(service, "list_documents", lambda db, symbol: filing_docs)
    monkeypatch.setattr(service, "fetch_public_filings", fake_filings)
    monkeypatch.setattr(service, "get_hotlist_service", lambda: _FakeHotlist())

    app.seed(
        FilingAnalysisORM(symbol="LT", engine="llm", payload={"stance": "Bullish"}, created_at=datetime(2024, 4, 1, tzinfo=timezone.utc)),
        _trade("LT", "buy", 2_000_000, "NSE"),
    )

    items = app.timeline("LT", "IN")
    kinds = [i["kind"] for i in items]
    assert "analysis" in kinds and "insider" in kinds and "order_win" in kinds
    dates = [i["date"] for i in items]
    assert dates == sorted(dates, reverse=True)
    analysis_item = next(i for i in items if i["kind"] == "analysis")
    assert analysis_item["headline"] == "Filings analysis: Bullish"

    dates = [item["date"] for item in items]
    assert dates == sorted(dates, reverse=True)

    analysis_item = next(item for item in items if item["kind"] == "analysis")
    assert analysis_item["headline"] == "Filings analysis: Bullish"


def test_timeline_returns_empty_when_all_sources_fail(monkeypatch) -> None:
    app = _build_client()

    def boom(symbol, market):
        raise RuntimeError("network down")

    monkeypatch.setattr(service, "list_documents", lambda db, symbol: [])
    monkeypatch.setattr(service, "fetch_public_filings", boom)
    monkeypatch.setattr(service, "get_hotlist_service", lambda: _FakeHotlist())

    response = app.app.get("/api/ideas/timeline", params={"symbols": "LT", "market": "IN", "limit": 10})
    assert response.status_code == 200
    assert response.json()["items"] == []

def test_qc_classifier_has_no_substring_false_positives():
    # QC: "anda" ⊂ "Standalone", "eir" ⊂ "their", "loa" ⊂ "loan", "court order" is not an order win,
    # an amount without a unit is not assumed to be crore, and a 483 is not an approval.
    for text in ("Standalone Financial Results", "their dividend", "loan agreement", "Order of NCLT", "court order received"):
        assert service.classify(text, "")[0] is None, text
    assert service.classify("Bagging/Receiving of orders/contracts", "") == ("order_wins", None)
    assert service.classify("Company bags order worth Rs 450", "")[1] is None
    assert service.classify("USFDA inspection with 3 observations (Form 483)", "")[0] is None
    assert service.classify("Receives EIR from USFDA", "")[0] == "regulatory_approvals"
    assert service._as_date_str("01-Oct-2026 18:51:31") == "2026-10-01"
