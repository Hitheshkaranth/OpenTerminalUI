"""Deterministic venue/session regression tests; no live providers required."""
import asyncio
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from backend.services import data_quality_monitor as quality
from backend.services.data_quality_monitor import DataQualityMonitor, SymbolMetrics
from backend.services.quality_calendar import resolve_market, session_for

ET = ZoneInfo('America/New_York')
IST = ZoneInfo('Asia/Kolkata')


def local(text, zone=ET):
    return datetime.fromisoformat(text).replace(tzinfo=zone)


@pytest.mark.parametrize('market,symbol,when,state,expected', [
    ('NYSE', 'AAPL', '2026-02-18T09:29:00', 'closed', 0),
    ('NYSE', 'AAPL', '2026-02-18T09:30:00', 'open', 0),
    ('NYSE', 'AAPL', '2026-02-18T10:00:00', 'open', 30),
    ('NYSE', 'AAPL', '2026-02-18T16:00:00', 'closed', 390),
    ('NYSE', 'AAPL', '2026-02-21T10:00:00', 'closed', 0),
    ('NASDAQ', 'AAPL', '2026-01-19T10:00:00', 'closed', 0),
    ('NYSE', 'AAPL', '2026-11-27T13:00:00', 'closed', 210),
    ('NASDAQ', 'AAPL', '2026-12-24T15:00:00', 'closed', 210),
    ('NYSE', 'AAPL', '2027-02-18T10:00:00', 'unknown', None),
])
def test_us_regular_boundaries_holidays_and_half_days(market, symbol, when, state, expected):
    now = local(when)
    session = session_for(symbol, now, market)
    assert session.state == state
    assert session.elapsed_minutes(now) == expected


@pytest.mark.parametrize('scope,when,state,minutes', [
    ('regular', '2026-02-18T07:00:00', 'closed', 0),
    ('extended', '2026-02-18T07:00:00', 'open', 180),
    ('extended', '2026-02-18T20:00:00', 'closed', 960),
    ('extended', '2026-11-27T16:00:00', 'open', 720),
    ('extended', '2026-11-27T17:00:00', 'closed', 780),
])
def test_extended_scope_is_explicit(scope, when, state, minutes):
    now = local(when)
    session = session_for('AAPL', now, 'US', scope)
    assert session.state == state
    assert session.elapsed_minutes(now) == minutes
    assert 'assumption' in session.note


@pytest.mark.parametrize('day,utc_open', [('2026-03-06', 14), ('2026-03-09', 13)])
def test_us_dst_changes_utc_session_open(day, utc_open):
    session = session_for('AAPL', local(day + 'T10:00:00'), 'US')
    assert session.open.hour == utc_open
    assert session.open.minute == 30
    assert session.elapsed_minutes(local(day + 'T10:00:00')) == 30


@pytest.mark.parametrize('market', ['NSE', 'BSE'])
def test_indian_cash_equity_hours_and_holiday(market):
    before = local('2026-02-18T09:14:00', IST)
    opened = local('2026-02-18T09:15:00', IST)
    closed = local('2026-02-18T15:30:00', IST)
    assert session_for('RELIANCE', before, market).state == 'closed'
    assert session_for('RELIANCE', opened, market).state == 'open'
    end = session_for('RELIANCE', closed, market)
    assert end.state == 'closed'
    assert end.elapsed_minutes(closed) == 375
    assert session_for('RELIANCE', local('2026-01-26T10:00:00', IST), market).state == 'closed'
    assert session_for('RELIANCE', opened, market, 'extended').state == 'unknown'


def test_market_resolution_does_not_guess_ambiguous_tickers_or_derivatives():
    assert resolve_market('AAPL') == 'UNKNOWN'
    assert resolve_market('RELIANCE') == 'UNKNOWN'
    assert resolve_market('RELIANCE.NS') == 'NSE'
    assert resolve_market('INFY.BO') == 'BSE'
    assert resolve_market('NASDAQ:AAPL') == 'NASDAQ'
    now = local('2026-02-18T10:00:00')
    for market in [None, 'NFO', 'CME', 'LSE']:
        session = session_for('ABC', now, market)
        assert session.state == 'unknown'
        assert session.elapsed_minutes(now) is None
    assert SymbolMetrics('AAPL').health_status(now) == 'unknown'


def test_crypto_weekends_continuous_staleness_and_utc_midnight():
    before = datetime(2026, 2, 21, 23, 58, tzinfo=timezone.utc)
    after = datetime(2026, 2, 22, 0, 5, tzinfo=timezone.utc)
    metrics = SymbolMetrics('BTC-USD', market='CRYPTO')
    metrics.on_tick(before, 10, 'crypto')
    metrics.on_bar(before)
    assert metrics.health_status(after) == 'stale'  # No midnight opening grace.
    assert metrics.bars_received_for(after) == 0
    metrics.on_bar(after)
    assert metrics.bars_received_for(after) == 1
    assert metrics.gap_events()[-1]['missing_count'] == 6
    assert metrics.bars_expected_today(after) == 5
    assert metrics.session(after).scope == 'continuous'


def test_bar_counts_exclude_extended_minutes_and_no_false_overnight_gap():
    metrics = SymbolMetrics('AAPL', market='US')
    metrics.on_bar(local('2026-02-18T08:00:00'))
    metrics.on_bar(local('2026-02-18T15:59:00'))
    metrics.on_bar(local('2026-02-18T16:00:00'))
    assert metrics.bars_received_today == 1
    metrics.on_bar(local('2026-02-19T09:30:00'))
    assert metrics.bars_received_today == 1
    assert metrics.gap_events() == []
    metrics.on_bar(local('2026-02-18T10:00:00'))  # Older session ignored.
    assert metrics.bars_received_today == 1
    metrics.on_bar(local('2026-02-19T09:33:00'))
    assert metrics.gap_events()[-1]['missing_count'] == 2
    metrics.on_bar(local('2026-02-19T09:33:00'))
    assert metrics.bars_received_today == 2
    assert len(metrics.gap_events()) == 1


def test_us_local_session_day_survives_utc_midnight():
    metrics = SymbolMetrics('AAPL', market='US', session_scope='extended')
    first = local('2026-02-18T18:59:00')  # 23:59 UTC
    second = local('2026-02-18T19:00:00')  # next UTC date
    metrics.on_bar(first)
    metrics.on_bar(second)
    assert metrics.bars_received_for(second) == 2
    assert metrics.session(second).date == '2026-02-18'
    assert metrics.gap_events() == []


def test_closed_no_data_unknown_disconnected_and_opening_grace():
    metrics = SymbolMetrics('AAPL', market='US')
    assert metrics.health_status(local('2026-02-18T10:00:00')) == 'no_data'
    assert metrics.health_status(local('2026-02-18T18:00:00')) == 'closed'
    metrics.on_tick(local('2026-02-18T15:59:00'), 2, 'feed')
    assert metrics.health_status(local('2026-02-19T09:31:00')) == 'no_data'
    assert metrics.health_status(local('2026-02-19T09:36:00')) == 'stale'
    assert metrics.health_status(local('2026-02-19T09:36:00'), False) == 'disconnected'
    assert metrics.bars_received_for(local('2026-02-19T09:36:00')) == 0


def test_report_metadata_and_stale_alerts_are_per_venue(monkeypatch):
    now = local('2026-02-18T11:00:00', IST)  # India open, US closed.
    monkeypatch.setattr(quality, '_utcnow', lambda: now.astimezone(timezone.utc))
    events = []

    async def emit(payload):
        events.append(payload)

    async def run():
        monitor = DataQualityMonitor(emit)
        old = now - timedelta(minutes=10)
        await monitor.record_tick('RELIANCE.NS', old, 'NSEFeed')
        await monitor.record_tick('AAPL', old, 'usfeed', market='US')
        await monitor.record_tick('BTC-USD', old, 'crypto', market='CRYPTO')
        await monitor.record_bar('AMBIGUOUS', old)
        await monitor._emit_stale_alerts()
        await monitor._emit_stale_alerts()
        assert {event['symbol'] for event in events} == {'RELIANCE.NS', 'BTC-USD'}
        assert len(events) == 2
        report = await monitor.get_report()
        rows = {row['symbol']: row for row in report['symbols']}
        assert rows['AAPL']['health_status'] == 'closed'
        assert rows['RELIANCE.NS']['timezone'] == 'Asia/Kolkata'
        assert rows['RELIANCE.NS']['market'] == 'NSE'
        assert rows['RELIANCE.NS']['session_scope'] == 'regular'
        assert rows['RELIANCE.NS']['bars_expected_today'] == 105
        assert 'bundled' in rows['RELIANCE.NS']['calendar_coverage']
        assert 'not a live exchange calendar' in rows['RELIANCE.NS']['calendar_note']
        assert rows['AMBIGUOUS']['health_status'] == 'unknown'
        assert rows['AMBIGUOUS']['bars_expected_today'] is None
        await monitor.record_tick('RELIANCE.NS', now, 'NSEFeed')
        refreshed = {row['symbol']: row for row in (await monitor.get_report())['symbols']}
        assert refreshed['RELIANCE.NS']['health_status'] == 'healthy'

    asyncio.run(run())


def test_explicit_metadata_can_configure_previously_ambiguous_symbol(monkeypatch):
    now = local('2026-02-18T10:00:00')
    monkeypatch.setattr(quality, '_utcnow', lambda: now.astimezone(timezone.utc))

    async def run():
        monitor = DataQualityMonitor()
        await monitor.record_bar('AAPL', now)
        assert (await monitor.get_report())['symbols'][0]['health_status'] == 'unknown'
        await monitor.record_tick('AAPL', now, 'feed', exchange='NASDAQ')
        await monitor.record_bar('AAPL', now)
        row = (await monitor.get_report())['symbols'][0]
        assert row['market'] == 'NASDAQ'
        assert row['bars_received_today'] == 1
        assert row['health_status'] == 'healthy'

    asyncio.run(run())
