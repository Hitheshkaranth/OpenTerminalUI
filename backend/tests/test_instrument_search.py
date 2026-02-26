import os
os.environ["AUTH_MIDDLEWARE_ENABLED"] = "0"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.main import app
from backend.shared.db import Base
from backend.api.deps import get_db
from backend.instruments.models import InstrumentMaster

_engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
Base.metadata.create_all(bind=_engine)
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)
_db = _Session()
_db.add_all([
    InstrumentMaster(canonical_id="AAPL_US_EQ", display_symbol="AAPL", type="spot", exchange="NASDAQ"),
    InstrumentMaster(canonical_id="AAPL1_US_EQ", display_symbol="AAPL1", type="spot", exchange="NASDAQ"),
    InstrumentMaster(canonical_id="BAAPL_US_EQ", display_symbol="BAAPL", type="spot", exchange="NASDAQ"),
])
_db.commit()


def _override_get_db():
    try:
        yield _db
    finally:
        pass


@pytest.fixture(scope="module")
def client():
    app.dependency_overrides[get_db] = _override_get_db
    yield TestClient(app)
    app.dependency_overrides.pop(get_db, None)


def test_instrument_search_ranking(client):
    r = client.get("/api/instruments/search?q=AAPL")
    assert r.status_code == 200
    res = r.json()["results"]

    assert len(res) == 3
    # Exact match first
    assert res[0]["display_symbol"] == "AAPL"
    # Prefix match second
    assert res[1]["display_symbol"] == "AAPL1"
    # Fuzzy match last
    assert res[2]["display_symbol"] == "BAAPL"
