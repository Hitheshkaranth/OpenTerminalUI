"""Tests for backend/mcp/resources.py.

Follows the in-memory-SQLite + monkeypatched-SessionLocal pattern from
backend/tests/test_agent_proposals.py.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.shared.db import Base


@pytest.fixture()
def test_db():
    # Import every ORM class resources.py touches so its table registers on Base
    # before create_all runs.
    from backend.db.models import Holding  # noqa: F401
    from backend.models import AlertORM, WatchlistORM  # noqa: F401
    from backend.models.journal import JournalEntry  # noqa: F401
    from backend.saved_views.models import SavedViewORM  # noqa: F401

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    db_session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    db = db_session()
    yield db
    db.close()


@pytest.fixture()
def monkeypatch_session_local(monkeypatch, test_db):
    from unittest.mock import MagicMock

    mock = MagicMock(return_value=test_db)
    monkeypatch.setattr("backend.shared.db.SessionLocal", mock)
    monkeypatch.setattr("backend.mcp.resources.SessionLocal", mock)
    return mock


USER_A = "user-a"
USER_B = "user-b"


@pytest.fixture()
def seeded(test_db, monkeypatch_session_local):
    from backend.db.models import Holding
    from backend.models import AlertORM, AlertStatus, WatchlistORM
    from backend.models.journal import JournalEntry
    from backend.saved_views.models import SavedViewORM

    wl_a = WatchlistORM(id="wl-a", user_id=USER_A, name="A List", symbols_json=["AAPL", "MSFT"])
    wl_b = WatchlistORM(id="wl-b", user_id=USER_B, name="B List", symbols_json=["TSLA"])
    test_db.add_all([wl_a, wl_b])

    sv_a = SavedViewORM(id="sv-a", user_id=USER_A, name="My Screen", scope="screener", page="/screener", payload_json={"filters": {"pe": "<20"}})
    sv_b = SavedViewORM(id="sv-b", user_id=USER_B, name="Other Screen", scope="screener", page="/screener", payload_json={})
    test_db.add_all([sv_a, sv_b])

    now = datetime.now(timezone.utc)
    for i in range(3):
        test_db.add(JournalEntry(
            user_id=USER_A, symbol="AAPL", direction="long",
            entry_date=now - timedelta(days=i), entry_price=100.0 + i, quantity=10,
        ))
    test_db.add(JournalEntry(
        user_id=USER_B, symbol="TSLA", direction="long",
        entry_date=now, entry_price=200.0, quantity=5,
    ))

    test_db.add(AlertORM(id="al-a-active", user_id=USER_A, symbol="AAPL", condition_type="price_above", status=AlertStatus.ACTIVE.value, parameters={"price": 200}))
    test_db.add(AlertORM(id="al-a-triggered", user_id=USER_A, symbol="AAPL", condition_type="price_above", status=AlertStatus.TRIGGERED.value, parameters={}))
    test_db.add(AlertORM(id="al-b-active", user_id=USER_B, symbol="TSLA", condition_type="price_above", status=AlertStatus.ACTIVE.value, parameters={}))

    test_db.add(Holding(ticker="AAPL", quantity=10, avg_buy_price=100.0, buy_date="2024-01-01"))

    test_db.commit()


# ---------------------------------------------------------------------------
# _parse_uri
# ---------------------------------------------------------------------------

def test_parse_uri_with_id():
    from backend.mcp.resources import _parse_uri

    assert _parse_uri("otui://watchlist/3") == ("watchlist", "3")


def test_parse_uri_collection_no_id():
    from backend.mcp.resources import _parse_uri

    assert _parse_uri("otui://watchlist") == ("watchlist", None)


@pytest.mark.parametrize("bad", ["", "not-a-uri", "otui://", "http://watchlist/3", "otui:///leading-slash-only-kind-empty"])
def test_parse_uri_malformed_raises(bad):
    from backend.mcp.resources import _parse_uri

    with pytest.raises(ValueError):
        _parse_uri(bad)


# ---------------------------------------------------------------------------
# list_resources
# ---------------------------------------------------------------------------

def test_list_resources_shape(seeded):
    from backend.mcp.resources import list_resources

    items = list_resources(USER_A)
    assert items, "expected at least the fixed collection resources"
    for item in items:
        assert set(item.keys()) == {"uri", "name", "description", "mimeType"}
        assert item["uri"].startswith("otui://")
        assert item["mimeType"] == "application/json"


def test_list_resources_user_isolation(seeded):
    from backend.mcp.resources import list_resources

    uris_a = {i["uri"] for i in list_resources(USER_A)}
    uris_b = {i["uri"] for i in list_resources(USER_B)}

    assert "otui://watchlist/wl-a" in uris_a
    assert "otui://watchlist/wl-b" not in uris_a
    assert "otui://watchlist/wl-b" in uris_b
    assert "otui://watchlist/wl-a" not in uris_b

    assert "otui://saved-view/sv-a" in uris_a
    assert "otui://saved-view/sv-b" not in uris_a


# ---------------------------------------------------------------------------
# read_resource: malformed / unknown
# ---------------------------------------------------------------------------

def test_read_resource_malformed_uri_is_err(seeded):
    from backend.mcp.resources import read_resource

    result = read_resource("not-a-uri", USER_A)
    assert result["ok"] is False
    assert result["error"]["code"] == "unknown_resource"


def test_read_resource_unknown_kind_is_err(seeded):
    from backend.mcp.resources import read_resource

    result = read_resource("otui://nonsense/1", USER_A)
    assert result["ok"] is False
    assert result["error"]["code"] == "unknown_resource"


# ---------------------------------------------------------------------------
# watchlist
# ---------------------------------------------------------------------------

def test_read_watchlist_collection(seeded):
    from backend.mcp.resources import read_resource

    result = read_resource("otui://watchlist", USER_A)
    assert result["ok"] is True
    ids = {row["id"] for row in result["data"]}
    assert ids == {"wl-a"}  # user isolation: wl-b excluded


def test_read_watchlist_by_id_round_trip(seeded):
    from backend.mcp.resources import list_resources, read_resource

    uri = next(i["uri"] for i in list_resources(USER_A) if i["uri"] == "otui://watchlist/wl-a")
    result = read_resource(uri, USER_A)
    assert result["ok"] is True
    assert result["data"]["id"] == "wl-a"
    assert result["data"]["symbols"] == ["AAPL", "MSFT"]


def test_read_watchlist_by_id_wrong_user_not_found(seeded):
    from backend.mcp.resources import read_resource

    result = read_resource("otui://watchlist/wl-a", USER_B)
    assert result["ok"] is False
    assert result["error"]["code"] == "not_found"


def test_read_watchlist_cap_applied(seeded, monkeypatch_session_local, test_db):
    from backend.models import WatchlistORM

    big = WatchlistORM(id="wl-big", user_id=USER_A, name="Big", symbols_json=[f"SYM{i}" for i in range(80)])
    test_db.add(big)
    test_db.commit()

    from backend.mcp.resources import WATCHLIST_SYMBOL_LIMIT, read_resource

    result = read_resource("otui://watchlist/wl-big", USER_A)
    assert result["ok"] is True
    assert len(result["data"]["symbols"]) == WATCHLIST_SYMBOL_LIMIT
    assert result["truncated"] == 80 - WATCHLIST_SYMBOL_LIMIT


# ---------------------------------------------------------------------------
# portfolio
# ---------------------------------------------------------------------------

def test_read_portfolio_default(seeded):
    from backend.mcp.resources import read_resource

    result = read_resource("otui://portfolio/default", USER_A)
    assert result["ok"] is True
    assert result["data"]["items"][0]["ticker"] == "AAPL"
    assert result["data"]["total_cost"] == 1000.0


# ---------------------------------------------------------------------------
# saved-view
# ---------------------------------------------------------------------------

def test_read_saved_view_collection_user_isolated(seeded):
    from backend.mcp.resources import read_resource

    result = read_resource("otui://saved-view", USER_A)
    assert result["ok"] is True
    ids = {row["id"] for row in result["data"]}
    assert ids == {"sv-a"}


def test_read_saved_view_by_id_includes_payload(seeded):
    from backend.mcp.resources import read_resource

    result = read_resource("otui://saved-view/sv-a", USER_A)
    assert result["ok"] is True
    assert result["data"]["payload"] == {"filters": {"pe": "<20"}}


def test_read_saved_view_wrong_user_not_found(seeded):
    from backend.mcp.resources import read_resource

    result = read_resource("otui://saved-view/sv-b", USER_A)
    assert result["ok"] is False
    assert result["error"]["code"] == "not_found"


# ---------------------------------------------------------------------------
# journal
# ---------------------------------------------------------------------------

def test_read_journal_recent_user_isolated_and_ordered(seeded):
    from backend.mcp.resources import read_resource

    result = read_resource("otui://journal/recent", USER_A)
    assert result["ok"] is True
    rows = result["data"]
    assert all(r["symbol"] == "AAPL" for r in rows)
    assert len(rows) == 3
    # newest entry_date first
    dates = [r["entry_date"] for r in rows]
    assert dates == sorted(dates, reverse=True)


def test_read_journal_recent_cap(seeded, monkeypatch_session_local, test_db):
    from backend.models.journal import JournalEntry

    now = datetime.now(timezone.utc)
    for i in range(20):
        test_db.add(JournalEntry(
            user_id=USER_A, symbol="MSFT", direction="long",
            entry_date=now - timedelta(days=100 + i), entry_price=1.0, quantity=1,
        ))
    test_db.commit()

    from backend.mcp.resources import JOURNAL_RECENT_LIMIT, read_resource

    result = read_resource("otui://journal/recent", USER_A)
    assert result["ok"] is True
    assert len(result["data"]) == JOURNAL_RECENT_LIMIT


# ---------------------------------------------------------------------------
# alerts
# ---------------------------------------------------------------------------

def test_read_alerts_active_only_and_user_isolated(seeded):
    from backend.mcp.resources import read_resource

    result = read_resource("otui://alerts/active", USER_A)
    assert result["ok"] is True
    ids = {row["id"] for row in result["data"]}
    assert ids == {"al-a-active"}  # triggered alert and other-user alert excluded
