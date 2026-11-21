"""W4a rehaul: paper fill races, guarded cash, SSRF, alert payload scoping, per-row isolation."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def book(monkeypatch, tmp_path):
    # Import the modules that bind SessionLocal first; patch them (never backend.shared.db).
    from backend.alerts import service as alert_service
    from backend.models import VirtualPortfolio
    from backend.paper_trading import service
    from backend.shared.db import Base

    sql_engine = create_engine(f"sqlite:///{tmp_path / 'w4a.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(sql_engine)
    factory = sessionmaker(bind=sql_engine, autoflush=False)
    with factory() as db:
        db.add(VirtualPortfolio(id="pf", user_id="u1", name="Book", base_currency="INR",
                                initial_capital=100000, current_cash=100000))
        db.commit()
    monkeypatch.setattr(service, "SessionLocal", factory)
    monkeypatch.setattr(alert_service, "SessionLocal", factory)
    engine = service.PaperTradingEngine()
    yield SimpleNamespace(factory=factory, engine=engine, service=service)
    sql_engine.dispose()


def _order(factory, **kwargs):
    from backend.models import VirtualOrder

    values = {"portfolio_id": "pf", "symbol": "NSE:TCS", "side": "buy", "order_type": "market",
              "quantity": 5, "status": "pending", "slippage_bps": 0.0, "commission": 1.0}
    values.update(kwargs)
    with factory() as db:
        row = VirtualOrder(**values)
        db.add(row)
        db.commit()
        return row.id


def _counts(factory, order_id):
    from backend.models import VirtualOrder, VirtualPortfolio, VirtualTrade

    with factory() as db:
        return (db.query(VirtualTrade).filter_by(order_id=order_id).count(),
                db.get(VirtualPortfolio, "pf").current_cash,
                db.get(VirtualOrder, order_id).status)


def test_stale_session_cannot_fill_an_already_filled_order(book):
    from backend.models import VirtualOrder

    order_id = _order(book.factory)
    first, second = book.factory(), book.factory()
    try:
        a = first.get(VirtualOrder, order_id)
        b = second.get(VirtualOrder, order_id)  # both observe "pending"
        book.engine._fill_order(first, a, 100.0)
        first.commit()
        with pytest.raises(book.service.OrderClaimConflict):
            book.engine._fill_order(second, b, 100.0)
        second.commit()
    finally:
        first.close()
        second.close()
    trades, cash, status = _counts(book.factory, order_id)
    assert (trades, status) == (1, "filled")
    assert cash == pytest.approx(100000 - 500 - 1)


@pytest.mark.asyncio
async def test_route_fill_racing_tick_worker_fills_exactly_once(book, monkeypatch):
    from backend.models import VirtualOrder

    order_id = _order(book.factory)

    class RacingFetcher:
        async def fetch_quote(self, _symbol):
            # The tick worker runs while the request awaits its quote.
            await book.engine._evaluate_pending_orders({"symbol": "NSE:TCS", "ltp": 100.0})
            return {"last_price": 100.0}

    async def fetcher():
        return RacingFetcher()

    monkeypatch.setattr(book.service, "get_unified_fetcher", fetcher)
    db = book.factory()
    try:
        row = db.get(VirtualOrder, order_id)
        await book.engine.maybe_fill_market_order_now(db, row)
        db.commit()
        assert row.status == "filled"
    finally:
        db.close()
    trades, cash, status = _counts(book.factory, order_id)
    assert (trades, status) == (1, "filled")
    assert cash == pytest.approx(100000 - 501)


def test_buy_rejected_by_guarded_cash_update_even_with_stale_balance(book):
    from backend.models import VirtualOrder, VirtualPortfolio

    order_id = _order(book.factory)
    db = book.factory()
    try:
        assert db.get(VirtualPortfolio, "pf").current_cash == 100000  # stale in this session
        with book.factory() as other:
            other.get(VirtualPortfolio, "pf").current_cash = 10
            other.commit()
        order = db.get(VirtualOrder, order_id)
        book.engine._fill_order(db, order, 100.0)
        db.commit()
    finally:
        db.close()
    trades, cash, status = _counts(book.factory, order_id)
    assert (trades, cash, status) == (0, 10, "rejected")


@pytest.mark.asyncio
async def test_one_failing_order_does_not_block_the_batch(book, monkeypatch):
    bad = _order(book.factory, order_type="limit", limit_price=101)
    good = _order(book.factory, order_type="limit", limit_price=101)
    original = book.engine._fill_order

    def flaky(db, order, price):
        if order.id == bad:
            raise RuntimeError("boom")
        return original(db, order, price)

    monkeypatch.setattr(book.engine, "_fill_order", flaky)
    await book.engine._evaluate_pending_orders({"symbol": "NSE:TCS", "ltp": 100.0})
    assert _counts(book.factory, good)[0::2] == (1, "filled")
    assert _counts(book.factory, bad)[0::2] == (0, "pending")  # savepoint rolled back, retried next tick


@pytest.mark.asyncio
async def test_index_skips_db_for_symbols_without_pending_orders(book, monkeypatch):
    await book.engine._evaluate_pending_orders({"symbol": "NSE:INFY", "ltp": 10.0})  # loads index
    calls = []
    monkeypatch.setattr(book.engine, "_evaluate_simple_orders_sync", lambda *a: calls.append(a) or ([], set()))
    await book.engine._evaluate_pending_orders({"symbol": "NSE:INFY", "ltp": 10.0})
    assert calls == []


def test_ticks_are_coalesced_per_symbol(book):
    engine = book.engine
    engine._started = True
    engine._tick_event = asyncio.Event()
    for price in (1, 2, 3):
        engine._on_tick({"symbol": "NSE:TCS", "ltp": price})
    assert engine._latest_ticks["NSE:TCS"]["ltp"] == 3
    assert engine._ticks_coalesced == 2


def test_daily_sharpe_resamples_trades_to_business_days(book):
    from backend.models import VirtualTrade

    day = datetime(2026, 1, 5, 10)  # Monday
    with book.factory() as db:
        for i, pnl in enumerate([100, -50, 30]):
            db.add(VirtualTrade(order_id=f"o{i}", portfolio_id="pf", symbol="NSE:TCS", side="sell",
                                quantity=1, price=1, timestamp=day + timedelta(hours=i), pnl_realized=pnl))
        db.add(VirtualTrade(order_id="o9", portfolio_id="pf", symbol="NSE:TCS", side="sell",
                            quantity=1, price=1, timestamp=day + timedelta(days=2), pnl_realized=10))
        db.commit()
        perf = book.engine.portfolio_performance(db, "pf")
    curve = perf["daily_pnl_curve"]
    dates = [point["t"] for point in curve]
    assert len(dates) == len(set(dates))  # one point per day, not per trade
    assert curve[0] == {"t": "2026-01-05", "equity": 100080}
    assert all(datetime.fromisoformat(d).weekday() < 5 for d in dates[:-1])
    assert "daily" in perf["sharpe_basis"]


# ── alerts ────────────────────────────────────────────────────────────


def test_alert_event_payload_carries_owner_user_id():
    from backend.alerts.service import AlertEvaluatorService

    alert = SimpleNamespace(id="a1", user_id="user-42", symbol="NSE:TCS", condition_type="price_above",
                            parameters={}, conditions=[], logic="AND")
    payload = AlertEvaluatorService._build_event_payload(alert, 101.0, datetime(2026, 1, 1))
    assert payload["user_id"] == "user-42"


@pytest.mark.asyncio
async def test_one_failing_alert_does_not_block_others(book, monkeypatch):
    from backend.alerts import service as alert_service
    from backend.models import AlertORM, AlertTriggerORM, User

    with book.factory() as db:
        db.add(User(id="u1", email="w4a@example.com", hashed_password="x", role="trader"))
        for alert_id in ("bad", "good"):
            db.add(AlertORM(id=alert_id, user_id="u1", symbol="NSE:TCS", condition_type="price_above",
                            parameters={"threshold": 50}, status="active", delivery_channels=["in_app"]))
        db.commit()

    async def no_deliver(*_a, **_k):
        return None

    monkeypatch.setattr(alert_service, "deliver_alert", no_deliver)
    svc = alert_service.AlertEvaluatorService()
    original = svc._evaluate

    def flaky(alert, tick):
        if alert.id == "bad":
            raise RuntimeError("boom")
        return original(alert, tick)

    monkeypatch.setattr(svc, "_evaluate", flaky)
    await svc._process_tick({"symbol": "NSE:TCS", "ltp": 100})
    with book.factory() as db:
        assert [t.alert_id for t in db.query(AlertTriggerORM).all()] == ["good"]


@pytest.mark.parametrize("url", [
    "https://169.254.169.254/latest/meta-data",
    "https://127.0.0.1/hook",
    "https://[::1]/hook",
    "https://user:pw@example.com/hook",
    "https://example.com:8443/hook",
])
def test_outbound_url_rejects_internal_targets(url):
    from backend.alerts.delivery import OutboundURLError, validate_outbound_url_for_storage

    with pytest.raises(OutboundURLError):
        validate_outbound_url_for_storage(url)


def test_plain_http_rejected_outside_development(monkeypatch):
    from backend.alerts.delivery import OutboundURLError, check_outbound_url_static

    monkeypatch.setenv("OPENTERMINALUI_ENV", "production")
    with pytest.raises(OutboundURLError):
        check_outbound_url_static("http://example.com/hook")
    monkeypatch.setenv("OPENTERMINALUI_ENV", "development")
    check_outbound_url_static("http://example.com/hook")


def test_discord_url_must_be_discord_webhook():
    from backend.alerts.delivery import OutboundURLError, check_outbound_url_static

    check_outbound_url_static("https://discord.com/api/webhooks/1/abc", discord=True)
    with pytest.raises(OutboundURLError):
        check_outbound_url_static("https://evil.example/api/webhooks/1/abc", discord=True)


@pytest.mark.asyncio
async def test_delivery_revalidates_and_never_posts_to_metadata_ip(monkeypatch):
    from backend.alerts import delivery

    posted = []

    class Client:
        async def post(self, *args, **kwargs):
            posted.append(args)

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def client():
        yield Client()

    monkeypatch.setattr(delivery, "_outbound_client", client)
    alert = SimpleNamespace(id="a", user_id="u", symbol="X", delivery_channels=["webhook", "discord"],
                            delivery_config={"webhook_url": "https://169.254.169.254/x",
                                             "discord_webhook_url": "https://127.0.0.1/api/webhooks/1/a"})
    await delivery.deliver_alert(alert, "msg")
    assert posted == []


def test_create_alert_rejects_ssrf_webhook_with_422(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy.pool import StaticPool

    from backend.alerts.routes import router
    from backend.api.deps import get_db
    from backend.auth.deps import get_current_user
    from backend.shared.db import Base

    sql_engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(sql_engine)
    factory = sessionmaker(bind=sql_engine)
    app = FastAPI()
    app.include_router(router, prefix="/api")

    def _db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="u1")
    client = TestClient(app)
    for config, channels in (
        ({"webhook_url": "https://169.254.169.254/latest"}, ["webhook"]),
        ({"discord_webhook_url": "https://discord.example/hook"}, ["discord"]),
        ({"actions": [{"type": "webhook", "url": "https://127.0.0.1/hook"}]}, ["in_app"]),
    ):
        response = client.post("/api/alerts", json={"symbol": "NSE:TCS", "condition_type": "price_above",
                                                    "parameters": {"threshold": 1}, "channels": channels,
                                                    "delivery_config": config})
        assert response.status_code == 422, (config, response.text)
    sql_engine.dispose()


def test_paper_order_list_is_bounded(book):
    from backend.api.routes.paper import get_orders

    for _ in range(3):
        _order(book.factory, status="cancelled")
    with book.factory() as db:
        user = SimpleNamespace(id="u1")
        assert len(get_orders("pf", limit=2, offset=0, db=db, current_user=user)["items"]) == 2
        assert len(get_orders("pf", limit=2, offset=2, db=db, current_user=user)["items"]) == 1
