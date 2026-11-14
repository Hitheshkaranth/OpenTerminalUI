import pytest
from backend.api.routes import tape

@pytest.mark.asyncio
async def test_fallback_tape_and_summary_disclose_simulation(monkeypatch):
    async def no_live(*args): return []
    class Provider:
        async def get_ohlcv(self, *args, **kwargs): return []
    async def provider(): return Provider()
    monkeypatch.setattr(tape, "_fetch_live_trades", no_live)
    monkeypatch.setattr(tape, "get_chart_provider", provider)
    for payload in [await tape.get_recent_tape("AAPL", 10), await tape.get_tape_summary("AAPL", 10)]:
        assert payload["source"] == "synthetic_examples"
        assert payload["simulated"] is True

@pytest.mark.asyncio
async def test_provider_executions_keep_provenance(monkeypatch):
    async def live(*args):
        return [tape.TradeRecord(timestamp="2026-11-14T12:00:00+00:00", price=100, quantity=2, value=200, side="buy")]
    monkeypatch.setattr(tape, "_fetch_live_trades", live)
    payload = await tape.get_recent_tape("AAPL", 10)
    assert payload["simulated"] is False
    assert payload["source"] == "provider_trades"
