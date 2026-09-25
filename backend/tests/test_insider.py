from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.api.routes import insider as insider_routes
from backend.models.core import InsiderTrade
from backend.shared.db import Base


def _build_client(rows: list[InsiderTrade] | None = None) -> TestClient:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[InsiderTrade.__table__])
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
    app.include_router(insider_routes.router)
    app.dependency_overrides[get_db] = _db
    return TestClient(app)


def _trade(symbol: str, insider: str, kind: str, value: float, days_ago: int, source: str = "NSE") -> InsiderTrade:
    day = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days_ago)
    shares = 1000
    return InsiderTrade(
        symbol=symbol,
        insider_name=insider,
        insider_title="Director",
        transaction_type=kind,
        shares=shares,
        price=value / shares,
        value=value,
        date=day,
        filing_date=day,
        source=source,
    )


def _real_rows() -> list[InsiderTrade]:
    return [
        _trade("RELIANCE", "A One", "buy", 5_000_000, 2),
        _trade("RELIANCE", "B Two", "buy", 3_000_000, 3),
        _trade("RELIANCE", "C Three", "buy", 2_000_000, 4),
        _trade("RELIANCE", "D Four", "sell", 1_500_000, 5),
        _trade("AAPL", "E Five", "sell", 9_000_000, 6, source="SEC"),
    ]


def test_empty_table_is_not_seeded_with_fabricated_rows() -> None:
    client = _build_client()

    assert client.get("/api/insider/recent").json() == {"trades": []}
    assert client.get("/api/insider/top-buyers").json() == {"buyers": []}
    assert client.get("/api/insider/cluster-buys").json() == {"clusters": []}
    # Calling the routes must not have written anything into the table.
    assert client.get("/api/insider/recent", params={"min_value": 0}).json() == {"trades": []}


def test_legacy_seeded_rows_are_never_served() -> None:
    client = _build_client([_trade("LT", "Mukesh D Ambani", "buy", 9_000_000, 1, source="SEEDED")])

    assert client.get("/api/insider/recent", params={"min_value": 0}).json()["trades"] == []


def test_recent_returns_trades_with_market_currency() -> None:
    client = _build_client(_real_rows())

    response = client.get("/api/insider/recent", params={"min_value": 0})

    assert response.status_code == 200
    trades = response.json()["trades"]
    assert {
        "date",
        "symbol",
        "name",
        "insider_name",
        "designation",
        "type",
        "quantity",
        "price",
        "value",
        "post_holding_pct",
        "currency",
    } <= set(trades[0])
    by_symbol = {t["symbol"]: t["currency"] for t in trades}
    assert by_symbol == {"RELIANCE": "INR", "AAPL": "USD"}


def test_stock_returns_trades_and_summary() -> None:
    client = _build_client(_real_rows())

    payload = client.get("/api/insider/stock/RELIANCE", params={"days": 365}).json()

    assert len(payload["trades"]) == 4
    assert payload["summary"]["total_buys"] == 10_000_000
    assert payload["summary"]["total_sells"] == 1_500_000
    assert payload["summary"]["insider_count"] == 4


def test_top_buyers_and_clusters() -> None:
    client = _build_client(_real_rows())

    buyers = client.get("/api/insider/top-buyers", params={"days": 90, "limit": 5}).json()["buyers"]
    assert [b["symbol"] for b in buyers] == ["RELIANCE"]
    assert buyers[0]["currency"] == "INR"

    clusters = client.get("/api/insider/cluster-buys", params={"days": 30, "min_insiders": 3}).json()["clusters"]
    assert [c["symbol"] for c in clusters] == ["RELIANCE"]
    assert clusters[0]["insider_count"] == 3


def test_recent_filters_support_min_value_type_and_days() -> None:
    client = _build_client(_real_rows())

    trades = client.get(
        "/api/insider/recent",
        params={"days": 14, "min_value": 2_500_000, "type": "buy", "limit": 100},
    ).json()["trades"]

    assert [t["insider_name"] for t in trades] == ["A One", "B Two"]
