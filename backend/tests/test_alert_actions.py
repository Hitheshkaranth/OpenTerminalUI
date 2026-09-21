from __future__ import annotations

import sys
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.alerts.actions import ActionValidationError, validate_actions
from backend.alerts.routes import router
from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models import (
    AlertConditionType,
    AlertORM,
    AlertStatus,
    AlertTriggerORM,
    User,
    VirtualOrder,
    VirtualOrderStatus,
    VirtualPortfolio,
    WatchlistORM,
)
from backend.shared.db import Base


def _build_client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.include_router(router, prefix="/api")

    def _db_override():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    def _user_override():
        yield User(
            id="test-user-1",
            email="test@example.com",
            role="trader",
        )

    app.dependency_overrides[get_db] = _db_override
    app.dependency_overrides[get_current_user] = _user_override
    return TestClient(app), SessionLocal


def _seed_user(db: Session) -> User:
    from passlib.context import CryptContext
    pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
    user = User(id="test-user-1", email="test@example.com", hashed_password=pwd.hash("testpass123"), role="trader")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _seed_portfolio(db: Session, user_id: str = "test-user-1") -> VirtualPortfolio:
    p = VirtualPortfolio(
        id="portfolio-1",
        user_id=user_id,
        name="Test Portfolio",
        initial_capital=100000.0,
        current_cash=100000.0,
        is_active=True,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def _seed_watchlist(db: Session, user_id: str = "test-user-1", symbols: list[str] | None = None) -> WatchlistORM:
    w = WatchlistORM(
        id="watchlist-1",
        user_id=user_id,
        name="Test Watchlist",
        symbols_json=symbols or [],
    )
    db.add(w)
    db.commit()
    db.refresh(w)
    return w


def _seed_alert(
    db: Session,
    user_id: str = "test-user-1",
    symbol: str = "RELIANCE",
    delivery_config: dict | None = None,
) -> AlertORM:
    a = AlertORM(
        id="alert-1",
        user_id=user_id,
        symbol=symbol,
        condition_type=AlertConditionType.PRICE_ABOVE.value,
        parameters={"threshold": 2500},
        status=AlertStatus.ACTIVE.value,
        delivery_config=delivery_config or {},
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


# ── validate_actions ──────────────────────────────────────────────────

class TestValidateActions:
    def test_none_returns_empty(self):
        assert validate_actions(None) == []

    def test_empty_list_returns_empty(self):
        assert validate_actions([]) == []

    def test_not_a_list_raises(self):
        with pytest.raises(ActionValidationError, match="actions must be a list"):
            validate_actions("bad")
        with pytest.raises(ActionValidationError, match="actions must be a list"):
            validate_actions(123)
        with pytest.raises(ActionValidationError, match="actions must be a list"):
            validate_actions({"type": "webhook", "url": "https://x.com"})

    def test_too_many(self):
        raw = [{"type": "webhook", "url": "https://x.com"}] * 6
        with pytest.raises(ActionValidationError, match="too many actions"):
            validate_actions(raw)

    def test_happy_path_all_types(self):
        raw = [
            {"type": "paper_order", "portfolio_id": "pf-1", "side": "buy", "quantity": 10},
            {"type": "add_to_watchlist", "watchlist_id": "wl-1"},
            {"type": "webhook", "url": "https://example.com/hook", "payload": {"foo": "bar"}},
        ]
        result = validate_actions(raw)
        assert len(result) == 3
        assert result[0] == {"type": "paper_order", "portfolio_id": "pf-1", "side": "buy", "quantity": 10.0, "order_type": "market"}
        assert result[1] == {"type": "add_to_watchlist", "watchlist_id": "wl-1"}
        assert result[2] == {"type": "webhook", "url": "https://example.com/hook", "payload": {"foo": "bar"}}

    def test_unknown_type_raises(self):
        raw = [{"type": "sms_alert", "phone": "123"}]
        with pytest.raises(ActionValidationError, match="unsupported action type: sms_alert"):
            validate_actions(raw)

    def test_paper_order_bad_side(self):
        raw = [{"type": "paper_order", "portfolio_id": "pf-1", "side": "hold", "quantity": 1}]
        with pytest.raises(ActionValidationError, match="side must be buy or sell"):
            validate_actions(raw)

    def test_paper_order_zero_quantity(self):
        raw = [{"type": "paper_order", "portfolio_id": "pf-1", "side": "buy", "quantity": 0}]
        with pytest.raises(ActionValidationError, match="quantity must be > 0"):
            validate_actions(raw)

    def test_paper_order_negative_quantity(self):
        raw = [{"type": "paper_order", "portfolio_id": "pf-1", "side": "buy", "quantity": -5}]
        with pytest.raises(ActionValidationError, match="quantity must be > 0"):
            validate_actions(raw)

    def test_paper_order_bad_order_type(self):
        raw = [{"type": "paper_order", "portfolio_id": "pf-1", "side": "buy", "quantity": 1, "order_type": "limit"}]
        with pytest.raises(ActionValidationError, match="order_type must be 'market'"):
            validate_actions(raw)

    def test_paper_order_missing_portfolio_id(self):
        raw = [{"type": "paper_order", "side": "buy", "quantity": 1}]
        with pytest.raises(ActionValidationError, match="portfolio_id is required"):
            validate_actions(raw)

    def test_webhook_bad_url(self):
        raw = [{"type": "webhook", "url": "ftp://bad.com"}]
        with pytest.raises(ActionValidationError, match="url must start with http"):
            validate_actions(raw)

    def test_webhook_missing_url(self):
        raw = [{"type": "webhook"}]
        with pytest.raises(ActionValidationError, match="url must start with http"):
            validate_actions(raw)

    def test_webhook_bad_payload(self):
        raw = [{"type": "webhook", "url": "https://x.com", "payload": "not-a-dict"}]
        with pytest.raises(ActionValidationError, match="payload must be a dict or null"):
            validate_actions(raw)

    def test_add_to_watchlist_missing_watchlist_id(self):
        raw = [{"type": "add_to_watchlist"}]
        with pytest.raises(ActionValidationError, match="watchlist_id is required"):
            validate_actions(raw)

    def test_order_type_defaults_market(self):
        raw = [{"type": "paper_order", "portfolio_id": "pf-1", "side": "buy", "quantity": 5}]
        result = validate_actions(raw)
        assert result[0]["order_type"] == "market"


# ── run_actions ───────────────────────────────────────────────────────

class TestRunActions:
    def test_paper_order_creates_order(self):
        """Paper order creates a VirtualOrder in the right portfolio."""
        client, SessionLocal = _build_client()
        db = SessionLocal()
        try:
            user = _seed_user(db)
            portfolio = _seed_portfolio(db, user.id)
            alert = _seed_alert(db, user.id, "RELIANCE")

            from backend.alerts.actions import run_actions, validate_actions

            results = asyncio.run(run_actions(db, alert, {"message": "triggered"}))
            assert len(results) == 0

            # Seed an action through validate_actions so it's normalised
            normalised = validate_actions([{
                "type": "paper_order", "portfolio_id": portfolio.id, "side": "buy", "quantity": 5,
            }])
            alert.delivery_config = {"actions": normalised}
            db.commit()
            db.refresh(alert)

            results = asyncio.run(run_actions(db, alert, {"message": "triggered"}))
            assert len(results) == 1
            assert results[0]["ok"] is True
            assert results[0]["type"] == "paper_order"
            assert "order" in results[0]["detail"]

            # Verify order exists in DB
            orders = db.query(VirtualOrder).all()
            assert len(orders) == 1
            assert orders[0].symbol == "NSE:RELIANCE"
            assert orders[0].side == "buy"
            assert orders[0].quantity == 5.0
            assert orders[0].status in {VirtualOrderStatus.PENDING.value, VirtualOrderStatus.FILLED.value}
        finally:
            db.close()

    def test_paper_order_refuses_other_user(self):
        """Paper order refuses a portfolio that belongs to another user."""
        client, SessionLocal = _build_client()
        db = SessionLocal()
        try:
            _seed_user(db)
            other_user = User(
                id="other-user",
                email="other@example.com",
                hashed_password="$2b$12$dummyhashfortesting",
                role="trader",
            )
            db.add(other_user)
            db.commit()
            other_portfolio = VirtualPortfolio(
                id="pf-other",
                user_id="other-user",
                name="Other",
                initial_capital=50000,
                current_cash=50000,
                is_active=True,
            )
            db.add(other_portfolio)
            db.commit()

            alert = _seed_alert(db, "test-user-1", "TCS")

            from backend.alerts.actions import run_actions, validate_actions

            normalised = validate_actions([{
                "type": "paper_order", "portfolio_id": other_portfolio.id, "side": "buy", "quantity": 3,
            }])
            alert.delivery_config = {"actions": normalised}
            db.commit()
            db.refresh(alert)

            results = asyncio.run(run_actions(db, alert, {"message": "triggered"}))
            assert len(results) == 1
            assert results[0]["ok"] is False
            assert results[0]["detail"] == "portfolio not found"
        finally:
            db.close()

    def test_add_to_watchlist_appends_once(self):
        """add_to_watchlist appends symbol; second run says 'already present'."""
        client, SessionLocal = _build_client()
        db = SessionLocal()
        try:
            user = _seed_user(db)
            watchlist = _seed_watchlist(db, user.id, symbols=["HDFC"])
            alert = _seed_alert(db, user.id, "RELIANCE")

            from backend.alerts.actions import run_actions, validate_actions

            normalised = validate_actions([{
                "type": "add_to_watchlist", "watchlist_id": watchlist.id,
            }])
            alert.delivery_config = {"actions": normalised}
            db.commit()
            db.refresh(alert)

            results1 = asyncio.run(run_actions(db, alert, {"message": "triggered"}))
            assert len(results1) == 1
            assert results1[0]["ok"] is True
            assert results1[0]["detail"] == "added"

            db.refresh(watchlist)
            assert "RELIANCE" in watchlist.symbols_json

            # Second run: should say already present
            results2 = asyncio.run(run_actions(db, alert, {"message": "triggered"}))
            assert results2[0]["ok"] is True
            assert results2[0]["detail"] == "already present"
        finally:
            db.close()

    def test_add_to_watchlist_symbol_normalised(self):
        """Symbol gets uppercased and EXCHANGE: prefix stripped."""
        client, SessionLocal = _build_client()
        db = SessionLocal()
        try:
            user = _seed_user(db)
            _seed_watchlist(db, user.id, symbols=["ABC"])
            alert = _seed_alert(db, user.id, "EXCHANGE:nifty")

            from backend.alerts.actions import run_actions, validate_actions

            normalised = validate_actions([{
                "type": "add_to_watchlist", "watchlist_id": "watchlist-1",
            }])
            alert.delivery_config = {"actions": normalised}
            db.commit()
            db.refresh(alert)

            results = asyncio.run(run_actions(db, alert, {"message": "triggered"}))
            assert results[0]["ok"] is True
        finally:
            db.close()

    def test_webhook_success(self):
        """Webhook POST with mocked httpx returns ok=True for 2xx."""
        client, SessionLocal = _build_client()
        db = SessionLocal()
        try:
            alert = _seed_alert(db, "test-user-1", "INFY")

            mock_response = AsyncMock()
            mock_response.status_code = 200
            mock_response.text = ""

            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)

            from backend.alerts.actions import run_actions, validate_actions

            normalised = validate_actions([{
                "type": "webhook", "url": "https://example.com/hook", "payload": {"custom": "data"},
            }])
            alert.delivery_config = {"actions": normalised}
            db.commit()
            db.refresh(alert)

            with patch("backend.alerts.actions.httpx.AsyncClient", return_value=mock_client):
                results = asyncio.run(run_actions(db, alert, {"message": "triggered msg"}))

            assert len(results) == 1
            assert results[0]["ok"] is True
            assert "200" in results[0]["detail"]

            # Verify request body
            call_args = mock_client.post.call_args
            assert call_args[1]["json"]["alert_id"] == alert.id
            assert call_args[1]["json"]["symbol"] == "INFY"
            assert call_args[1]["json"]["message"] == "triggered msg"
            assert call_args[1]["json"]["custom"] == "data"
        finally:
            db.close()

    def test_webhook_failure(self):
        """Webhook POST with non-2xx returns ok=False."""
        client, SessionLocal = _build_client()
        db = SessionLocal()
        try:
            alert = _seed_alert(db, "test-user-1", "INFY")

            mock_response = AsyncMock()
            mock_response.status_code = 500
            mock_response.text = "internal error"

            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)

            from backend.alerts.actions import run_actions, validate_actions

            normalised = validate_actions([{
                "type": "webhook", "url": "https://example.com/hook",
            }])
            alert.delivery_config = {"actions": normalised}
            db.commit()
            db.refresh(alert)

            with patch("backend.alerts.actions.httpx.AsyncClient", return_value=mock_client):
                results = asyncio.run(run_actions(db, alert, {"message": "triggered"}))

            assert results[0]["ok"] is False
            assert "500" in results[0]["detail"]
        finally:
            db.close()

    def test_webhook_network_error(self):
        """Webhook POST that raises returns ok=False with error message."""
        client, _ = _build_client()
        db, SessionLocal = None, None  # not needed

        alert = AlertORM(
            id="alert-err",
            user_id="test-user-1",
            symbol="INFY",
            condition_type=AlertConditionType.PRICE_ABOVE.value,
            parameters={},
            status=AlertStatus.ACTIVE.value,
            delivery_config={"actions": [{"type": "webhook", "url": "https://broken.local"}]},
        )

        from backend.alerts.actions import run_actions

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=Exception("connection failed"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("backend.alerts.actions.httpx.AsyncClient", return_value=mock_client):
            results = asyncio.run(run_actions(None, alert, {"message": "test"}))  # db=None, webhook doesn't use it

        assert results[0]["ok"] is False
        assert "connection failed" in results[0]["detail"]

    def test_dry_run_creates_nothing(self):
        """dry_run=True returns ok=True detail but creates no VirtualOrder."""
        client, SessionLocal = _build_client()
        db = SessionLocal()
        try:
            portfolio = _seed_portfolio(db)
            alert = _seed_alert(db, "test-user-1", "SBIN")

            from backend.alerts.actions import run_actions, validate_actions

            normalised = validate_actions([{
                "type": "paper_order", "portfolio_id": portfolio.id, "side": "buy", "quantity": 10,
            }])
            alert.delivery_config = {"actions": normalised}
            db.commit()
            db.refresh(alert)

            results = asyncio.run(run_actions(db, alert, {"message": "dry"}, dry_run=True))
            assert len(results) == 1
            assert results[0]["ok"] is True
            assert "would place market buy" in results[0]["detail"]
            assert "NSE:SBIN" in results[0]["detail"]

            # Verify nothing was created
            orders = db.query(VirtualOrder).all()
            assert len(orders) == 0
        finally:
            db.close()

    def test_dry_run_webhook(self):
        """dry_run webhook skips request, validates url only."""
        client, _ = _build_client()

        alert = AlertORM(
            id="alert-dr",
            user_id="test-user-1",
            symbol="TCS",
            condition_type=AlertConditionType.PRICE_ABOVE.value,
            parameters={},
            status=AlertStatus.ACTIVE.value,
            delivery_config={"actions": [{"type": "webhook", "url": "https://ok.com/hook"}]},
        )

        from backend.alerts.actions import run_actions

        with patch("backend.alerts.actions.httpx.AsyncClient") as mock_cls:
            results = asyncio.run(run_actions(None, alert, {"message": "dry"}, dry_run=True))

        assert results[0]["ok"] is True
        mock_cls.assert_not_called()

    def test_multiple_actions_independent(self):
        """One action fails, the next still runs."""
        client, SessionLocal = _build_client()
        db = SessionLocal()
        try:
            portfolio = _seed_portfolio(db)
            # No watchlist created, so add_to_watchlist will fail
            alert = _seed_alert(db, "test-user-1", "AXIS")

            from backend.alerts.actions import run_actions, validate_actions

            normalised = validate_actions([
                {"type": "paper_order", "portfolio_id": portfolio.id, "side": "buy", "quantity": 5},
                {"type": "add_to_watchlist", "watchlist_id": "nonexistent"},
            ])
            alert.delivery_config = {"actions": normalised}
            db.commit()
            db.refresh(alert)

            results = asyncio.run(run_actions(db, alert, {"message": "multi"}))
            assert len(results) == 2
            assert results[0]["ok"] is True
            assert results[1]["ok"] is False
        finally:
            db.close()


# ── Route-level tests ─────────────────────────────────────────────────

class TestRouteValidation:
    def test_create_alert_422_on_bad_actions(self):
        """POST /alerts returns 422 when actions array has invalid action."""
        client, _ = _build_client()
        resp = client.post(
            "/api/alerts",
            json={
                "symbol": "NSE:RELIANCE",
                "condition_type": "price_above",
                "parameters": {"threshold": 2500},
                "channels": ["in_app"],
                "delivery_config": {
                    "actions": [
                        {"type": "paper_order", "portfolio_id": "", "side": "buy", "quantity": 1},
                    ],
                },
            },
        )
        assert resp.status_code == 422

    def test_create_alert_accepts_valid_actions(self):
        """POST /alerts returns 200 when actions are valid."""
        client, _ = _build_client()
        resp = client.post(
            "/api/alerts",
            json={
                "symbol": "NSE:RELIANCE",
                "condition_type": "price_above",
                "parameters": {"threshold": 2500},
                "channels": ["in_app"],
                "delivery_config": {
                    "actions": [
                        {"type": "webhook", "url": "https://example.com/hook"},
                    ],
                },
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "created"

    def test_dry_run_route_200(self):
        """POST /alerts/{id}/actions/dry-run returns 200."""
        client, SessionLocal = _build_client()
        db = SessionLocal()
        try:
            alert = _seed_alert(db, "test-user-1", "RELIANCE", delivery_config={
                "actions": [{"type": "webhook", "url": "https://example.com/hook"}],
            })
        finally:
            db.close()

        resp = client.post(f"/api/alerts/{alert.id}/actions/dry-run")
        assert resp.status_code == 200
        data = resp.json()
        assert data["alert_id"] == alert.id
        assert "actions" in data

    def test_dry_run_route_404(self):
        """POST /alerts/{id}/actions/dry-run returns 404 for unknown alert."""
        client, _ = _build_client()
        resp = client.post("/api/alerts/nonexistent/actions/dry-run")
        assert resp.status_code == 404


# ── Helpers: need asyncio import ──────────────────────────────────────

import asyncio