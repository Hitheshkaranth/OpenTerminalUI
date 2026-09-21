from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, Engine
from sqlalchemy.orm import sessionmaker

from backend.agent.ensemble.orchestrator import EnsembleOrchestrator
from backend.agent.ensemble.personas import PERSONAS
from backend.agent.ensemble import scorecard
from backend.agent.tools.registry import ToolRegistry, ToolSpec
from backend.services.llm.base import AssistantMessage, LLMMessage
from backend.auth.deps import get_current_user


# ── In-memory SQLite setup ──────────────────────────────────────────

_test_engine = create_engine("sqlite:///:memory:")
from backend.shared.db import Base

Base.metadata.create_all(_test_engine)
_test_session_factory = sessionmaker(bind=_test_engine)

# Persistent session for tests that add data within a single async test
_test_session_inst = _test_session_factory()


def _test_session():
    return _test_session_factory()


def _query(engine_or_session, stmt):
    """Execute a select statement via engine or session, using proper context."""
    with engine_or_session.begin() as conn:
        return conn.execute(stmt)


class FakeChartBar:
    def __init__(self, close: float):
        self.close = close


class FakeChartProvider:
    def __init__(self, prices: dict[str, float] | None = None):
        self._prices = prices or {}

    async def get_ohlcv(self, symbol: str, interval: str = "1d", period: str = "3mo"):
        price = self._prices.get(symbol, 100.0)
        return [FakeChartBar(close=price)]


class FakeProvider:
    """Returns canned JSON for each persona."""

    def __init__(
        self,
        AAPL_bullish: bool = True,
        fail_persona: str | None = None,
    ):
        self.calls: list[tuple] = []
        self.fail_persona = fail_persona

    async def complete(self, messages, tools=None, *, temperature=0.1, max_tokens=1024, models=None, on_status=None):
        system = messages[0].content if messages else ""
        persona_id = None
        for p in PERSONAS:
            if p.id in system:
                persona_id = p.id
                break
        self.calls.append((persona_id, system))
        if persona_id and persona_id == self.fail_persona:
            raise RuntimeError(f"{persona_id} provider unavailable")

        if persona_id == "value_investor":
            return AssistantMessage(
                content='{"signals":[{"symbol":"AAPL","signal":"bullish","confidence":80,"reason":"Low P/E 18 and high ROE 25%"}]}'
            )
        if persona_id == "growth_investor":
            return AssistantMessage(
                content='{"signals":[{"symbol":"AAPL","signal":"bullish","confidence":75,"reason":"Revenue growth 20% accelerating"}]}'
            )
        if persona_id == "momentum_trader":
            return AssistantMessage(
                content='{"signals":[{"symbol":"AAPL","signal":"bearish","confidence":60,"reason":"RSI overbought at 72"}]}'
            )
        if persona_id == "contrarian":
            return AssistantMessage(
                content='{"signals":[{"symbol":"AAPL","signal":"neutral","confidence":50,"reason":"Mixed signals on pullback"}]}'
            )
        if persona_id == "risk_manager":
            return AssistantMessage(
                content='{"signals":[{"symbol":"AAPL","signal":"neutral","confidence":55,"reason":"Volatility elevated"}]}'
            )
        return AssistantMessage(content="{}")


def _build_registry(
    snapshot_result: dict | None = None,
    technicals_result: dict | None = None,
    portfolio_items: list[dict] | None = None,
    watchlists: list[dict] | None = None,
):
    reg = ToolRegistry()
    snap = snapshot_result or {"price": 150.0, "pe": 18.0, "roe": 25.0, "revenue_growth": 12.0}

    async def fake_snapshot(args):
        return snap

    async def fake_technicals(args):
        return technicals_result or {
            "trend": {"above_50dma": True, "ema_50": 145, "ema_200": 140},
            "momentum": {"rsi_14": 55.0},
        }

    reg.register(ToolSpec(
        "get_stock_snapshot", "snapshot", {"type": "object"},
        handler=fake_snapshot, read_only=True,
    ))
    reg.register(ToolSpec(
        "analyze_technicals", "technicals", {"type": "object"},
        handler=fake_technicals, read_only=True,
    ))

    if portfolio_items is not None:
        async def fake_portfolio(args):
            return {"items": portfolio_items, "total_value": 50000, "total_cost": 40000, "unrealized_pnl": 10000}
        reg.register(ToolSpec(
            "get_portfolio", "portfolio", {"type": "object"},
            handler=fake_portfolio, read_only=True,
        ))

    if watchlists is not None:
        async def fake_watchlists(args):
            return {"items": watchlists}
        reg.register(ToolSpec(
            "get_watchlists", "watchlists", {"type": "object"},
            handler=fake_watchlists, read_only=True,
        ))

    return reg


# ── Helpers ─────────────────────────────────────────────────────────

def _clear_db():
    from backend.models.agent_signals import AgentSignal
    with _test_engine.begin() as conn:
        conn.execute(AgentSignal.__table__.delete())


def _query(engine_or_session, stmt):
    """Execute a select statement via engine or session, using proper context."""
    if isinstance(engine_or_session, Engine):
        with engine_or_session.begin() as conn:
            return conn.execute(stmt)
    else:
        with engine_or_session.begin() as conn:
            return conn.execute(stmt)


@pytest.fixture(autouse=True)
def _setup_test_db(monkeypatch):
    # Scope the SessionLocal patch to each test: a module-level patch.start() that
    # is never stopped leaks the in-memory DB into every later test in the session.
    import backend.shared.db as db_module

    monkeypatch.setattr(db_module, "SessionLocal", lambda: _test_session())
    for mod_name in ("backend.agent.ensemble.orchestrator", "backend.agent.ensemble.scorecard"):
        try:
            mod = __import__(mod_name, fromlist=["SessionLocal"])
            if hasattr(mod, "SessionLocal"):
                monkeypatch.setattr(mod, "SessionLocal", lambda: _test_session())
        except ImportError:
            pass
    _clear_db()
    yield
    _clear_db()


# ── Tests: basket parsing ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_orchestrator_basket_comma_dedupe_cap():
    """Comma-separated symbols: dedupe, uppercase, cap 12."""
    provider = FakeProvider()
    reg = _build_registry()
    orch = EnsembleOrchestrator(provider=provider, registry=reg, user_id=None, max_symbols=12)
    events = [e async for e in orch.run(
        "aapl, AAPL, GOOGL, MSFT, aapl, META, NVDA, AMZN, TSLA, NFLX, DIS, PYPL, CRM, INTC, AMD"
    )]

    # Should resolve basket phase
    basket_phases = [e for e in events if e["type"] == "phase" and e.get("key") == "basket"]
    assert len(basket_phases) == 1

    # Final should be present
    finals = [e for e in events if e["type"] == "final"]
    assert len(finals) == 1

    # Only 12 symbols (cap) — 15 unique after dedupe → capped at 12
    sig_table = [e for e in events if e["type"] == "artifact" and e["kind"] == "signal_table"]
    assert len(sig_table) == 1
    basket = sig_table[0]["data"]["basket"]
    assert len(basket) == 12
    assert "AAPL" in basket  # deduped


@pytest.mark.asyncio
async def test_orchestrator_portfolio_resolution():
    """portfolio subject resolves via get_portfolio tool."""
    provider = FakeProvider()
    reg = _build_registry(
        portfolio_items=[
            {"ticker": "AAPL", "quantity": 10, "avg_buy_price": 140, "current_price": 150, "pnl": 100},
            {"ticker": "MSFT", "quantity": 5, "avg_buy_price": 300, "current_price": 320, "pnl": 100},
        ]
    )
    orch = EnsembleOrchestrator(provider=provider, registry=reg, user_id=None, max_symbols=2)
    events = [e async for e in orch.run("portfolio")]

    sig_table = [e for e in events if e["type"] == "artifact" and e["kind"] == "signal_table"]
    assert len(sig_table) == 1
    assert "AAPL" in sig_table[0]["data"]["basket"]
    assert "MSFT" in sig_table[0]["data"]["basket"]


@pytest.mark.asyncio
async def test_orchestrator_no_portfolio_tool():
    """No get_portfolio tool → error + final."""
    provider = FakeProvider()
    reg = _build_registry()  # no portfolio tool
    orch = EnsembleOrchestrator(provider=provider, registry=reg, user_id=None)
    events = [e async for e in orch.run("portfolio")]

    errs = [e for e in events if e["type"] == "error"]
    assert len(errs) == 1
    assert "No portfolio tools available" in errs[0]["message"]


@pytest.mark.asyncio
async def test_orchestrator_unknown_watchlist_empty():
    """watchlist:<unknown> → final with no symbols."""
    provider = FakeProvider()
    reg = _build_registry(watchlists=[{"id": "wl1", "name": "My Watchlist", "symbols": ["AAPL"]}])
    orch = EnsembleOrchestrator(provider=provider, registry=reg, user_id=None)
    events = [e async for e in orch.run("watchlist:nonexistent")]

    finals = [e for e in events if e["type"] == "final"]
    assert len(finals) == 1
    assert "No symbols to analyse" in finals[0]["content"]


@pytest.mark.asyncio
async def test_orchestrator_watchlist_lookup():
    """watchlist:<id> resolves symbols from the watchlist."""
    provider = FakeProvider()
    reg = _build_registry(watchlists=[{"id": "wl1", "name": "Tech", "symbols": ["AAPL", "GOOGL"]}])
    orch = EnsembleOrchestrator(provider=provider, registry=reg, user_id=None, max_symbols=2)
    events = [e async for e in orch.run("watchlist:wl1")]

    sig_table = [e for e in events if e["type"] == "artifact" and e["kind"] == "signal_table"]
    assert len(sig_table) == 1
    assert "AAPL" in sig_table[0]["data"]["basket"]
    assert "GOOGL" in sig_table[0]["data"]["basket"]


# ── Tests: tolerant JSON parsing ───────────────────────────────────


@pytest.mark.asyncio
async def test_orchestrator_fenced_json_parsed():
    """Provider returns ```json ... ``` — still parsed."""

    class FencedProvider(FakeProvider):
        async def complete(self, messages, tools=None, *, temperature=0.1, max_tokens=1024, models=None, on_status=None):
            persona_id = None
            for p in PERSONAS:
                if p.id in messages[0].content:
                    persona_id = p.id
                    break
            return AssistantMessage(
                content='```\n{"signals":[{"symbol":"AAPL","signal":"bullish","confidence":80,"reason":"Fenced JSON works"}]}\n```'
            )

    provider = FencedProvider()
    reg = _build_registry()
    orch = EnsembleOrchestrator(provider=provider, registry=reg, user_id=None)
    events = [e async for e in orch.run("AAPL")]

    sig_table = [e for e in events if e["type"] == "artifact" and e["kind"] == "signal_table"]
    assert len(sig_table) == 1
    assert len(sig_table[0]["data"]["signals"]) > 0


@pytest.mark.asyncio
async def test_orchestrator_trailing_text_tolerated():
    """JSON with trailing explanatory text — still parsed."""

    class TrailingProvider(FakeProvider):
        async def complete(self, messages, tools=None, *, temperature=0.1, max_tokens=1024, models=None, on_status=None):
            persona_id = None
            for p in PERSONAS:
                if p.id in messages[0].content:
                    persona_id = p.id
                    break
            return AssistantMessage(
                content='{"signals":[{"symbol":"AAPL","signal":"bullish","confidence":80,"reason":"Trailing text ok"}]}  \n\nThis is extra text.'
            )

    provider = TrailingProvider()
    reg = _build_registry()
    orch = EnsembleOrchestrator(provider=provider, registry=reg, user_id=None)
    events = [e async for e in orch.run("AAPL")]

    sig_table = [e for e in events if e["type"] == "artifact" and e["kind"] == "signal_table"]
    assert len(sig_table) == 1
    assert len(sig_table[0]["data"]["signals"]) > 0


@pytest.mark.asyncio
async def test_orchestrator_malformed_row_dropped():
    """Signal rows without symbol or invalid signal → dropped."""

    class MalformedProvider(FakeProvider):
        async def complete(self, messages, tools=None, *, temperature=0.1, max_tokens=1024, models=None, on_status=None):
            persona_id = None
            for p in PERSONAS:
                if p.id in messages[0].content:
                    persona_id = p.id
                    break
            return AssistantMessage(
                content='{"signals":[{"symbol":"UNKNOWN","signal":"bullish","confidence":80,"reason":"dropped"},'
                        '{"symbol":"AAPL","signal":"invalid","confidence":80,"reason":"dropped2"}]}'
            )

    provider = MalformedProvider()
    reg = _build_registry()
    orch = EnsembleOrchestrator(provider=provider, registry=reg, user_id=None)
    events = [e async for e in orch.run("AAPL")]

    sig_table = [e for e in events if e["type"] == "artifact" and e["kind"] == "signal_table"]
    assert len(sig_table) == 1
    # Both rows should be dropped (UNKNOWN not in basket, invalid signal)
    assert len(sig_table[0]["data"]["signals"]) == 0


@pytest.mark.asyncio
async def test_orchestrator_confidence_clamped():
    """Confidence > 100 or < 0 clamped to [0, 100]."""

    class ClampProvider(FakeProvider):
        async def complete(self, messages, tools=None, *, temperature=0.1, max_tokens=1024, models=None, on_status=None):
            persona_id = None
            for p in PERSONAS:
                if p.id in messages[0].content:
                    persona_id = p.id
                    break
            return AssistantMessage(
                content='{"signals":[{"symbol":"AAPL","signal":"bullish","confidence":150,"reason":"capped at 100"}]}'
            )

    provider = ClampProvider()
    reg = _build_registry()
    orch = EnsembleOrchestrator(provider=provider, registry=reg, user_id=None)
    events = [e async for e in orch.run("AAPL")]

    sig_table = [e for e in events if e["type"] == "artifact" and e["kind"] == "signal_table"]
    assert len(sig_table) == 1
    for s in sig_table[0]["data"]["signals"]:
        assert 0 <= s["confidence"] <= 100


# ── Tests: persona failure ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_orchestrator_one_persona_fails_others_succeed():
    """One persona raises → others still produce signals, artifact emitted."""
    provider = FakeProvider(fail_persona="momentum_trader")
    reg = _build_registry()
    orch = EnsembleOrchestrator(provider=provider, registry=reg, user_id=None)
    events = [e async for e in orch.run("AAPL")]

    sig_table = [e for e in events if e["type"] == "artifact" and e["kind"] == "signal_table"]
    assert len(sig_table) == 1

    # Momentum trader signals should NOT be present
    signals = sig_table[0]["data"]["signals"]
    personas_present = {s["persona"] for s in signals}
    assert "momentum_trader" not in personas_present

    # Other personas should have signals
    assert "value_investor" in personas_present

    # Final must still be emitted
    finals = [e for e in events if e["type"] == "final"]
    assert len(finals) == 1


# ── Tests: consensus math ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_orchestrator_consensus_math():
    """2 bullish@80, 1 bearish@40, 1 neutral@50, equal weights → score=50 → BUY.

    score = Σ(w·c·dir) / Σ(w·c) * 100
    = (0.5*80*1 + 0.5*80*1 + 0.5*40*(-1) + 0.5*50*0) / (0.5*80+0.5*80+0.5*40+0.5*50) * 100
    = (40+40-20+0) / (40+40+20+25) * 100
    = 60/125 * 100 = 48 → HOLD
    We adjust: use bearish@50 to get score=50:
    = (40+40-25+0) / (40+40+25+25) * 100 = 55/130 * 100 = 42.3 → still HOLD

    Actually let's use: 2 bullish@80, 1 bearish@40, equal weights:
    = (40+40-20) / (40+40+20) * 100 = 60/100 * 100 = 60 → BUY
    """
    from backend.agent.ensemble.orchestrator import _consensus

    personas_data = [
        {"id": "value_investor", "label": "Value"},
        {"id": "growth_investor", "label": "Growth"},
        {"id": "momentum_trader", "label": "Momentum"},
        {"id": "contrarian", "label": "Contrarian"},
    ]
    weights = {"value_investor": 0.5, "growth_investor": 0.5, "momentum_trader": 0.5}

    signals = [
        {"symbol": "AAPL", "persona": "value_investor", "signal": "bullish", "confidence": 80, "reason": "v"},
        {"symbol": "AAPL", "persona": "growth_investor", "signal": "bullish", "confidence": 80, "reason": "g"},
        {"symbol": "AAPL", "persona": "momentum_trader", "signal": "bearish", "confidence": 40, "reason": "m"},
    ]

    consensus = _consensus(signals, personas_data, weights)
    assert len(consensus) == 1
    c = consensus[0]
    assert c["symbol"] == "AAPL"
    assert c["bullish"] == 2
    assert c["bearish"] == 1
    assert c["neutral"] == 0
    # score = (0.5*80 + 0.5*80 - 0.5*40) / (0.5*80+0.5*80+0.5*40) * 100
    #       = (40+40-20) / (40+40+20) * 100 = 60/100 * 100 = 60.0
    assert c["score"] == 60.0
    assert c["verdict"] == "BUY"


# ── Tests: signal persistence ──────────────────────────────────────


@pytest.mark.asyncio
async def test_signals_persisted_with_price():
    """Signals stored in DB with price_at_signal from snapshot."""
    provider = FakeProvider()
    reg = _build_registry(snapshot_result={"price": 175.5, "pe": 22.0, "roe": 30.0})
    orch = EnsembleOrchestrator(provider=provider, registry=reg, user_id="test_user", max_symbols=1)
    events = [e async for e in orch.run("AAPL")]

    # Query DB directly
    from backend.models.agent_signals import AgentSignal
    rows = _query(_test_engine, AgentSignal.__table__.select()).fetchall()
    assert len(rows) > 0
    row = rows[0]
    assert row.symbol == "AAPL"
    assert row.price_at_signal == 175.5
    assert row.signal in ("bullish", "bearish", "neutral")


# ── Tests: evaluate_signals with fake chart provider ───────────────


class ChartProviderTest:
    """Fake chart provider for evaluate_signals tests."""
    def __init__(self, price_map: dict[str, float]):
        self.price_map = price_map

    async def get_ohlcv(self, symbol: str, interval: str = "1d", period: str = "3mo"):
        price = self.price_map.get(symbol, 100.0)
        return [FakeChartBar(close=price)]


@pytest.mark.asyncio
async def test_evaluate_bullish_positive_return():
    """bullish +5% → correct=True."""
    from backend.models.agent_signals import AgentSignal

    old_time = (datetime.now(timezone.utc) - timedelta(days=15)).isoformat()

    sig = AgentSignal(
        user_id="test_user", run_id="run1", symbol="AAPL",
        persona="value_investor", signal="bullish", confidence=80, reason="test",
        price_at_signal=100.0, created_at=old_time,
    )
    _test_session_inst.add(sig)
    _test_session_inst.commit()

    async def fake_get_chart_provider():
        return ChartProviderTest({"AAPL": 105.0})

    with patch.object(scorecard, "get_chart_provider", fake_get_chart_provider):
        result = await scorecard.evaluate_signals(_test_session_inst, "test_user", horizon_days=10)

    assert result["evaluated"] == 1
    row = _test_session_inst.execute(
        scorecard.select(AgentSignal).where(AgentSignal.symbol == "AAPL")
    ).scalar_one()
    assert row.correct == True
    assert row.realized_return_pct is not None
    assert abs(row.realized_return_pct - 5.0) < 0.1


@pytest.mark.asyncio
async def test_evaluate_neutral_small_return():
    """neutral +1% → correct=True (|return| < 2)."""
    from backend.models.agent_signals import AgentSignal

    old_time = (datetime.now(timezone.utc) - timedelta(days=15)).isoformat()

    sig = AgentSignal(
        user_id="test_user", run_id="run1", symbol="MSFT",
        persona="contrarian", signal="neutral", confidence=50, reason="test",
        price_at_signal=200.0, created_at=old_time,
    )
    _test_session_inst.add(sig)
    _test_session_inst.commit()

    async def fake_get_chart_provider():
        return ChartProviderTest({"MSFT": 202.0})

    with patch.object(scorecard, "get_chart_provider", fake_get_chart_provider):
        result = await scorecard.evaluate_signals(_test_session_inst, "test_user", horizon_days=10)

    row = _test_session_inst.execute(
        scorecard.select(AgentSignal).where(AgentSignal.symbol == "MSFT")
    ).scalar_one()
    assert row.correct == True


@pytest.mark.asyncio
async def test_evaluate_bearish_positive_return():
    """bearish +5% → correct=False (price went up, not down)."""
    from backend.models.agent_signals import AgentSignal

    old_time = (datetime.now(timezone.utc) - timedelta(days=15)).isoformat()

    sig = AgentSignal(
        user_id="test_user", run_id="run1", symbol="TSLA",
        persona="risk_manager", signal="bearish", confidence=70, reason="test",
        price_at_signal=100.0, created_at=old_time,
    )
    _test_session_inst.add(sig)
    _test_session_inst.commit()

    async def fake_get_chart_provider():
        return ChartProviderTest({"TSLA": 105.0})

    with patch.object(scorecard, "get_chart_provider", fake_get_chart_provider):
        result = await scorecard.evaluate_signals(_test_session_inst, "test_user", horizon_days=10)

    row = _test_session_inst.execute(
        scorecard.select(AgentSignal).where(AgentSignal.symbol == "TSLA")
    ).scalar_one()
    assert row.correct == False


@pytest.mark.asyncio
async def test_evaluate_skip_price_none_zero():
    """Signals with price_at_signal=None or 0 → skipped."""
    from backend.models.agent_signals import AgentSignal

    old_time = (datetime.now(timezone.utc) - timedelta(days=15)).isoformat()

    sig_none = AgentSignal(
        user_id="test_user", run_id="run1", symbol="A",
        persona="value_investor", signal="bullish", confidence=80, reason="test",
        price_at_signal=None, created_at=old_time,
    )
    sig_zero = AgentSignal(
        user_id="test_user", run_id="run1", symbol="B",
        persona="value_investor", signal="bullish", confidence=80, reason="test",
        price_at_signal=0.0, created_at=old_time,
    )
    _test_session_inst.add_all([sig_none, sig_zero])
    _test_session_inst.commit()

    async def fake_get_chart_provider():
        return ChartProviderTest({})

    with patch.object(scorecard, "get_chart_provider", fake_get_chart_provider):
        result = await scorecard.evaluate_signals(_test_session_inst, "test_user", horizon_days=10)

    assert result["skipped"] == 2
    assert result["evaluated"] == 0


@pytest.mark.asyncio
async def test_evaluate_skip_too_recent():
    """Signals with evaluated_at already set → skipped if too recent."""
    from backend.models.agent_signals import AgentSignal

    sig = AgentSignal(
        user_id="test_user", run_id="run1", symbol="AAPL",
        persona="value_investor", signal="bullish", confidence=80, reason="test",
        price_at_signal=100.0, created_at=datetime.now(timezone.utc).isoformat(),
        evaluated_at=(datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
    )
    _test_session_inst.add(sig)
    _test_session_inst.commit()

    async def fake_get_chart_provider():
        return ChartProviderTest({})

    with patch.object(scorecard, "get_chart_provider", fake_get_chart_provider):
        result = await scorecard.evaluate_signals(_test_session_inst, "test_user", horizon_days=10)

    assert result["skipped"] == 1
    assert result["evaluated"] == 0


# ── Tests: scorecard accuracy & persona_weights ────────────────────


@pytest.mark.asyncio
async def test_scorecard_accuracy():
    """Scorecard returns correct accuracy from evaluated signals."""
    from backend.models.agent_signals import AgentSignal

    # 2 correct, 1 incorrect for value_investor → accuracy = 0.6667
    signals = [
        AgentSignal(user_id="test_user", run_id="r1", symbol="A", persona="value_investor",
                    signal="bullish", confidence=80, reason="ok", price_at_signal=100,
                    correct=True, evaluated_at="2024-01-01T00:00:00Z", realized_return_pct=5.0),
        AgentSignal(user_id="test_user", run_id="r1", symbol="B", persona="value_investor",
                    signal="bullish", confidence=80, reason="ok", price_at_signal=100,
                    correct=True, evaluated_at="2024-01-01T00:00:00Z", realized_return_pct=3.0),
        AgentSignal(user_id="test_user", run_id="r1", symbol="C", persona="value_investor",
                    signal="bearish", confidence=60, reason="ok", price_at_signal=100,
                    correct=False, evaluated_at="2024-01-01T00:00:00Z", realized_return_pct=-2.0),
    ]
    _test_session_inst.add_all(signals)
    _test_session_inst.commit()

    result = scorecard.scorecard(_test_session_inst, "test_user")
    vi = [p for p in result["personas"] if p["id"] == "value_investor"][0]
    assert vi["evaluated"] == 3
    assert abs(vi["accuracy"] - 2 / 3) < 0.01


@pytest.mark.asyncio
async def test_persona_weights_default_under_5():
    """Under 5 evaluations → default weight 0.5."""
    from backend.models.agent_signals import AgentSignal

    signals = [
        AgentSignal(user_id="test_user", run_id="r1", symbol="A", persona="value_investor",
                    signal="bullish", confidence=80, reason="ok", price_at_signal=100,
                    correct=True, evaluated_at="2024-01-01T00:00:00Z"),
        AgentSignal(user_id="test_user", run_id="r1", symbol="B", persona="growth_investor",
                    signal="bullish", confidence=75, reason="ok", price_at_signal=100,
                    correct=True, evaluated_at="2024-01-01T00:00:00Z"),
    ]
    _test_session_inst.add_all(signals)
    _test_session_inst.commit()

    weights = scorecard.persona_weights(_test_session_inst, "test_user")
    assert weights["value_investor"] == 0.5
    assert weights["growth_investor"] == 0.5


@pytest.mark.asyncio
async def test_persona_weights_accuracy_after_5():
    """Over 5 evaluations → max(0.25, accuracy)."""
    from backend.models.agent_signals import AgentSignal

    # 8 correct, 2 incorrect for value_investor → accuracy=0.8, weight=max(0.25,0.8)=0.8
    signals = []
    for i in range(8):
        signals.append(AgentSignal(
            user_id="test_user", run_id="r1", symbol=f"S{i}", persona="value_investor",
            signal="bullish", confidence=80, reason="ok", price_at_signal=100,
            correct=True, evaluated_at="2024-01-01T00:00:00Z",
        ))
    for i in range(2):
        signals.append(AgentSignal(
            user_id="test_user", run_id="r1", symbol=f"S{i+8}", persona="value_investor",
            signal="bullish", confidence=80, reason="ok", price_at_signal=100,
            correct=False, evaluated_at="2024-01-01T00:00:00Z",
        ))
    _test_session_inst.add_all(signals)
    _test_session_inst.commit()

    weights = scorecard.persona_weights(_test_session_inst, "test_user")
    assert weights["value_investor"] == 0.8


# ── Tests: API routes ──────────────────────────────────────────────


def test_route_scorecard_shape(monkeypatch):
    """Scorecard route returns correct shape."""
    from backend.api.routes import agent_signals as ar

    class DummyUser:
        id = "test_user"

    app = FastAPI()
    app.include_router(ar.router, prefix="/api")
    app.dependency_overrides[get_current_user] = lambda: DummyUser()

    with patch("backend.api.routes.agent_signals.scorecard", return_value={"personas": [{"id": "v"}], "as_of": "now"}):
        client = TestClient(app)
        resp = client.get("/api/agent/signals/scorecard")

    assert resp.status_code == 200
    data = resp.json()
    assert "personas" in data
    assert "as_of" in data


def test_route_evaluate_returns_counts(monkeypatch):
    """Evaluate route returns evaluated/skipped counts."""
    from backend.api.routes import agent_signals as ar

    class DummyUser:
        id = "test_user"

    app = FastAPI()
    app.include_router(ar.router, prefix="/api")
    app.dependency_overrides[get_current_user] = lambda: DummyUser()

    async def fake_evaluate(db, user_id, horizon_days=10):
        return {"evaluated": 3, "skipped": 1}

    with patch("backend.api.routes.agent_signals.evaluate_signals", fake_evaluate):
        client = TestClient(app)
        resp = client.post("/api/agent/signals/evaluate?horizon_days=7")

    assert resp.status_code == 200
    data = resp.json()
    assert data["evaluated"] == 3
    assert data["skipped"] == 1


def test_route_list_signals_shape(monkeypatch):
    """List signals route returns items array."""
    from backend.api.routes import agent_signals as ar

    class DummyUser:
        id = "test_user"

    app = FastAPI()
    app.include_router(ar.router, prefix="/api")
    app.dependency_overrides[get_current_user] = lambda: DummyUser()

    with patch("backend.api.routes.agent_signals.list_signals", return_value=[]):
        client = TestClient(app)
        resp = client.get("/api/agent/signals?symbol=AAPL")

    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert isinstance(data["items"], list)


def test_route_signals_with_filters(monkeypatch):
    """Signals route respects symbol and persona filters."""
    from backend.api.routes import agent_signals as ar

    class DummyUser:
        id = "test_user"

    app = FastAPI()
    app.include_router(ar.router, prefix="/api")
    app.dependency_overrides[get_current_user] = lambda: DummyUser()

    called_kwargs = {}

    def fake_list(db, user_id, symbol=None, persona=None, limit=100):
        called_kwargs["symbol"] = symbol
        called_kwargs["persona"] = persona
        called_kwargs["limit"] = limit
        return []

    with patch("backend.api.routes.agent_signals.list_signals", fake_list):
        client = TestClient(app)
        client.get("/api/agent/signals?symbol=MSFT&persona=value_investor&limit=50")

    assert called_kwargs["symbol"] == "MSFT"
    assert called_kwargs["persona"] == "value_investor"
    assert called_kwargs["limit"] == 50


# ── Persona data tests ─────────────────────────────────────────────


def test_personas_have_five_ids():
    ids = [p.id for p in PERSONAS]
    assert set(ids) == {"value_investor", "growth_investor", "momentum_trader", "contrarian", "risk_manager"}


def test_personas_have_system_prompts():
    for p in PERSONAS:
        assert p.label
        assert p.system_prompt
        assert "bullish" in p.system_prompt or "bearish" in p.system_prompt


def test_personas_end_with_return_only_json():
    for p in PERSONAS:
        assert "Return ONLY the JSON object" in p.system_prompt


def test_personas_include_evidence_synthesis():
    for p in PERSONAS:
        assert "tools" in p.system_prompt.lower()

def test_parse_signals_salvages_truncated_json():
    """A reasoning model that hits max_tokens mid-array must still yield the complete rows."""
    from backend.agent.ensemble.orchestrator import _parse_signals

    text = '{"signals": [{"symbol": "RELIANCE", "signal": "neutral", "confidence": 60, "reason": "fair"}, {"symbol": "TCS", "signal": "bullish", "confidence": 7'
    rows = _parse_signals(text, {"RELIANCE", "TCS"})
    assert [r["symbol"] for r in rows] == ["RELIANCE"]


def test_facts_block_uses_real_tool_keys():
    """Regression: personas were told nothing because the builder read keys that the
    snapshot/technicals tools never produce (and called them with `symbol` not `ticker`)."""
    from backend.agent.ensemble.orchestrator import _build_facts

    snap = {"company_name": "Reliance Industries", "current_price": 1247.4, "change_pct": 1.71, "pe": 22.6, "forward_pe": 17.5,
            "roe_pct": None, "rev_growth_pct": 29.7, "net_margin_pct": 6.61, "market_cap": 16880406364160,
            "provenance": {"quality": "delayed", "source": "yahoo"}}
    tech = {"trend": {"ema_50": 1292.8, "ema_200": 1348.1, "above_50dma": False, "above_200dma": False, "supertrend_dir": -1},
            "momentum": {"rsi_14": 31.96, "roc_20": -6.8}, "volatility": {"atr_pct": 1.6}, "volume": {"rvol_20": 1.38},
            "distance_from_20d_high_pct": 8.0, "active_setups": []}
    text = _build_facts("RELIANCE", snap, tech)
    for needle in ("Price: 1,247.40", "P/E: 22.60", "Fwd P/E: 17.50", "Rev growth: 29.70%", "below 50DMA", "RSI14: 31.96", "Supertrend: down", "Data quality: delayed via yahoo"):
        assert needle in text, (needle, text)
    assert "ROE" not in text  # None values are omitted, not printed as None
