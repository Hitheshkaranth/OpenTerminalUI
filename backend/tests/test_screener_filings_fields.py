from __future__ import annotations

import math

import pandas as pd
import pytest
from sqlalchemy import text

import backend.screener.engine as screener_engine
from backend.business_metrics.models import BusinessMetricORM
from backend.filings_rag.models import FilingAnalysisORM
from backend.screener.engine import RunConfig, ScreenerEngine
from backend.screener.fields import list_fields, resolve_field_name
from backend.screener.filings_fields import load_filings_fields


@pytest.fixture
def db_session():
    from backend.shared.db import Base, SessionLocal, engine
    from sqlalchemy import text

    # Isolate each test: the throwaway SQLite DB is shared across the suite, so
    # drop the filings/business/snapshot tables before every test.
    BusinessMetricORM.__table__.drop(bind=engine, checkfirst=True)
    FilingAnalysisORM.__table__.drop(bind=engine, checkfirst=True)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS screener_snapshot"))
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _payload(net=10.0, growth=None, headwind=None, stance="balanced",
             growth_drivers=None, headwind_drivers=None) -> dict:
    scores = {"net": net}
    if growth is not None:
        scores["growth"] = growth
    if headwind is not None:
        scores["headwind"] = headwind
    return {
        "scores": scores,
        "stance": stance,
        "growth": list(growth_drivers or []),
        "headwinds": list(headwind_drivers or []),
    }


def _seed_analysis(session, symbol, payload) -> FilingAnalysisORM:
    row = FilingAnalysisORM(symbol=symbol, engine="lexical", payload=payload)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def _seed_order_book(session, symbol, points):
    for period, value in points:
        session.add(
            BusinessMetricORM(
                symbol=symbol, kind="kpi", key="order_book", category="order_book",
                period=period, value=value,
            )
        )
    session.commit()


_SCREENER_DF = pd.DataFrame(
    [
        {"ticker": "AAA", "company_name": "Alpha", "sector": "Technology",
         "current_price": 100.0, "market_cap": 500.0, "roe_pct": 22.0, "pe": 15.0},
        {"ticker": "BBB", "company_name": "Bravo", "sector": "Consumer",
         "current_price": 50.0, "market_cap": 300.0, "roe_pct": 12.0, "pe": 20.0},
    ]
)


def _run_engine(df: pd.DataFrame, query: str) -> dict:
    engine_instance = ScreenerEngine()
    original = screener_engine.load_screener_df
    screener_engine.load_screener_df = lambda symbols: df
    try:
        return engine_instance.run(RunConfig(query=query, universe="nse_500", limit=100))
    finally:
        screener_engine.load_screener_df = original


def _isna(value) -> bool:
    try:
        return value is None or (isinstance(value, float) and math.isnan(value))
    except TypeError:
        return False


# ── Field registration ───────────────────────────────────────────────

FILING_FIELD_KEYS = {
    "filings_growth_score",
    "filings_headwind_score",
    "filings_net_score",
    "filings_stance",
    "order_book_value",
    "implied_growth_pct",
    "adverse_regulatory_flag",
}


def test_list_fields_includes_all_filings_fields() -> None:
    keys = {field["key"] for field in list_fields()}
    assert FILING_FIELD_KEYS.issubset(keys)
    for field in list_fields():
        if field["key"] in FILING_FIELD_KEYS:
            assert field["category"] == "Filings Intelligence"


def test_filing_field_aliases_resolve_to_canonical_keys() -> None:
    assert resolve_field_name("growth score") == "filings_growth_score"
    assert resolve_field_name("headwind score") == "filings_headwind_score"
    assert resolve_field_name("order book") == "order_book_value"
    assert resolve_field_name("filings net score") == "filings_net_score"
    assert resolve_field_name("stance") == "filings_stance"


# ── load_filings_fields ──────────────────────────────────────────────

def test_load_filings_fields_reads_scores_stance_and_flag(db_session) -> None:
    _seed_analysis(db_session, "AAA", _payload(net=25.0, growth=35.0, headwind=10.0, stance="constructive"))
    result = load_filings_fields(db_session, ["AAA", "MISSING"])
    assert result["AAA"]["filings_growth_score"] == 35.0
    assert result["AAA"]["filings_headwind_score"] == 10.0
    assert result["AAA"]["filings_net_score"] == 25.0
    assert result["AAA"]["filings_stance"] == "constructive"
    assert result["AAA"]["adverse_regulatory_flag"] == 0
    assert "MISSING" not in result


def test_latest_analysis_row_wins(db_session) -> None:
    _seed_analysis(db_session, "AAA", _payload(net=5.0))
    _seed_analysis(db_session, "AAA", _payload(net=40.0))
    result = load_filings_fields(db_session, ["AAA"])
    assert result["AAA"]["filings_net_score"] == 40.0


def test_adverse_flag_only_from_headwind_regulatory_driver(db_session) -> None:
    growth_driver = {
        "id": "regulatory_approvals", "label": "Regulatory approvals", "kind": "growth",
        "summary": "FDA approval", "strength": 80,
        "findings": [{"claim": "approved", "magnitude": "high", "confidence": 0.9}],
    }
    adverse_driver = {
        "id": "adverse_regulatory", "label": "Adverse regulatory", "kind": "headwind",
        "summary": "warning letter", "strength": 70,
        "findings": [{"claim": "483", "magnitude": "high", "confidence": 0.9}],
    }
    _seed_analysis(db_session, "ADVERSE", _payload(headwind_drivers=[adverse_driver]))
    _seed_analysis(db_session, "CLEAN", _payload(growth_drivers=[growth_driver]))

    result = load_filings_fields(db_session, ["ADVERSE", "CLEAN"])
    assert result["ADVERSE"]["adverse_regulatory_flag"] == 1
    assert result["CLEAN"]["adverse_regulatory_flag"] == 0


def test_missing_scores_never_become_zero(db_session) -> None:
    payload = _payload(net=25.0)
    payload["scores"] = {"net": 25.0}
    _seed_analysis(db_session, "AAA", payload)
    result = load_filings_fields(db_session, ["AAA"])
    assert result["AAA"]["filings_growth_score"] is None
    assert result["AAA"]["filings_headwind_score"] is None


def test_latest_order_book_kpi_is_read(db_session) -> None:
    _seed_analysis(db_session, "AAA", _payload())
    _seed_order_book(db_session, "AAA", [("Q1-24", 100.0), ("Q2-24", 250.0), ("Q3-24", 175.0)])
    result = load_filings_fields(db_session, ["AAA"])
    assert result["AAA"]["order_book_value"] == 175.0


def test_implied_growth_omitted_when_not_available(db_session) -> None:
    _seed_analysis(db_session, "AAA", _payload())
    result = load_filings_fields(db_session, ["AAA"])
    assert "implied_growth_pct" not in result["AAA"]


def test_implied_growth_read_when_cheaply_available(db_session) -> None:
    from backend.shared.db import engine

    _seed_analysis(db_session, "AAA", _payload())
    with engine.begin() as conn:
        conn.execute(
            text("CREATE TABLE IF NOT EXISTS screener_snapshot "
                 "(ticker TEXT PRIMARY KEY, implied_growth_pct REAL)")
        )
        conn.execute(
            text("INSERT INTO screener_snapshot (ticker, implied_growth_pct) VALUES ('AAA', 8.5)")
        )
    result = load_filings_fields(db_session, ["AAA"])
    assert result["AAA"]["implied_growth_pct"] == 8.5


def test_load_filings_fields_survives_missing_tables() -> None:
    from backend.shared.db import SessionLocal

    session = SessionLocal()
    try:
        session.rollback()
        result = load_filings_fields(session, ["ANY", "THING"])
    finally:
        session.close()
    assert result == {}


# ── Screen integration ───────────────────────────────────────────────

def test_screen_filters_on_seeded_filings_net_score(db_session) -> None:
    _seed_analysis(db_session, "AAA", _payload(net=25.0, growth=35.0, headwind=10.0, stance="constructive"))
    result = _run_engine(_SCREENER_DF, "filings_net_score > 20")

    tickers = [row["ticker"] for row in result["results"]]
    assert tickers == ["AAA"]
    aaa = result["results"][0]
    assert aaa["filings_net_score"] == 25.0
    assert aaa["filings_growth_score"] == 35.0
    assert aaa["filings_stance"] == "constructive"


def test_symbols_without_analysis_excluded_from_positive_threshold(db_session) -> None:
    result = _run_engine(_SCREENER_DF, "filings_net_score > 0")
    assert result["total_results"] == 0
    assert result["results"] == []

    _seed_analysis(db_session, "AAA", _payload(net=5.0))
    result = _run_engine(_SCREENER_DF, "filings_net_score > 0")
    tickers = [row["ticker"] for row in result["results"]]
    assert tickers == ["AAA"]
    assert "BBB" not in tickers


def test_adverse_regulatory_flag_filter_matches_clean_symbols(db_session) -> None:
    clean_driver = {
        "id": "market_expansion", "label": "Market expansion", "kind": "growth",
        "summary": "new geography", "strength": 60, "findings": [],
    }
    _seed_analysis(db_session, "AAA", _payload(headwind_drivers=[clean_driver]))
    result = _run_engine(_SCREENER_DF, "adverse_regulatory_flag == 0")
    tickers = [row["ticker"] for row in result["results"]]
    assert tickers == ["AAA"]
    assert result["results"][0]["adverse_regulatory_flag"] == 0


def test_screen_without_any_filings_data_does_not_crash(db_session) -> None:
    result = _run_engine(_SCREENER_DF, "market_cap > 100 AND ROE > 10")
    assert result["total_results"] == 2
    for row in result["results"]:
        assert _isna(row.get("filings_net_score"))
        assert row.get("filings_stance") is None