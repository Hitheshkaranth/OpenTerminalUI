from __future__ import annotations

import asyncio
from datetime import date

from backend.adapters.base import QuoteResponse
from backend.adapters.yahoo import YahooFinanceAdapter, _yahoo_symbol, active_exchange
from backend.api.routes.stocks import _session_stats_from_history


def _with_exchange(exchange: str, fn):
    token = active_exchange.set(exchange)
    try:
        return fn()
    finally:
        active_exchange.reset(token)


def test_yahoo_symbol_suffixes_indian_exchanges_only():
    # Bare "INFY" on Yahoo is the US ADR; on the NSE chain it must be INFY.NS.
    assert _with_exchange("NSE", lambda: _yahoo_symbol("infy")) == "INFY.NS"
    assert _with_exchange("NSE", lambda: _yahoo_symbol("BAJAJ-AUTO")) == "BAJAJ-AUTO.NS"
    assert _with_exchange("BSE", lambda: _yahoo_symbol("INFY")) == "INFY.BO"
    assert _with_exchange("NSE", lambda: _yahoo_symbol("RELIANCE.NS")) == "RELIANCE.NS"
    assert _with_exchange("NSE", lambda: _yahoo_symbol("^NSEI")) == "^NSEI"
    assert _with_exchange("NASDAQ", lambda: _yahoo_symbol("INFY")) == "INFY"
    assert _yahoo_symbol("AAPL") == "AAPL"


class _FakeYahoo:
    def __init__(self) -> None:
        self.seen: list[str] = []

    async def get_quotes(self, symbols):
        self.seen.extend(symbols)
        return [{"regularMarketPrice": 1035.0, "regularMarketChangePercent": 4.11, "currency": "INR", "shortName": "Infosys"}]

    async def get_chart(self, symbol, range_str="1y", interval="1d"):
        self.seen.append(symbol)
        return {}


def test_yahoo_adapter_quote_builds_and_uses_exchange_symbol():
    fake = _FakeYahoo()
    adapter = YahooFinanceAdapter(yahoo=fake)  # type: ignore[arg-type]

    async def run():
        token = active_exchange.set("NSE")
        try:
            quote = await adapter.get_quote("INFY")
            await adapter.get_history("INFY", "1d", date(2026, 1, 1), date(2026, 2, 1))
            return quote
        finally:
            active_exchange.reset(token)

    quote = asyncio.run(run())
    assert isinstance(quote, QuoteResponse)
    assert quote.symbol == "INFY" and quote.company_name == "Infosys" and quote.currency == "INR"
    assert fake.seen == ["INFY.NS", "INFY.NS"]


def test_session_stats_from_history():
    payload = {
        "chart": {
            "result": [
                {
                    "timestamp": [1, 2, 3, 4],
                    "indicators": {
                        "quote": [
                            {
                                "open": [10, 11, None, 13],
                                "high": [12, 15, 14, 14],
                                "low": [9, 10, 11, 8],
                                "close": [11, 14, 12, 13],
                                "volume": [100, 200, 300, 400],
                            }
                        ]
                    },
                }
            ]
        }
    }
    stats = _session_stats_from_history(payload)
    # Bar 3 has a null open and is dropped, so the previous session is bar 2.
    assert stats["previous_close"] == 14
    assert (stats["open"], stats["day_high"], stats["day_low"], stats["volume"]) == (13, 14, 8, 400)
    assert stats["avg_volume"] == 150
    assert (stats["high_52w"], stats["low_52w"]) == (15, 8)
    assert _session_stats_from_history({}) == {}


def test_backtest_config_honours_ui_execution_profile():
    import pandas as pd

    from backend.core.backtesting_models import BacktestConfig
    from backend.core.single_asset_backtest import BacktestEngine

    profile = {"commission_bps": 5, "slippage_bps": 3, "spread_bps": 1, "market_impact_bps": 0}
    cfg = BacktestConfig(**{"execution_profile": profile})
    assert (cfg.fee_bps, cfg.slippage_bps) == (5.0, 4.0)
    # Explicit top-level values take precedence over the profile.
    assert BacktestConfig(**{"fee_bps": 1, "execution_profile": profile}).fee_bps == 1.0

    frame = pd.DataFrame(
        {
            "date": pd.date_range("2024-01-01", periods=6, freq="D").astype(str),
            "open": [100, 101, 102, 103, 104, 105],
            "high": [101, 102, 103, 104, 105, 106],
            "low": [99, 100, 101, 102, 103, 104],
            "close": [100, 101, 102, 103, 104, 105],
            "volume": [1000] * 6,
        }
    )
    signals = pd.Series([0, 1, 1, 1, -1, 0])
    free = BacktestEngine(BacktestConfig()).run("X", frame, signals)
    costed = BacktestEngine(BacktestConfig(**{"execution_profile": profile})).run("X", frame, signals)
    assert costed.final_equity < free.final_equity


def test_fmp_get_peers_exists_and_dedupes_indian_listings(monkeypatch):
    # QC: FMPClient.get_peers was called by three features but never defined → peers always empty.
    from backend.core.fmp_client import FMPClient

    client = FMPClient(api_key="test")
    calls = []

    async def fake_get(endpoint, params=None):
        calls.append((endpoint, params))
        return [{"symbol": s} for s in ["ALKEM.BO", "ALKEM.NS", "DIVISLAB.NS", "SUNPHARMA.NS", "XYZ.BO"]]

    monkeypatch.setattr(client, "_get", fake_get)
    peers = asyncio.run(client.get_peers("SUNPHARMA"))
    assert calls[0][0] == "stock-peers" and calls[0][1]["symbol"] == "SUNPHARMA.NS"
    assert peers == ["ALKEM", "DIVISLAB", "XYZ"]  # .BO dropped when the .NS twin exists; self excluded


# --- Ornith (reasoning model behind a key-protected gateway) QC, 2026-10-02 -------------------------

def test_ask_prompt_builds_and_maps_bracket_numbers():
    from backend.filings_rag.analyze import _build_ask_citations, _build_ask_prompt

    chunks = [{"id": 99, "document_id": 5, "text": "Capex was 7.8 billion.", "title": "10-K", "page_start": 3,
               "page_end": 3, "section": None, "source_url": None, "doc_type": "annual_report"}]
    assert '"chunk_id": int' in _build_ask_prompt("capex?", chunks)  # literal braces used to raise ValueError
    cites = _build_ask_citations([{"quote": "Capex was 7.8 billion.", "chunk_id": 1}], chunks)
    assert cites and cites[0]["doc_id"] == 5 and cites[0]["page_start"] == 3


def test_concall_highlight_with_own_quote_survives_restatement(monkeypatch):
    from backend.filings_rag import knowledge as kn

    monkeypatch.setattr(kn.llm, "verify_quote", lambda q, t: q in t)
    monkeypatch.setattr(kn.llm, "citation_for", lambda c, q: {"doc_id": c["document_id"], "quote": q})
    text = "Revenue grew 38% to $15.6 billion. Mounjaro sales doubled. We raised full-year guidance."
    doc = {"meta": {"document_id": 1, "title": "8-K", "period": "Q2", "filed_at": "2026-08-05"}}
    chunk = {"id": 1, "document_id": 1, "ordinal": 0, "text": text}
    raw = {"highlights": [{"text": "Strong revenue growth", "quote": "Revenue grew 38% to $15.6 billion."},
                          {"text": "Mounjaro momentum", "quote": "Mounjaro sales doubled."},
                          {"text": "Guidance up", "quote": "We raised full-year guidance."}],
           "management_tone": "positive", "key_numbers": [], "qa_themes": []}
    summary = kn._apply_llm_summary(doc, [chunk], raw)
    assert summary is not None and len(summary["highlights"]) == 3


def test_lm_studio_client_sends_key_and_disables_thinking(monkeypatch):
    import httpx
    from backend.services import lm_studio_client as lsc

    seen = {}

    class _Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"content": "{}"}}]}

    class _Client:
        def __init__(self, *a, headers=None, **k):
            seen["headers"] = headers or {}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None):
            seen["payload"] = json
            return _Resp()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    client = lsc.LMStudioClient(base_url="http://gw:8080/v1", model="m")
    client._headers = {"Authorization": "Bearer k"}
    asyncio.run(client.chat([{"role": "user", "content": "hi"}]))
    assert seen["headers"] == {"Authorization": "Bearer k"}
    assert seen["payload"]["chat_template_kwargs"] == {"enable_thinking": False}


def test_business_llm_extraction_is_batched(monkeypatch):
    from backend.business_metrics import service as bm

    calls = []

    async def fake_extract(batch):
        calls.append(len(batch))
        return []

    monkeypatch.setattr(bm, "_llm_extract", fake_extract)
    chunks = [{"id": i, "text": f"chunk {i}"} for i in range(20)]
    asyncio.run(bm._llm_extract_rows(chunks))
    assert calls and max(calls) <= bm._LLM_BATCH and sum(calls) == 20


def test_value_chain_rejects_generic_parties_and_echoed_tickers(monkeypatch):
    from types import SimpleNamespace

    from backend.api.routes import search as search_mod
    from backend.filings_rag import sources
    from backend.value_chain import service as vc

    assert vc.is_generic_party("three largest wholesalers")
    assert vc.is_generic_party("wholesalers")
    assert vc.is_generic_party("China-based suppliers")
    assert not vc.is_generic_party("Cardinal Health, Inc.")

    monkeypatch.setattr(sources, "_SEC_NAME_CACHE", {"mckesson": "MCK", "cardinal health": "CAH"})
    assert asyncio.run(vc.resolve_ticker("McKesson Corporation", market="US")) == "MCK"
    assert asyncio.run(vc.resolve_ticker("Boehringer Ingelheim", market="US")) is None

    async def fake_search(q, market):  # echoes the query, then a fuzzy wrong hit
        return SimpleNamespace(results=[SimpleNamespace(ticker=q.upper(), name=q.upper()),
                                        SimpleNamespace(ticker="TATAMTRDVR", name="Tata Motors DVR")])

    monkeypatch.setattr(search_mod, "search", fake_search)
    assert asyncio.run(vc.resolve_ticker("Tata Steel", market="NSE")) is None


def test_kpi_years_in_keys_merge_into_one_series(monkeypatch):
    from types import SimpleNamespace

    from backend.business_metrics import service as bm

    def row(key, period, value):
        return SimpleNamespace(kind="kpi", key=key, label="Capital expenditures", unit="USD billion",
                               category="capex", period=period, value=value, citation_json=None,
                               quote=None, document_id=None, chunk_id=None, page=None)

    rows = [row("capex_2025", "FY25", 7.8), row("capex_2024", "FY24", 5.1), row("capex_2025", "FY25", 7.8)]
    monkeypatch.setattr(bm, "_citation_from_row", lambda r: None)  # citations aren't under test here
    series = bm._group_kpis(rows)
    assert len(series) == 1
    assert series[0]["key"] == "capex"
    assert [p["period"] for p in series[0]["points"]] == ["FY24", "FY25"]


def test_screener_hydration_keeps_snapshot_fundamentals(monkeypatch):
    import pandas as pd

    from backend.api.routes import screener as scr

    stored = []

    async def fake_snapshot(sym):
        return {"company_name": "Tata Consultancy", "roe_pct": 47.7, "op_margin_pct": 24.0,
                "rev_growth_pct": 13.9, "market_cap": 7.5e12, "pe": 22.0}

    monkeypatch.setattr(scr, "fetch_stock_snapshot_coalesced", fake_snapshot)
    monkeypatch.setattr(scr, "load_screener_df", lambda t: pd.DataFrame(stored))
    monkeypatch.setattr(scr, "upsert_screener_rows", lambda rows: stored.extend(rows))
    asyncio.run(scr._hydrate_missing_screener_rows(["TCS"], [], refresh_cap=5))
    assert stored and stored[0]["roe_pct"] == 47.7 and stored[0]["op_margin_pct"] == 24.0


def test_nl_screener_skips_filters_without_any_data(monkeypatch):
    from backend.api.routes import screener as scr
    from backend.services.ai_service import AIQueryService

    universe = [{"symbol": "TCS", "roe": 47.7, "debt_to_equity": None},
                {"symbol": "ITC", "roe": 28.0, "debt_to_equity": float("nan")}]

    async def fake_scan(req):
        rows = universe
        for f in req.filters:
            rows = [r for r in rows if isinstance(r.get(f.field), float) and r[f.field] == r[f.field]
                    and r[f.field] > float(f.value)]
        return {"rows": rows}

    monkeypatch.setattr(scr, "run_multimarket_scan", fake_scan)
    rows, skipped = asyncio.run(AIQueryService()._run_screener({"filters": [
        {"field": "roe", "op": "gt", "value": 20}, {"field": "debt_to_equity", "op": "lte", "value": 0.5}]}))
    assert skipped == ["debt_to_equity"]
    assert {r["symbol"] for r in rows} == {"TCS", "ITC"}


def test_agent_tools_accept_symbol_alias():
    from backend.agent.tools.market_tools import _ticker_arg

    assert _ticker_arg({"symbol": "LLY"}) == "LLY"
    assert _ticker_arg({"ticker": "TCS", "symbol": "X"}) == "TCS"
    assert _ticker_arg({}) == ""
