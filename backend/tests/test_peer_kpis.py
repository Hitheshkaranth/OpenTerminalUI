from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.business_metrics.models import BusinessMetricORM
from backend.peer_kpis import service


def _make_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    BusinessMetricORM.__table__.create(engine, checkfirst=True)
    return sessionmaker(bind=engine)()


def _seed(session, symbol, key, label, unit, value, period, category="operational"):
    session.add(
        BusinessMetricORM(
            symbol=symbol,
            kind="kpi",
            key=key,
            label=label,
            unit=unit,
            category=category,
            period=period,
            value=value,
        )
    )
    session.commit()


# --------------------------------------------------------------------------- #
# Pure helpers
# --------------------------------------------------------------------------- #
def _cand(key, label, unit, value, period="FY25", category=None):
    return {
        "key": key,
        "label": label,
        "unit": unit,
        "category": category,
        "value": value,
        "period": period,
        "citation": None,
    }


def test_alignment_merges_same_label_unit_and_splits_units() -> None:
    symbols = ["TATA", "SCRILLO", "ACCELYA"]
    candidates = [
        [
            _cand("order_book", "Order Book", "crore", 5000, category="order_book"),
            _cand("capacity", "Installed Capacity", "mw", 120, category="capacity"),
        ],
        [
            _cand("backlog", "Order Book (₹ Cr)", "crore", 3000, category="order_book"),
            _cand("customers", "Active Customers", None, 800000, category="customers"),
        ],
        [_cand("order_book", "Order Book", "US$ M", 700, category="order_book")],
    ]

    rows = service._align(symbols, candidates)
    assert len(rows) == 4

    # Same metric + same unit merge, even across different source keys.
    merged = next(r for r in rows if r["key"] == "order_book" and r["unit"] == "crore")
    assert set(merged["values"]) == {"TATA", "SCRILLO"}
    assert merged["values"]["TATA"]["value"] == 5000
    assert merged["values"]["SCRILLO"]["value"] == 3000
    assert merged["higher_is_better"] is True

    # A unit mismatch keeps a separate row.
    us_row = next(r for r in rows if r["unit"] == "US$ M")
    assert set(us_row["values"]) == {"ACCELYA"}
    assert us_row["values"]["ACCELYA"]["value"] == 700


def test_latest_point_per_key_is_selected() -> None:
    session = _make_session()
    _seed(session, "TATA", "order_book", "Order Book", "crore", 4000, "FY24")
    _seed(session, "TATA", "order_book", "Order Book", "crore", 5000, "FY25")

    rows = session.query(BusinessMetricORM).filter(BusinessMetricORM.symbol == "TATA").all()
    latest = service._latest_points(rows)
    assert len(latest) == 1
    assert latest[0]["value"] == 5000
    assert latest[0]["period"] == "FY25"


def test_best_cells_respects_direction() -> None:
    assert service.best_cells({"A": 1.0, "B": 5.0, "C": 3.0}, True) == {"B"}
    assert service.best_cells({"A": 10.0, "B": 2.0, "C": 5.0}, False) == {"B"}
    assert service.best_cells({"A": 1.0, "B": 5.0}, None) == set()
    assert service.best_cells({"A": None, "B": None}, True) == set()
    assert service.best_cells({}, True) == set()


def test_higher_is_better_heuristics() -> None:
    assert service._higher_is_better("pe", "P/E", None) is False
    assert service._higher_is_better("ev_ebitda", "EV/EBITDA", None) is False
    assert service._higher_is_better("order_book", "Order Book", "order_book") is True
    assert service._higher_is_better("roe", "Return on Equity", "financial") is True
    assert service._higher_is_better("operational", "Cost per Unit", None) is None


# --------------------------------------------------------------------------- #
# End-to-end through get_peer_kpis (peers passed explicitly -> no network)
# --------------------------------------------------------------------------- #
async def _fake_fetch_snapshot(monkeypatch, table):
    async def _fetch(ticker: str):
        return table.get(str(ticker).upper(), {})

    monkeypatch.setattr(service, "_fetch_snapshot", _fetch)


def test_get_peer_kpis_aligns_seeds_financials_and_flags_missing(monkeypatch) -> None:
    session = _make_session()
    _seed(session, "TATA", "order_book", "Order Book", "crore", 4000, "FY24")
    _seed(session, "TATA", "order_book", "Order Book", "crore", 5000, "FY25")
    _seed(session, "SCRILLO", "backlog", "Order Book (₹ Cr)", "crore", 3000, "FY25")
    _seed(session, "ACCELYA", "order_book", "Order Book", "US$ M", 700, "FY25")
    # MSP has no KPI rows -> it should appear in "missing".

    snapshots = {
        "TATA": {"rev_growth_pct": 12.0, "op_margin_pct": 18.0, "roe_pct": 22.0, "pe": 18.0, "ev_ebitda": 9.0},
        "SCRILLO": {"rev_growth_pct": 8.0, "op_margin_pct": 20.0, "roe_pct": 18.0, "pe": 22.0},
        "ACCELYA": {"pe": 14.0},
    }
    asyncio.run(_fake_fetch_snapshot(monkeypatch, snapshots))

    result = asyncio.run(service.get_peer_kpis(session, "TATA", peers=["SCRILLO", "ACCELYA", "MSP"]))

    assert result["symbol"] == "TATA"
    assert result["peers"] == ["SCRILLO", "ACCELYA", "MSP"]
    assert result["missing"] == ["MSP"]

    # Operational matrix: the merged order-book (crore) row exists.
    order_rows = [r for r in result["rows"] if r["unit"] == "crore"]
    assert len(order_rows) == 1
    row = order_rows[0]
    assert set(row["values"]) == {"TATA", "SCRILLO"}
    assert row["values"]["TATA"]["value"] == 5000  # latest period wins

    # Financial rows come from the snapshot service.
    keys = {r["key"] for r in result["financial_rows"]}
    assert {"revenue_growth", "roe", "pe", "ev_ebitda"}.issubset(keys)
    pe_row = next(r for r in result["financial_rows"] if r["key"] == "pe")
    assert set(pe_row["values"]) == {"TATA", "SCRILLO", "ACCELYA"}
    assert pe_row["higher_is_better"] is False


def test_route_layer_resolves_and_returns_shape(monkeypatch) -> None:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from backend.peer_kpis.routes import router as peer_router

    session = _make_session()
    _seed(session, "TATA", "order_book", "Order Book", "crore", 5000, "FY25")
    _seed(session, "TATA", "pe", "P/E", None, 15, "FY25")

    async def _fetch(ticker: str):  # noqa: ANN001
        return {"TATA": {"pe": 15.0, "rev_growth_pct": 9.0}}

    monkeypatch.setattr(service, "_fetch_snapshot", _fetch)

    app = FastAPI()
    app.include_router(peer_router)

    def _db_override():
        db = session
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = _db_override
    client = TestClient(app)

    resp = client.get("/api/peer-kpis/TATA", params={"peers": "REL,INFY"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["symbol"] == "TATA"
    assert body["peers"] == ["REL", "INFY"]
    assert "rows" in body and "financial_rows" in body
    assert body["missing"] == ["REL", "INFY"]


def test_guard_when_kpi_table_absent(monkeypatch) -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # Deliberately do NOT create tables -> querying agent D's table raises.
    session = sessionmaker(bind=engine)()

    async def _fetch(ticker: str):  # noqa: ANN001
        return {"TATA": {"pe": 15.0}}

    monkeypatch.setattr(service, "_fetch_snapshot", _fetch)

    result = asyncio.run(service.get_peer_kpis(session, "TATA", peers=["SCRILLO"]))

    assert result["rows"] == []
    assert any("unavailable" in w.lower() for w in result["warnings"])
    assert result["missing"] == ["SCRILLO"]
    session.close()


# --------------------------------------------------------------------------- #
# Peer resolution reuses the existing peers service data source
# --------------------------------------------------------------------------- #
def test_default_peers_from_peers_service(monkeypatch) -> None:
    class _FMP:
        async def get_peers(self, symbol: str):
            return ["RELIANCE.NS", "INFY", {"symbol": "WIPRO.BO"}, "TATA", "SUNPHARMA"]

    class _Fetcher:
        fmp = _FMP()

    async def _get_fetcher():
        return _Fetcher()

    from backend.api import deps as deps_module

    monkeypatch.setattr(deps_module, "get_unified_fetcher", _get_fetcher)

    peers = asyncio.run(service._resolve_default_peers("TATA"))
    assert peers == ["RELIANCE", "INFY", "WIPRO", "SUNPHARMA"]