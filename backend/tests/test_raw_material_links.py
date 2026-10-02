from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import backend.raw_materials.routes as raw_materials_routes
import backend.value_chain.service as value_chain_service
from backend.api.deps import get_db
from backend.raw_materials import service
from backend.shared.db import Base
from backend.value_chain.models import ValueChainSnapshot


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
async def _async_price_stub(symbol, *, history_cache):  # noqa: ANN001  (the real price_material is async)
    return {"price": 75.5, "currency": "USD", "change_1m_pct": 2.0, "change_1y_pct": 5.0}


def _make_db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def _add_value_chain_snapshot(
    db, symbol: str, commodity_symbol: str, cost_share_pct: float | None
) -> None:
    db.add(
        ValueChainSnapshot(
            symbol=symbol,
            engine="lexical",
            created_at=datetime.now(timezone.utc),
            payload={
                "symbol": symbol,
                "sector": "Petroleum",
                "industry": "Petroleum Refining",
                "raw_materials": [
                    {
                        "name": "WTI Crude Oil",
                        "commodity_symbol": commodity_symbol,
                        "cost_share_pct": cost_share_pct,
                    }
                ],
            },
        )
    )
    db.commit()


# --------------------------------------------------------------------------- #
# YAML validity
# --------------------------------------------------------------------------- #
def test_curated_yaml_validity() -> None:
    links = service.load_links()
    assert links, "expected curated commodities to load"

    for symbol, entry in links.items():
        all_companies = list(entry["input_cost"]) + list(entry["output_price"])
        assert all_companies, symbol

        relations = {c["relation"] for c in all_companies}
        assert relations <= set(service.VALID_RELATIONS), (symbol, relations)

        sensitivities = {c["sensitivity"] for c in all_companies}
        assert sensitivities <= set(service.VALID_SENSITIVITIES), (symbol, sensitivities)

        assert len(all_companies) >= 4, symbol

        for company in all_companies:
            assert str(company["name"]).strip()
            assert company["source"] == "curated"

    # spot-check a couple of well-known curated linkages
    crude = links["CL=F"]
    assert "ONGC" in {c["symbol"] for c in crude["output_price"]}
    assert "ASIANPAINT" in {c["symbol"] for c in crude["input_cost"]}
    # QC: Indian OMCs are squeezed by rising crude (administered pump prices), not helped by it.
    assert {"IOC", "BPCL"} <= {c["symbol"] for c in crude["input_cost"]}
    # QC: TIO=F is the iron-ore future (the first draft called it titanium dioxide).
    assert "iron ore" in links["TIO=F"]["name"].lower()
    assert "NMDC" in {c["symbol"] for c in links["TIO=F"]["output_price"]}


def test_indian_symbols_exist_on_nse() -> None:
    from pathlib import Path

    master = Path(__file__).resolve().parents[2] / "data" / "nse_equity_symbols_all.txt"
    if not master.exists():
        import pytest

        pytest.skip("NSE symbol master not present")
    nse = {x.strip().upper() for x in master.read_text().replace(",", " ").split()}
    bad = sorted({c["symbol"] for e in service.load_links().values() for c in e["input_cost"] + e["output_price"]
                  if c["market"] == "IN" and c["symbol"].upper() not in nse})
    assert not bad, bad


def test_expected_commodity_symbols_present() -> None:
    links = service.load_links()
    for symbol in ("CL=F", "NG=F", "HG=F", "GC=F", "ZC=F", "TIO=F", "HRC=F"):
        assert symbol in links, symbol


# --------------------------------------------------------------------------- #
# Catalog (GET /api/raw-materials)
# --------------------------------------------------------------------------- #
def test_list_items_shape() -> None:
    items = service.list_items()
    assert items, "expected a non-empty catalog"
    for item in items:
        assert item["commodity_symbol"]
        assert item["name"]
        assert isinstance(item["industries"], list)


def test_list_items_priced_shape(monkeypatch) -> None:
    monkeypatch.setattr(value_chain_service, "price_material", _async_price_stub)
    out = asyncio.run(service.list_items_priced())
    cl = [i for i in out if i["commodity_symbol"] == "CL=F"]
    assert cl, "CL=F missing from priced catalog"
    assert cl[0]["price"] == 75.5
    assert cl[0]["change_1m_pct"] == 2.0
    assert cl[0]["change_1y_pct"] == 5.0


# --------------------------------------------------------------------------- #
# Merge logic
# --------------------------------------------------------------------------- #
def test_companies_curated_groups_and_sources() -> None:
    db = _make_db()
    companies = asyncio.run(service.companies_for(db, "CL=F"))

    input_cost = [c for c in companies if c["relation"] == "input_cost"]
    output_price = [c for c in companies if c["relation"] == "output_price"]

    # crude -> input_cost: Asian Paints, Pidilite, ... ; output_price: ONGC, Oil India, Reliance
    assert input_cost and output_price
    assert "ONGC" in {c["symbol"] for c in output_price}
    assert "ASIANPAINT" in {c["symbol"] for c in input_cost}

    for company in companies:
        assert company["source"] == "curated"
        assert company["market"] in ("IN", "US")
        assert company["sensitivity"] in ("high", "medium", "low")


def test_companies_value_chain_merge(monkeypatch) -> None:
    monkeypatch.setattr(value_chain_service, "price_material", _async_price_stub)

    def _name_resolver(symbol: str) -> str:
        return f"{symbol} Company"

    db = _make_db()
    # cost_share_pct is a percentage (agent E stores the filing share_pct): 35 = 35% of costs; Brent links to the WTI page.
    _add_value_chain_snapshot(db, "RELIANCE.NS", "BZ=F", 35)

    companies = asyncio.run(
        service.companies_for(db, "CL=F", name_resolver=_name_resolver)
    )

    value_chain = [c for c in companies if c["source"] == "value_chain"]
    assert value_chain, "expected a value-chain company"
    vc = value_chain[0]
    assert vc["symbol"] == "RELIANCE.NS"
    assert vc["relation"] == "input_cost"
    assert vc["sensitivity"] == "high"  # 35% share -> high


def test_companies_value_chain_medium_sensitivity(monkeypatch) -> None:
    monkeypatch.setattr(value_chain_service, "price_material", _async_price_stub)

    db = _make_db()
    _add_value_chain_snapshot(db, "TATAMOTORS.NS", "CL=F", 5)

    companies = asyncio.run(service.companies_for(db, "CL=F"))
    value_chain = [c for c in companies if c["source"] == "value_chain"]
    assert value_chain[0]["sensitivity"] == "medium"  # 5% share -> medium


def test_companies_value_chain_no_share_default_medium(monkeypatch) -> None:
    monkeypatch.setattr(value_chain_service, "price_material", _async_price_stub)

    db = _make_db()
    _add_value_chain_snapshot(db, "TATASTEEL.NS", "CL=F", None)

    companies = asyncio.run(service.companies_for(db, "CL=F"))
    value_chain = [c for c in companies if c["source"] == "value_chain"]
    assert value_chain, "expected value-chain company even without cost share"
    assert value_chain[0]["sensitivity"] == "medium"


def test_companies_market_filter(monkeypatch) -> None:
    monkeypatch.setattr(value_chain_service, "price_material", _async_price_stub)

    db = _make_db()
    _add_value_chain_snapshot(db, "RELIANCE.NS", "CL=F", 35)

    all_companies = asyncio.run(service.companies_for(db, "CL=F"))
    us_only = asyncio.run(service.companies_for(db, "CL=F", market="US"))

    assert 0 < len(us_only) < len(all_companies)
    assert all(c["market"] == "US" for c in us_only)


def test_companies_empty_when_table_missing(monkeypatch) -> None:
    monkeypatch.setattr(value_chain_service, "price_material", _async_price_stub)

    class BrokenDB:
        def query(self, model):  # noqa: ANN001
            raise RuntimeError("table does not exist")

    companies = asyncio.run(service.companies_for(BrokenDB(), "CL=F"))
    assert companies, "expected curated companies"
    assert all(c["source"] == "curated" for c in companies)


# --------------------------------------------------------------------------- #
# Route layer via TestClient
# --------------------------------------------------------------------------- #
def _build_client(monkeypatch) -> tuple[TestClient, object]:
    monkeypatch.setattr(value_chain_service, "price_material", _async_price_stub)

    async def _name_resolver(symbol: str) -> str:
        return f"{symbol} Company"

    monkeypatch.setattr(
        raw_materials_routes, "fetch_stock_snapshot_coalesced", _name_resolver
    )

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)
    db = session()

    app = FastAPI()
    app.include_router(raw_materials_routes.router)

    def _override() -> object:
        yield db

    app.dependency_overrides[get_db] = _override
    return TestClient(app), db


def test_route_list_and_companies(monkeypatch) -> None:
    client, db = _build_client(monkeypatch)
    _add_value_chain_snapshot(db, "RELIANCE.NS", "CL=F", 35)

    listing = client.get("/api/raw-materials")
    assert listing.status_code == 200
    cl = [i for i in listing.json()["items"] if i["commodity_symbol"] == "CL=F"][0]
    assert cl["price"] == 75.5

    companies = client.get("/api/raw-materials/CL=F/companies")
    assert companies.status_code == 200
    body = companies.json()
    assert body["commodity_symbol"] == "CL=F"
    assert body["name"] == "WTI Crude Oil"
    assert {"input_cost", "output_price"} <= {
        c["relation"] for c in body["companies"]
    }
    sources = {c["source"] for c in body["companies"]}
    assert {"curated", "value_chain"} <= sources


def test_route_market_query_filter(monkeypatch) -> None:
    client, db = _build_client(monkeypatch)
    _add_value_chain_snapshot(db, "RELIANCE.NS", "CL=F", 35)

    body = client.get("/api/raw-materials/CL=F/companies?market=IN").json()
    assert body["companies"]
    assert all(c["market"] == "IN" for c in body["companies"])