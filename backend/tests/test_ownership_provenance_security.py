import pytest
from backend.equity.services.shareholding import ShareholdingPattern
from backend.api.routes import fundamentals

def test_provider_warnings_never_expose_authenticated_urls():
    pattern = ShareholdingPattern(symbol="AAPL", quarter="Latest", as_of_date="2026-11-14", warning="Error https://provider.example/data?apikey=FAKE_SECRET")
    assert "FAKE_SECRET" not in pattern.model_dump_json()
    assert "https://" not in pattern.warning

@pytest.mark.asyncio
async def test_holder_fallback_does_not_claim_public_ownership(monkeypatch):
    class Shareholding:
        async def get_shareholding(self, symbol):
            return ShareholdingPattern(symbol=symbol, quarter="Latest", as_of_date="2026-11-14", source="fmp", public_holding=100, promoter_holding=0)
    class FMP:
        async def get_institutional_holders(self, *args, **kwargs): return []
    class Fetcher: fmp=FMP()
    async def fetcher(): return Fetcher()
    async def insiders(*args, **kwargs): return []
    monkeypatch.setattr(fundamentals, "_shareholding_service", Shareholding())
    monkeypatch.setattr(fundamentals, "get_unified_fetcher", fetcher)
    monkeypatch.setattr(fundamentals, "_finnhub_insiders_with_fallback", insiders)
    payload = await fundamentals.ownership_adapter("AAPL")
    assert payload["shareholding"]["public_holding"] is None
    assert payload["shareholding"]["percentages_available"] is False
