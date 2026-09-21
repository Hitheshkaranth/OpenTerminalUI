from __future__ import annotations

import pytest

from backend.api.routes.kite import kite_holdings, kite_positions
from backend.core.kite_client import KiteClient


@pytest.fixture
def fake_kite(monkeypatch):
    class FakeKite:
        api_key = "test_key"

        def resolve_access_token(self, override=None):
            return "tok"

        async def get_holdings(self, access_token):
            return [
                {
                    "tradingsymbol": "RELIANCE",
                    "exchange": "NSE",
                    "isin": "INE204A01027",
                    "quantity": 10,
                    "t1_quantity": 5,
                    "average_price": 2200.0,
                    "last_price": 2350.0,
                    "pnl": 1500.0,
                    "product": "CNC",
                },
                {
                    "tradingsymbol": "TCS",
                    "exchange": "BSE",
                    "isin": "INE467B01029",
                    "quantity": 20,
                    "average_price": 3500.0,
                    "last_price": 3600.0,
                    "pnl": 2000.0,
                    "product": "MIS",
                },
            ]

        async def get_positions(self, access_token):
            return {
                "net": [
                    {
                        "tradingsymbol": "INFY",
                        "exchange": "NSE",
                        "quantity": -5,
                        "average_price": 1400.0,
                        "last_price": 1450.0,
                        "pnl": -250.0,
                        "product": "NRML",
                        "day_m2m": -500.0,
                    },
                ],
                "day": [],
            }

    fake = FakeKite()
    monkeypatch.setattr("backend.api.routes.kite.kite", fake)
    return fake


@pytest.mark.asyncio
async def test_kite_holdings(monkeypatch, fake_kite):
    result = await kite_holdings(authorization="Bearer tok")
    assert result["source"] == "kite"
    assert "fetched_at" in result
    holdings = result["holdings"]
    assert len(holdings) == 2

    # First row: quantity = quantity + t1_quantity
    h0 = holdings[0]
    assert h0["symbol"] == "RELIANCE"
    assert h0["exchange"] == "NSE"
    assert h0["isin"] == "INE204A01027"
    assert h0["quantity"] == 15.0  # 10 + 5
    assert h0["average_price"] == 2200.0
    assert h0["last_price"] == 2350.0
    assert h0["pnl"] == 1500.0
    assert h0["product"] == "CNC"

    # Second row: no t1_quantity
    h1 = holdings[1]
    assert h1["symbol"] == "TCS"
    assert h1["quantity"] == 20.0


@pytest.mark.asyncio
async def test_kite_positions(monkeypatch, fake_kite):
    result = await kite_positions(authorization="Bearer tok")
    assert result["source"] == "kite"
    assert "fetched_at" in result
    positions = result["positions"]
    assert len(positions) == 1

    p0 = positions[0]
    assert p0["symbol"] == "INFY"
    assert p0["quantity"] == -5.0
    assert p0["side"] == "short"
    assert p0["isin"] is None
    assert p0["day_pnl"] == -500.0
    assert p0["pnl"] == -250.0
    assert p0["product"] == "NRML"


@pytest.mark.asyncio
async def test_kite_holdings_400_when_no_api_key(monkeypatch):
    class NoKeyKite:
        api_key = ""

    from backend.api.routes import kite as kite_module
    monkeypatch.setattr(kite_module, "kite", NoKeyKite())

    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        await kite_holdings(authorization="Bearer tok")
    assert exc_info.value.status_code == 400
    assert "KITE_API_KEY is not configured" in exc_info.value.detail


@pytest.mark.asyncio
async def test_kite_positions_400_when_no_api_key(monkeypatch):
    class NoKeyKite:
        api_key = ""

    from backend.api.routes import kite as kite_module
    monkeypatch.setattr(kite_module, "kite", NoKeyKite())

    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        await kite_positions(authorization="Bearer tok")
    assert exc_info.value.status_code == 400
    assert "KITE_API_KEY is not configured" in exc_info.value.detail

@pytest.mark.asyncio
async def test_empty_kite_account_is_200_not_502(monkeypatch):
    """A Kite account with zero holdings must not be reported as a fetch failure."""

    class EmptyKite:
        api_key = "k"

        def resolve_access_token(self, override=None):
            return "tok"

        async def get_holdings(self, access_token):
            return []

        async def get_positions(self, access_token):
            return {"net": [], "day": []}

    monkeypatch.setattr("backend.api.routes.kite.kite", EmptyKite())
    out = await kite_holdings(authorization="Bearer tok")
    assert out["holdings"] == [] and out["source"] == "kite"
    out = await kite_positions(authorization="Bearer tok")
    assert out["positions"] == []


@pytest.mark.asyncio
async def test_kite_request_failure_is_502_with_token_hint(monkeypatch):
    from fastapi import HTTPException

    class FailingKite:
        api_key = "k"

        def resolve_access_token(self, override=None):
            return "tok"

        async def get_holdings(self, access_token):
            return None  # KiteClient returns None on auth/network failure

    monkeypatch.setattr("backend.api.routes.kite.kite", FailingKite())
    with pytest.raises(HTTPException) as ei:
        await kite_holdings(authorization="Bearer tok")
    assert ei.value.status_code == 502
    assert "KITE_ACCESS_TOKEN" in ei.value.detail


def test_kite_client_distinguishes_empty_from_failure():
    import asyncio

    async def run():
        kc = KiteClient(api_key="k", api_secret="s")

        async def ok(endpoint, token, params=None):
            return {"status": "success", "data": []}

        async def bad(endpoint, token, params=None):
            return {}

        kc._get = ok  # type: ignore[assignment]
        assert await kc.get_holdings("t") == []
        kc._get = bad  # type: ignore[assignment]
        assert await kc.get_holdings("t") is None
        assert await kc.get_positions("t") is None

    asyncio.run(run())
