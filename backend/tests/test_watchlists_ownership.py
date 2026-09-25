from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pandas as pd
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.api.routes import statlab
from backend.api.routes import watchlists as mod
from backend.models import WatchlistORM


def _session():
    engine = create_engine("sqlite:///:memory:")
    WatchlistORM.__table__.create(engine)
    return sessionmaker(bind=engine)()


def test_watchlist_mutations_are_scoped_to_owner():
    db = _session()
    owner = SimpleNamespace(id="owner")
    other = SimpleNamespace(id="intruder")
    wl_id = mod.create_watchlist(mod.WatchlistCreate(name="Mine", symbols=["TCS"]), db=db, current_user=owner)["id"]

    for call in (
        lambda: mod.update_watchlist(wl_id, mod.WatchlistUpdate(symbols=[]), db=db, current_user=other),
        lambda: mod.add_symbols(wl_id, ["INFY"], db=db, current_user=other),
        lambda: mod.remove_symbol(wl_id, "TCS", db=db, current_user=other),
        lambda: mod.delete_watchlist(wl_id, db=db, current_user=other),
    ):
        with pytest.raises(HTTPException) as exc:
            call()
        assert exc.value.status_code == 404

    assert mod.add_symbols(wl_id, ["INFY"], db=db, current_user=owner)["symbols"] == ["TCS", "INFY"]
    assert mod.delete_watchlist(wl_id, db=db, current_user=owner) == {"status": "deleted"}


def test_cointegration_selects_series_by_ticker_not_column_position(monkeypatch):
    idx = pd.date_range("2025-01-01", periods=40)
    # yfinance sorts columns alphabetically: requested (ZZZ, AAA) comes back as (AAA, ZZZ).
    df = pd.DataFrame({"AAA": range(40), "ZZZ": range(100, 140)}, index=idx, dtype=float)
    monkeypatch.setattr(statlab.backtester, "_download_close", lambda *a, **k: df)
    seen = {}

    def fake_analysis(sa, sb, **_):
        seen["a"], seen["b"] = sa.name, sb.name
        return {}

    monkeypatch.setattr(statlab, "cointegration_analysis", fake_analysis)
    asyncio.run(statlab.post_cointegration(statlab.CointegrationRequest(ticker_a="ZZZ", ticker_b="AAA")))
    assert seen == {"a": "ZZZ", "b": "AAA"}
