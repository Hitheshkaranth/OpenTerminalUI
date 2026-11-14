from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.api.routes import watchlists as routes
from backend.models import WatchlistORM


@pytest.fixture
def saved_list():
    engine = create_engine("sqlite:///:memory:")
    WatchlistORM.__table__.create(engine)
    db = sessionmaker(bind=engine)()
    owner = SimpleNamespace(id="owner")
    row = routes.create_watchlist(routes.WatchlistCreate(name="Audit", symbols=["AAPL"]), db=db, current_user=owner)
    yield db, owner, row["id"]
    db.close()
    engine.dispose()


@pytest.mark.parametrize("name", ["", "   ", "x" * 81, "unsafe\nname", "null\x00name"])
def test_invalid_names_rejected_at_request_boundary(name):
    with pytest.raises(ValidationError):
        routes.WatchlistCreate(name=name)
    with pytest.raises(ValidationError):
        routes.WatchlistUpdate(name=name)


@pytest.mark.parametrize("symbol", ["=1+1", "AAPL MSFT", "\x00TCS", "X" * 81, "", "   "])
def test_invalid_bulk_symbols_cannot_partially_modify_saved_list(saved_list, symbol):
    db, owner, identifier = saved_list
    with pytest.raises(HTTPException) as exc:
        routes.add_symbols(identifier, ["MSFT", symbol], db=db, current_user=owner)
    assert exc.value.status_code == 422
    assert db.query(WatchlistORM).first().symbols_json == ["AAPL"]


def test_create_update_and_add_normalize_the_same_financial_identifiers(saved_list):
    db, owner, identifier = saved_list
    result = routes.update_watchlist(identifier, routes.WatchlistUpdate(symbols=[" gc=f ", "NASDAQ:AAPL", "gc=f", "NFO:NIFTY26NOVFUT"]), db=db, current_user=owner)
    assert result["symbols"] == ["GC=F", "NASDAQ:AAPL", "NFO:NIFTY26NOVFUT"]
    assert routes.add_symbols(identifier, [" gc=f "], db=db, current_user=owner)["symbols"] == result["symbols"]


@pytest.mark.parametrize("symbols, expected", [
    (["", "  ", " aapl ", "AAPL", "\t", "GC=F"], ["AAPL", "GC=F"]),
    (["", " \t\n"], []),
])
def test_creation_ignores_blank_import_rows(saved_list, symbols, expected):
    db, owner, _ = saved_list
    result = routes.create_watchlist(routes.WatchlistCreate(name="Imported", symbols=symbols), db=db, current_user=owner)
    assert result["symbols"] == expected


@pytest.mark.parametrize("symbol", ["=1+1", "AAPL MSFT", "\x00TCS"])
def test_blank_create_rows_do_not_bypass_identifier_validation(saved_list, symbol):
    db, owner, _ = saved_list
    before = db.query(WatchlistORM).count()
    with pytest.raises(HTTPException) as exc:
        routes.create_watchlist(routes.WatchlistCreate(name="Invalid import", symbols=["", "MSFT", symbol]), db=db, current_user=owner)
    assert exc.value.status_code == 422
    assert db.query(WatchlistORM).count() == before


def test_bulk_and_total_membership_limits_are_enforced(saved_list):
    db, owner, identifier = saved_list
    with pytest.raises(HTTPException) as exc:
        routes.add_symbols(identifier, [f"S{i}" for i in range(501)], db=db, current_user=owner)
    assert exc.value.status_code == 422
    routes.update_watchlist(identifier, routes.WatchlistUpdate(symbols=[f"S{i}" for i in range(1000)]), db=db, current_user=owner)
    with pytest.raises(HTTPException) as exc:
        routes.add_symbols(identifier, ["MSFT"], db=db, current_user=owner)
    assert exc.value.status_code == 422
    assert len(db.query(WatchlistORM).first().symbols_json) == 1000
