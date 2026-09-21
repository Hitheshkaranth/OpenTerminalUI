from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.api.routes.portfolio import router as portfolio_router
from backend.models import Holding
from backend.shared.db import Base


def _build_client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.include_router(portfolio_router, prefix="/api")

    def _db_override():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db_override
    return TestClient(app), SessionLocal


def test_import_append_with_invalid_rows():
    """Append of 3 rows with 1 invalid: imported=2, skipped=1, error row index correct."""
    client, SessionLocal = _build_client()
    payload = {
        "source": "csv",
        "mode": "append",
        "rows": [
            {"ticker": "reliance", "quantity": 10, "avg_buy_price": 2200.0, "buy_date": "2025-01-15"},
            {"ticker": "", "quantity": 5, "avg_buy_price": 500.0},
            {"ticker": "tcs", "quantity": 3, "avg_buy_price": 3500.0},
        ],
    }
    resp = client.post("/api/portfolio/import", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["imported"] == 2
    assert data["skipped"] == 1
    assert data["mode"] == "append"
    assert len(data["errors"]) == 1
    err = data["errors"][0]
    assert err["row"] == 1
    assert err["reason"] == "empty ticker"

    # Verify the 2 valid rows are in DB
    db = SessionLocal()
    rows = db.query(Holding).all()
    assert len(rows) == 2
    tickers = {r.ticker for r in rows}
    assert tickers == {"RELIANCE", "TCS"}
    db.close()


def test_import_replace_clears_prior():
    """Replace clears prior rows, then inserts new ones."""
    client, SessionLocal = _build_client()

    # Seed existing holding
    db = SessionLocal()
    db.add(Holding(ticker="OLD", quantity=1, avg_buy_price=100.0, buy_date="2025-01-01"))
    db.commit()
    db.close()

    payload = {
        "source": "kite",
        "mode": "replace",
        "rows": [
            {"ticker": "AAPL", "quantity": 10, "avg_buy_price": 150.0},
        ],
    }
    resp = client.post("/api/portfolio/import", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["imported"] == 1
    assert data["skipped"] == 0

    db = SessionLocal()
    rows = db.query(Holding).all()
    assert len(rows) == 1
    assert rows[0].ticker == "AAPL"
    db.close()


def test_import_too_many_rows():
    """More than 2000 rows → 413."""
    client, _ = _build_client()
    rows = [{"ticker": f"SYM{i}", "quantity": 1, "avg_buy_price": 100.0} for i in range(2001)]
    payload = {"source": "csv", "mode": "append", "rows": rows}
    resp = client.post("/api/portfolio/import", json=payload)
    assert resp.status_code == 413


def test_import_buy_date_defaults_today():
    """Missing buy_date defaults to today's UTC YYYY-MM-DD."""
    client, SessionLocal = _build_client()
    today = datetime.now(timezone.utc).date().isoformat()
    payload = {
        "source": "csv",
        "mode": "append",
        "rows": [
            {"ticker": "HDFC", "quantity": 5, "avg_buy_price": 1600.0},
        ],
    }
    resp = client.post("/api/portfolio/import", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["imported"] == 1

    db = SessionLocal()
    row = db.query(Holding).filter(Holding.ticker == "HDFC").first()
    assert row is not None
    assert row.buy_date == today
    db.close()


def test_import_bad_buy_date_skipped():
    """Invalid date string → skipped with reason."""
    client, _ = _build_client()
    payload = {
        "source": "csv",
        "mode": "append",
        "rows": [
            {"ticker": "INFY", "quantity": 10, "avg_buy_price": 1400.0, "buy_date": "01-15-2025"},
        ],
    }
    resp = client.post("/api/portfolio/import", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["imported"] == 0
    assert data["skipped"] == 1
    assert len(data["errors"]) == 1
    assert data["errors"][0]["row"] == 0
    assert data["errors"][0]["reason"] == "buy_date must be YYYY-MM-DD"


def test_import_quantity_validation():
    """quantity <= 0 → skipped."""
    client, _ = _build_client()
    payload = {
        "source": "csv",
        "mode": "append",
        "rows": [
            {"ticker": "WIPRO", "quantity": 0, "avg_buy_price": 500.0},
        ],
    }
    resp = client.post("/api/portfolio/import", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["imported"] == 0
    assert data["skipped"] == 1
    assert data["errors"][0]["reason"] == "quantity must be > 0"


def test_import_avg_buy_price_validation():
    """avg_buy_price <= 0 → skipped."""
    client, _ = _build_client()
    payload = {
        "source": "csv",
        "mode": "append",
        "rows": [
            {"ticker": "SBIN", "quantity": 10, "avg_buy_price": -5},
        ],
    }
    resp = client.post("/api/portfolio/import", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["imported"] == 0
    assert data["skipped"] == 1
    assert data["errors"][0]["reason"] == "avg_buy_price must be > 0"