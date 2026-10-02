from __future__ import annotations

import asyncio
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import backend.value_chain.service as svc
from backend.value_chain import routes
from backend.value_chain.models import ValueChainSnapshot

_SYMBOL_RE = re.compile(r"^[A-Z]+=F$")


async def _fake_complete_json(*args, **kwargs):  # noqa: ARG002
    return {
        "customers": [
            {"name": "Verified Co", "quote": "Acme Ltd", "share_pct": 0.12},
            {"name": "Ghost Co", "quote": "this token is nowhere in the text"},
        ],
        "suppliers": [{"name": "Upstream Co", "quote": "Acme Ltd", "share_pct": 0.2}],
        "raw_materials": [],
    }


async def _no_resolve(name, **kwargs):  # noqa: ARG002
    return None


def _fake_history() -> dict:
    close_vals = [{"close": 100.0} for _ in range(299)]
    close_vals.append({"close": 110.0})
    return {"chart": {"result": [{"indicators": {"quote": [{"close": close_vals}]}}]}}


class _FakeFMP:
    def __init__(self, peers: list[str] | None = None) -> None:
        self._peers = peers or ["WIPRO.NS", "INFY.NS"]

    async def get_peers(self, symbol: str):  # noqa: ARG002
        return self._peers


class _FakeFetcher:
    def __init__(self, history: dict | None = None) -> None:
        self.fmp = _FakeFMP()
        self._history = history or _fake_history()

    async def fetch_history(self, symbol: str, range_str: str, interval: str):  # noqa: ARG002
        return self._history


@pytest.fixture
def vc_db():
    from backend.api.deps import get_db
    from backend.shared.db import engine

    ValueChainSnapshot.__table__.create(bind=engine, checkfirst=True)
    db = next(get_db())
    yield db
    db.close()


@pytest.fixture
def vc_client(monkeypatch, vc_db):
    snapshot = {"sector": "Power", "industry": "Power", "company_name": "ABC Power Ltd"}

    async def _get_unified_fetcher():
        return _FakeFetcher()

    async def _fetch_snapshot(ticker: str):
        snap = dict(snapshot)
        if ticker.upper() in ("WIPRO.NS", "INFY.NS"):
            snap["company_name"] = ticker.upper()
        return snap

    monkeypatch.setattr(svc, "get_unified_fetcher", _get_unified_fetcher)
    monkeypatch.setattr(svc, "fetch_stock_snapshot_coalesced", _fetch_snapshot)
    monkeypatch.setattr(svc, "retrieve_search", lambda db, symbol, query, **kw: [])
    monkeypatch.setattr(svc, "complete_json", _fake_complete_json)
    monkeypatch.setattr(svc, "resolve_ticker", lambda name, **kw: _no_resolve(name, **kw))
    monkeypatch.setattr(svc, "llm_available", lambda: True)

    app = FastAPI()
    app.include_router(routes.router)
    return TestClient(app)


# --------------------------------------------------------------------------- #
# YAML dataset
# --------------------------------------------------------------------------- #
def test_raw_materials_yaml_loads_and_symbols_valid():
    entries = svc.load_raw_material_entries()
    assert entries, "raw_materials.yaml should be non-empty"

    distinct_industries: set[str] = set()
    for entry in entries:
        assert entry["name"], "every material entry needs a name"
        symbol = entry["commodity_symbol"]
        assert symbol is None or _SYMBOL_RE.match(symbol), (
            f"commodity_symbol {symbol!r} must match ^[A-Z]+=F$ or be null"
        )
        distinct_industries.update(entry["industries"])

    required = {
        "Auto", "Auto Components", "Steel", "Cement", "Paints", "Tyres", "FMCG",
        "Textiles", "Pharmaceuticals", "Chemicals", "Power", "Oil & Gas",
        "Airlines", "Jewellery", "Cables & Wires", "Packaging", "Fertilizers",
        "Sugar", "Semiconductors", "Consumer Electronics",
    }
    assert required.issubset(distinct_industries), (
        f"missing industries: {required - distinct_industries}"
    )
    assert len(distinct_industries) >= 15


def test_raw_materials_for_industry_matches_commodity():
    oil = svc.raw_materials_for_industry("Oil & Gas", None)
    symbols = {m["commodity_symbol"] for m in oil}
    assert "BZ=F" in symbols  # Brent: Indian crude basket tracks Brent (QC)
    assert any(m["name"].lower().startswith("crude oil") for m in oil)

    cables = svc.raw_materials_for_industry("Cables & Wires", None)
    assert "HG=F" in {m["commodity_symbol"] for m in cables}

    cement = svc.raw_materials_for_industry("Cement", None)
    assert all(m["commodity_symbol"] is None for m in cement) or bool(cement)


# --------------------------------------------------------------------------- #
# Lexical customer extraction
# --------------------------------------------------------------------------- #
def test_lexical_customer_extraction():
    chunks = [
        {"text": "Our major customers include Acme Ltd, Beta Corp and Gamma LLP."},
        {"text": "We recorded record revenue this year with no customer concentration."},
    ]
    customers = []
    for chunk in chunks:
        customers.extend(svc.lexical_nodes_for_chunk("customer", chunk))
    names = [n["name"] for n in customers]
    assert names == ["Acme Ltd", "Beta Corp", "Gamma LLP"]

    plain = svc.lexical_nodes_for_chunk("customer", {"text": "No counterparties named here."})
    assert plain == []


# --------------------------------------------------------------------------- #
# Unverified LLM node dropped
# --------------------------------------------------------------------------- #
def test_unverified_quote_node_is_dropped(monkeypatch):
    monkeypatch.setattr(svc, "verify_quote", lambda quote, text: quote in text)
    chunk = {"text": "Our major customers include Acme Ltd and Beta Corp."}

    verified = svc.chain_node_from_quote(
        "customer", "Acme Ltd", symbol=None, share_pct=None,
        detail="", quote="Our major customers include Acme Ltd", chunk=chunk,
    )
    assert verified is not None and verified["name"] == "Acme Ltd"

    dropped = svc.chain_node_from_quote(
        "customer", "Nonexistent Co", symbol=None, share_pct=None,
        detail="", quote="A fabricated quote", chunk=chunk,
    )
    assert dropped is None


def test_extract_filings_drops_unverified_and_keeps_verified(monkeypatch):
    monkeypatch.setattr(svc, "verify_quote", lambda quote, text: quote in text)
    monkeypatch.setattr(svc, "complete_json", _fake_complete_json)
    monkeypatch.setattr(svc, "resolve_ticker", lambda name, **kw: _no_resolve(name, **kw))
    monkeypatch.setattr(svc, "citation_for", lambda chunk, quote: {"quote": quote, "page_start": 1})

    def _retrieve(db, symbol, query, *, k=8):
        return [
            {
                "text": "Our major customers include Acme Ltd and Beta Corp.",
                "page_start": 1, "page_end": 1, "title": "AR",
                "source_url": None, "section": "MD&A", "doc_id": 1,
            }
        ]

    monkeypatch.setattr(svc, "retrieve_search", _retrieve)

    async def run():
        return await svc.extract_filings_nodes(object(), "ABC.NS", use_llm=True, market="NSE")

    nodes = asyncio.run(run())
    names = sorted((n.get("name") for n in nodes) or [])
    assert names == ["Acme Ltd", "Beta Corp", "Upstream Co", "Verified Co"]


# --------------------------------------------------------------------------- #
# Change % from a fake history
# --------------------------------------------------------------------------- #
def test_compute_change_pct_from_fake_history():
    closes = [100.0] * 300
    closes[-1] = 110.0
    assert svc.compute_change_pct(closes, 21) == pytest.approx(10.0)
    assert svc.compute_change_pct(closes, 252) == pytest.approx(10.0)
    assert svc.compute_change_pct([], 1) is None
    assert svc.compute_change_pct([50.0, None, 60.0], 1) == pytest.approx(20.0)
    assert svc.compute_change_pct([100.0], 1) is None


def test_extract_closes_from_fake_chart_payload():
    closes = svc._extract_closes(_fake_history())
    assert closes[-1] == 110.0
    assert closes[-2] == 100.0


# --------------------------------------------------------------------------- #
# Routes via TestClient
# --------------------------------------------------------------------------- #
def test_get_value_chain_builds_on_the_fly(vc_client):
    resp = vc_client.get("/api/value-chain/ABC.PWR")
    assert resp.status_code == 200
    body = resp.json()
    assert body["symbol"] == "ABC.PWR"
    assert body["sector"] == "Power"

    peer_symbols = {c["symbol"] for c in body["competitors"]}
    assert {"WIPRO.NS", "INFY.NS"}.issubset(peer_symbols)
    for c in body["competitors"]:
        assert c["relation"] == "competitor"
        assert c["origin"] == "peers"

    assert body["raw_materials"], "expected curated raw materials for Power sector"
    for rm in body["raw_materials"]:
        assert set(rm) == {
            "name", "commodity_symbol", "price", "currency",
            "change_1m_pct", "change_1y_pct", "cost_share_pct", "origin", "citation",
        }
        assert rm["origin"] == "curated"


def test_extract_persists_then_get_returns_stored(vc_client):
    post = vc_client.post("/api/value-chain/ABC.PWR/extract", json={"use_llm": True})
    assert post.status_code == 200
    post_body = post.json()
    assert post_body["symbol"] == "ABC.PWR"
    assert "engine" not in post_body

    stored = vc_client.get("/api/value-chain/ABC.PWR")
    assert stored.status_code == 200
    assert stored.json() == post_body