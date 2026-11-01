from datetime import datetime, timedelta, timezone
from importlib import import_module
from types import SimpleNamespace
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from alembic.migration import MigrationContext
from alembic.operations import Operations
from backend.shared.db import Base
from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.research_inbox.routes import router
from backend.research_inbox.models import ResearchReviewState
from backend.research_inbox.impact import build_exposure
from backend.research_dossiers.models import ResearchDossier, DossierRevision
from backend.screen_monitoring.models import ScreenSchedule, ScreenChange


@pytest.fixture
def api():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    app = FastAPI()
    app.include_router(router)
    state = {'user': 'owner'}
    def db():
        with Session() as session:
            yield session
    app.dependency_overrides[get_db] = db
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=state['user'])
    with Session() as db:
        db.add(ResearchDossier(id='d', user_id='owner', symbol='ACME', payload={'title': 'Thesis', 'thesis': 'Keep original', 'monitoring_enabled': True}, monitor_state={'last_checked_at': '2026-10-20T12:00:00Z'}))
        db.add(DossierRevision(dossier_id='d', revision=2, snapshot={}, changes=[{'kind': 'condition_changed', 'material': True, 'reason': 'Margin below threshold', 'after': {'status': 'breached', 'value': 17.4}}, {'kind': 'evidence_added', 'material': True, 'after': {'value': 17.4}}]))
        db.commit()
    with TestClient(app) as client:
        yield client, state, Session
    engine.dispose()


BASE = '/api/research/inbox'


def test_queue_groups_events_review_undo_and_ownership(api):
    client, state, Session = api
    body = client.get(BASE).json()
    assert body['counts']['needs_review'] == 1
    assert len(body['items'][0]['changes']) == 2
    assert body['coverage']['checked'] == 1
    event = body['items'][0]['id']
    assert client.patch(f'{BASE}/events/{event}', json={'status': 'reviewed'}).status_code == 200
    assert client.get(BASE).json()['counts']['reviewed'] == 1
    with Session() as db:
        assert db.get(ResearchDossier, 'd').payload['thesis'] == 'Keep original'
    state['user'] = 'other'
    assert client.get(BASE).json()['items'] == []
    assert client.patch(f'{BASE}/events/{event}', json={'status': 'reviewed'}).status_code == 404
    state['user'] = 'owner'
    assert client.patch(f'{BASE}/events/{event}', json={'status': 'needs_review'}).status_code == 200
    assert client.get(BASE).json()['counts']['needs_review'] == 1


def test_snooze_requires_future_timezone_and_reopens(api):
    client, _, Session = api
    event = client.get(BASE).json()['items'][0]['id']
    assert client.patch(f'{BASE}/events/{event}', json={'status': 'snoozed'}).status_code == 422
    assert client.patch(f'{BASE}/events/{event}', json={'status': 'snoozed', 'snoozed_until': '2099-01-01T00:00:00'}).status_code == 422
    assert client.patch(f'{BASE}/events/{event}', json={'status': 'snoozed', 'snoozed_until': (datetime.now(timezone.utc)+timedelta(days=1)).isoformat()}).status_code == 200
    assert client.get(BASE).json()['counts']['upcoming'] == 1
    with Session() as db:
        row = db.get(ResearchReviewState, ('owner', event))
        row.snoozed_until = datetime.now(timezone.utc)-timedelta(seconds=1)
        db.commit()
    assert client.get(BASE).json()['counts']['needs_review'] == 1


def test_portfolio_ownership_checked_before_provider(api, monkeypatch):
    client, _, _ = api
    async def forbidden(*args):
        raise AssertionError('Must not fetch other users quotes')
    monkeypatch.setattr('backend.research_inbox.impact.fetch_stock_snapshot_coalesced', forbidden)
    assert client.get(BASE+'/portfolios/secret/impact').status_code == 404


def test_exposure_deduplicates_lots_separates_disclosed_and_unknown():
    holdings = [SimpleNamespace(symbol='A', shares=1), SimpleNamespace(symbol='A', shares=1), SimpleNamespace(symbol='B', shares=2)]
    snapshots = {'A': SimpleNamespace(payload={'suppliers': [{'name': 'Shared supplier', 'share_pct': .2, 'citation': {'quote': '20% of purchases', 'source_url': 'https://example.com/filing'}}]}),
                 'B': SimpleNamespace(payload={'suppliers': [{'name': 'Shared supplier', 'citation': None}]})}
    quotes = {s: {'current_price': 100, 'currency': 'USD', 'provenance': {'source': 'exchange', 'quality': 'delayed'}} for s in ('A', 'B')}
    result = build_exposure(holdings, snapshots, [], quotes, 'USD')
    assert result['items'][0]['holding_count'] == 2
    assert result['items'][0]['portfolio_weight_pct'] == 100
    assert result['items'][0]['holdings'][0]['business_share_pct'] == 20
    assert result['coverage']['unknown_symbols'] == ['B']
    result = build_exposure(holdings, snapshots, [], {'A': quotes['A']}, 'USD')
    assert result['items'][0]['portfolio_weight_pct'] is None
    assert result['coverage']['quote_gaps'] == ['B']
    quotes['B']['currency'] = 'INR'
    assert not build_exposure(holdings, snapshots, [], quotes, 'USD')['coverage']['weights_complete']


def test_review_migration_matches_models_and_is_repeatable(monkeypatch):
    migration = import_module('backend.alembic.versions.0014_research_review')
    engine = create_engine('sqlite://')
    with engine.begin() as conn:
        monkeypatch.setattr(migration, 'op', Operations(MigrationContext.configure(conn)))
        migration.upgrade()
        migration.upgrade()
        for model in (ResearchReviewState, ScreenSchedule, ScreenChange):
            columns = {c['name']: c for c in inspect(conn).get_columns(model.__tablename__)}
            assert set(columns) == set(model.__table__.columns.keys())
            for col in model.__table__.columns:
                assert columns[col.name]['nullable'] == col.nullable
                assert str(columns[col.name]['type']) == str(col.type)
            assert {i['name'] for i in inspect(conn).get_indexes(model.__tablename__)} == {i.name for i in model.__table__.indexes}
        migration.downgrade()
        migration.downgrade()
        assert not inspect(conn).has_table('research_review_states')


def test_screen_coverage_distinguishes_unrun_failed_partial_and_overdue(api):
    from backend.models import UserScreenORM
    client, _, Session = api
    now = datetime.now(timezone.utc)
    with Session() as db:
        for ident in ('unrun', 'partial', 'failed'):
            db.add(UserScreenORM(id=ident, user_id='owner', name=ident, query='ROE > 20', description='', columns_config=[], viz_config={}, is_public=False, upvotes=0))
        db.add(ScreenSchedule(id='unrun', user_id='owner', screen_id='unrun', config={}, enabled=True, next_run_at=now+timedelta(days=1)))
        db.add(ScreenSchedule(id='partial', user_id='owner', screen_id='partial', config={}, enabled=True, last_run_at=now, next_run_at=now+timedelta(days=1), snapshot={'coverage': {'requested': 10, 'evaluated': 4}}))
        db.add(ScreenSchedule(id='failed', user_id='owner', screen_id='failed', config={}, enabled=True, next_run_at=now-timedelta(hours=1), error='Provider failed'))
        db.commit()
    coverage = client.get(BASE).json()['coverage']
    assert coverage['checked'] == 1
    assert coverage['recently_checked'] == 0
    assert coverage['screen_schedules'] == 3
    assert coverage['screen_awaiting_check'] == 2
    assert coverage['screen_failed'] == 1
    assert coverage['screen_partial'] == 1
    assert coverage['screen_overdue'] == 1
    assert coverage['screen_evaluated'] == 4
    assert coverage['screen_requested'] == 10


def test_screen_run_is_grouped_reviewable_and_owned(api):
    from backend.models import UserScreenORM
    client, state, Session = api
    with Session() as db:
        db.add(UserScreenORM(id='screen', user_id='owner', name='Quality', query='ROE > 20', description='', columns_config=[], viz_config={}, is_public=False, upvotes=0))
        db.add(ScreenSchedule(id='schedule', user_id='owner', screen_id='screen', config={}, enabled=True))
        for symbol, kind in [('A', 'entered'), ('B', 'exited')]:
            db.add(ScreenChange(user_id='owner', schedule_id='schedule', symbol=symbol, kind=kind, payload={'run_id': 'same-run', 'rules': ['roe > 20'], 'before': {'roe': 19}, 'after': {'roe': 21}}))
        db.commit()
    events = [e for e in client.get(BASE).json()['items'] if e['kind'] == 'screen']
    assert len(events) == 1
    event = events[0]
    assert event['title'] == 'Quality: 1 entered, 1 exited'
    assert len(event['changes']) == 2
    assert event['changes'][0]['symbol'] == 'A'
    assert client.patch(f"{BASE}/events/{event['id']}", json={'status': 'reviewed'}).status_code == 200
    assert next(e for e in client.get(BASE).json()['items'] if e['id'] == event['id'])['bucket'] == 'reviewed'
    state['user'] = 'other'
    assert client.patch(f"{BASE}/events/{event['id']}", json={'status': 'reviewed'}).status_code == 404


def test_earnings_revision_is_included_and_dossier_link_selects_id(api):
    client, _, Session = api
    with Session() as db:
        db.add(DossierRevision(dossier_id='d', revision=3, snapshot={}, changes=[{'kind': 'earnings_review', 'material': True, 'after': {'period': 'Q2', 'metrics': [{'metric': 'eps', 'actual': 2}]}}]))
        db.commit()
    event = next(e for e in client.get(BASE).json()['items'] if e['id'] == 'dossier:d:3')
    assert event['kind'] == 'earnings'
    assert event['source_url'] == '/equity/research-dossiers?id=d'
    assert event['changes'][0]['after']['metrics'][0]['actual'] == 2
