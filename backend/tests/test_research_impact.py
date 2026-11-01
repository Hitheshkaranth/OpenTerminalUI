from types import SimpleNamespace as NS
import asyncio
import pytest
from backend.research_inbox.impact import build_exposure, canonical_symbol, quote_evidence


def quote(**overrides):
    return {"current_price": 100, "currency": "USD", "provenance": {"source": "yahoo", "quality": "delayed", "as_of": "2026-10-01T12:00:00Z"}, **overrides}


def snapshot(citation=None, share=.2):
    return NS(payload={"suppliers": [{"name": "Supplier", "share_pct": share, "citation": citation}]})


@pytest.mark.parametrize("value", [
    {"current_price": 100, "currency": "USD"},
    quote(provenance={"source": "mock", "quality": "cached"}),
    quote(provenance={"source": "yahoo", "quality": "synthetic"}),
    quote(provenance={"source": "yahoo", "quality": "stale"}),
    quote(currency="INR"), quote(current_price=float("nan")), quote(current_price=True),
])
def test_unreliable_quotes_cannot_become_portfolio_weights(value):
    result = build_exposure([NS(symbol="A", shares=1)], {"A": snapshot()}, [], {"A": value}, "USD")
    assert not result["coverage"]["weights_complete"]
    assert result["items"][0]["portfolio_weight_pct"] is None
    assert result["coverage"]["quote_gaps"] == ["A"]


def test_quotes_report_real_source_without_inventing_timestamp():
    evidence, price = quote_evidence({"current_price": 100, "currency": "usd", "details": {"price_source": "yahoo"}}, "USD")
    assert evidence["eligible"] is True
    assert evidence["source"] == "yahoo"
    assert evidence["quality"] == "unreported"
    assert evidence["as_of"] is None
    assert price == 100


@pytest.mark.parametrize("citation", [None, {}, {"quote": "20% of purchases"}, {"source_url": "https://example.com"}, {"quote": "20%", "source_url": "javascript:alert(1)"}])
def test_missing_or_untraceable_citations_keep_relationship_unknown(citation):
    result = build_exposure([NS(symbol="A", shares=1)], {"A": snapshot(citation)}, [], {"A": quote()}, "USD")
    holding = result["items"][0]["holdings"][0]
    assert holding["basis"] == "unknown"
    assert holding["business_share_pct"] is None
    assert result["coverage"]["with_cited_relationships"] == 0


def test_relationship_citation_is_not_proof_of_numeric_business_share():
    citation = {"quote": "Supplier provides components.", "source_url": "https://example.com/filing"}
    result = build_exposure([NS(symbol="A", shares=1)], {"A": snapshot(citation)}, [], {"A": quote()}, "USD")
    assert result["items"][0]["holdings"][0]["basis"] == "disclosed"
    assert result["items"][0]["holdings"][0]["business_share_pct"] is None
    citation["quote"] = "Supplier provides 20 percent of components."
    result = build_exposure([NS(symbol="A", shares=1)], {"A": snapshot(citation)}, [], {"A": quote()}, "USD")
    assert result["items"][0]["holdings"][0]["business_share_pct"] == 20


def test_exchange_aliases_align_lots_research_and_quotes_without_market_collision():
    citation = {"quote": "Supplier provides components.", "doc_id": 7}
    holdings = [NS(symbol="NASDAQ:A", shares=1), NS(symbol="A", shares=1), NS(symbol="NSE:A", shares=1)]
    dossiers = [NS(id="us", symbol="A", payload={"market": "US", "title": "US thesis"}), NS(id="in", symbol="A", payload={"market": "IN", "title": "India thesis"})]
    result = build_exposure(holdings, {"A": snapshot(citation), "A.NS": snapshot(citation)}, dossiers, {"A": quote(), "A.NS": quote()}, "USD")
    rows = result["items"][0]["holdings"]
    assert result["coverage"]["holdings"] == 2
    assert rows[0]["weight_pct"] == pytest.approx(200 / 3)
    assert rows[0]["dossiers"] == [{"id": "us", "title": "US thesis"}]
    assert rows[1]["dossiers"] == [{"id": "in", "title": "India thesis"}]
    assert canonical_symbol("BSE:A") == "A.BO"
    assert canonical_symbol("A", "IN") != canonical_symbol("A", "US")


def test_nonpositive_and_invalid_positions_do_not_distort_long_equity_weights():
    holdings = [NS(symbol="A", shares=1), NS(symbol="B", shares=-1), NS(symbol="C", shares=float("nan"))]
    result = build_exposure(holdings, {"A": snapshot()}, [], {"A": quote()}, "USD")
    assert result["coverage"]["holdings"] == 1
    assert result["items"][0]["portfolio_weight_pct"] == 100
    assert "not a predicted loss" in result["interpretation"]


def test_opposing_thesis_conditions_do_not_share_an_assumption_group():
    conditions = [{"metric": "margin", "unit": "%", "operator": "gte", "threshold": 18}, {"metric": "margin", "unit": "%", "operator": "lte", "threshold": 10}]
    dossiers = [NS(id=f"d{i}", symbol=symbol, payload={"market": "US", "thesis_conditions": [condition]}) for i, (symbol, condition) in enumerate(zip(["A", "B"], conditions))]
    result = build_exposure([NS(symbol=symbol, shares=1) for symbol in ("A", "B")], {}, dossiers, {symbol: quote() for symbol in ("A", "B")}, "USD")
    assert len(result["items"]) == 2
    assert all(row["holding_count"] == 1 for row in result["items"])


def test_database_lookup_aligns_qualified_holdings_and_excludes_other_users(monkeypatch):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from backend.shared.db import Base
    from backend.models.core import PortfolioORM, PortfolioHoldingORM
    from backend.research_dossiers.models import ResearchDossier
    from backend.value_chain.models import ValueChainSnapshot
    from backend.research_inbox.impact import portfolio_impact
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    calls = []
    async def fetch(symbol):
        calls.append(symbol)
        return quote(currency="INR")
    monkeypatch.setattr("backend.research_inbox.impact.fetch_stock_snapshot_coalesced", fetch)
    with Session(engine) as db:
        db.add(PortfolioORM(id="p", user_id="owner", name="India", currency="INR"))
        db.add(PortfolioHoldingORM(portfolio_id="p", symbol="NSE:TCS", shares=2))
        db.add(ValueChainSnapshot(symbol="TCS.NS", payload={"suppliers": [{"name": "Supplier", "citation": {"quote": "We buy from Supplier", "doc_id": 7}}]}))
        db.add(ResearchDossier(id="owned", user_id="owner", symbol="TCS", payload={"market": "IN", "title": "India thesis"}))
        db.add(ResearchDossier(id="private", user_id="other", symbol="TCS.NS", payload={"market": "IN", "title": "Other thesis"}))
        db.commit()
        result = asyncio.run(portfolio_impact(db, "owner", "p"))
        assert calls == ["TCS.NS"]
        holding = result["items"][0]["holdings"][0]
        assert holding["symbol"] == "TCS.NS"
        assert holding["dossiers"] == [{"id": "owned", "title": "India thesis"}]
        assert holding["weight_pct"] == 100
    engine.dispose()


@pytest.mark.parametrize('timestamp', [1767225600, 1767225600000, '1767225600', '1767225600000', '2026-01-01T05:30:00+05:30'])
def test_quote_timestamp_normalizes_seconds_milliseconds_and_timezone(timestamp):
    from backend.research_inbox.impact import quote_timestamp
    assert quote_timestamp(timestamp) == '2026-01-01T00:00:00+00:00'


@pytest.mark.parametrize('timestamp', [None, True, '2026-01-01', '2026-01-01T00:00:00', 'invalid', float('inf'), -1, 0])
def test_ambiguous_quote_timestamp_remains_unknown(timestamp):
    from backend.research_inbox.impact import quote_timestamp
    assert quote_timestamp(timestamp) is None
