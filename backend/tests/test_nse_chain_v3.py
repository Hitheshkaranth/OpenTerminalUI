from datetime import datetime, timezone
import pytest
from backend.fno.services.option_chain_fetcher import OptionChainFetcher

class Session:
    def __init__(self): self.calls=[]
    def get(self, path, params):
        self.calls.append((path, params))
        if path.endswith("contract-info"):
            return {"expiryDates":["29-Dec-2099", "25-Jan-2100"]}
        return {"records":{"expiryDates":["29-Dec-2099", "25-Jan-2100"], "underlyingValue":25000,
            "timestamp":"13-Nov-2026 15:40:00", "data":[{"expiryDates":params["expiry"], "strikePrice":25000,
            "CE":{"lastPrice":100,"buyPrice1":99,"sellPrice1":101,"openInterest":100,"impliedVolatility":12},
            "PE":{"lastPrice":90,"buyPrice1":89,"sellPrice1":91,"openInterest":120,"impliedVolatility":13}}]}}

@pytest.mark.parametrize("symbol,kind",[("NIFTY","Indices"),("BANKNIFTY","Indices"),("RELIANCE","Equity")])
def test_current_nse_flow_uses_published_expiry_and_bid_ask_aliases(symbol, kind):
    session=Session();fetcher=OptionChainFetcher(nse_session=session)
    raw=fetcher._fetch_with_nse_api(symbol, "2100-01-25")
    assert session.calls[1]==("/api/option-chain-v3",{"symbol":symbol,"type":kind,"expiry":"25-Jan-2100"})
    chain=fetcher._from_nse_records(symbol,raw,"2100-01-25")
    assert chain["expiry_date"]=="2100-01-25"
    assert len(chain["strikes"])==1
    assert chain["strikes"][0]["ce"]["bid"]==99
    assert chain["strikes"][0]["pe"]["ask"]==91
    assert chain["timestamp"]=="2026-11-13T10:10:00+00:00"
    assert chain["totals"]["pcr_oi"]==1.2

def test_empty_http_success_is_not_a_populated_chain():
    class Empty(Session):
        def get(self,path,params): return {"expiryDates":["29-Dec-2099"]} if path.endswith("contract-info") else {}
    assert OptionChainFetcher(nse_session=Empty())._fetch_with_nse_api("NIFTY") is None

def test_leg_date_format_and_requested_expiry_filtering():
    fetcher=OptionChainFetcher(nse_session=Session())
    assert fetcher._as_iso_date("17-11-2026")=="2026-11-17"
    raw=fetcher._fetch_with_nse_api("NIFTY")
    raw["records"]["data"].append({"expiryDates":"25-Jan-2100","strikePrice":26000,"CE":{},"PE":{}})
    assert len(fetcher._from_nse_records("NIFTY",raw,"2099-12-29")["strikes"])==1

@pytest.mark.asyncio
async def test_index_chain_never_routes_to_unknown_symbol_us_default(monkeypatch):
    class Cache:
        def build_key(self,*args):return "index"
        async def get(self,*args):return None
        async def set(self,*args,**kwargs):pass
    class IV:
        def _atm_iv(self,chain):return 12
        async def _iv_rank_percentile(self,*args):return None,None
    from backend.fno.services import iv_engine
    monkeypatch.setattr(iv_engine,"get_iv_engine",IV)
    fetcher=OptionChainFetcher(nse_session=Session(),cache=Cache())
    def forbidden():raise AssertionError("NIFTY must not use the US default classifier")
    monkeypatch.setattr(fetcher,"_get_market_classifier",forbidden)
    chain=await fetcher.get_option_chain("NIFTY")
    assert chain["market"]=="NSE"
    assert chain["strikes"]
    assert (await fetcher.get_expiry_dates("NIFTY"))[0]=="2099-12-29"

@pytest.mark.asyncio
async def test_index_classification_works_without_equity_listing_or_profile(monkeypatch):
    from backend.shared.market_classifier import MarketClassifier
    classifier=MarketClassifier()
    async def forbidden(*args):raise AssertionError("Index must not require a profile")
    monkeypatch.setattr(classifier,"_fetch_fmp_profile",forbidden)
    try:
        result=await classifier.classify("BANKNIFTY")
        assert result.country_code=="IN"
        assert result.has_futures and result.has_options
    finally:
        await classifier.close()
