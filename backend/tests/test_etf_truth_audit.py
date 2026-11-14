import pytest
from fastapi import HTTPException
from backend.api.routes import etf

@pytest.mark.asyncio
async def test_missing_holdings_are_not_invented(monkeypatch):
    class Yahoo:
        async def get_quote_summary(self, *args, **kwargs): return {}
    class Fetcher: yahoo = Yahoo()
    async def fetcher(): return Fetcher()
    monkeypatch.setattr(etf, "get_unified_fetcher", fetcher)
    payload = await etf.etf_holdings("AAPL")
    assert payload.holdings == []
    with pytest.raises(HTTPException) as exc:
        await etf.etf_overlap("SPY,VOO")
    assert exc.value.status_code == 503

@pytest.mark.asyncio
async def test_no_random_fund_flows():
    assert (await etf.etf_flows("SPY")).flows == []
