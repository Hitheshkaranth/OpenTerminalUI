from datetime import date
import pytest
from backend.fno.services.nse_derivatives import normalize_futures_snapshot
from backend.fno.routes import futures

def fixture():
    return {"timestamp":"13-Nov-2026 15:40:00", "data":[
        {"instrumentType":"FUTIDX","underlying":"NIFTY","expiryDate":"29-Dec-2099","identifier":"FUTIDX-NIFTY-2099-12","lastPrice":25175,"pchange":-0.528,"openInterest":181390,"totalTradedVolume":42051,"ticksize":0.1},
        {"instrumentType":"OPTIDX","underlying":"NIFTY","expiryDate":"29-Dec-2099","identifier":"OPTION","lastPrice":10},
        {"instrumentType":"FUTIDX","underlying":"BANKNIFTY","expiryDate":"29-Dec-2099","identifier":"OTHER","lastPrice":60000},
        {"instrumentType":"FUTIDX","underlying":"NIFTY","expiryDate":"29-Dec-2025","identifier":"EXPIRED","lastPrice":20000}]}

def test_only_observed_current_futures_are_returned_without_fake_broker_ids():
    payload=normalize_futures_snapshot("NIFTY",fixture(),today=date(2026,11,14))
    assert payload["count"]==1
    assert payload["source"]=="nse_snapshot"
    assert payload["as_of"]=="2026-11-13T10:10:00+00:00"
    contract=payload["contracts"][0]
    assert contract["ltp"]==25175
    assert contract["instrument_token"] is None
    assert contract["lot_size"] is None
    assert contract["ws_symbol"]==""
    assert payload["ws_symbols"]==[]
    assert payload["token_to_ws_symbol"]=={}

def test_empty_provider_response_does_not_create_simulated_contracts():
    payload=normalize_futures_snapshot("NIFTY",{})
    assert payload["contracts"]==[]
    assert payload["data_status"]=="unavailable"

@pytest.mark.asyncio
async def test_futures_route_uses_official_snapshot_when_catalogue_is_empty(monkeypatch):
    class Cache:
        def build_key(self,*args):return "test"
        async def get(self,*args):return None
        async def set(self,*args,**kwargs):pass
    class Query:
        def filter(self,*args):return self
        def order_by(self,*args):return self
        def all(self):return []
    class DB:
        def query(self,*args):return Query()
        def close(self):pass
    async def snapshot(symbol):return normalize_futures_snapshot(symbol,fixture(),today=date(2026,11,14))
    monkeypatch.setattr(futures,"cache_instance",Cache())
    monkeypatch.setattr(futures,"SessionLocal",DB)
    monkeypatch.setattr(futures,"get_nse_futures_snapshot",snapshot)
    result=await futures.get_futures_chain("nifty")
    assert result["count"]==1
    assert result["contracts"][0]["ltp"]==25175
