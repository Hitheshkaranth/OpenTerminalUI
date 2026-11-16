from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.agent.ensemble import scorecard
from backend.models.agent_signals import AgentSignal
from backend.shared.db import Base

NOW = datetime(2026, 11, 16, 12, tzinfo=timezone.utc)


@pytest.fixture
def db(monkeypatch):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW if tz is not None else NOW.replace(tzinfo=None)

    monkeypatch.setattr(scorecard, "datetime", Clock)
    # Preserve real datetime isinstance checks while freezing only the call site.
    original_utc_datetime = scorecard._utc_datetime
    def parse(value):
        if isinstance(value, datetime) and not isinstance(value, Clock):
            value = value.isoformat()
        return original_utc_datetime(value)
    monkeypatch.setattr(scorecard, "_utc_datetime", parse)
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


def signal(db, **kwargs):
    args = dict(user_id="me", run_id="run", symbol="AAPL", persona="value_investor",
                signal="bullish", confidence=80, reason="test", price_at_signal=100,
                created_at="2026-01-01T15:00:00+00:00")
    args.update(kwargs)
    row = AgentSignal(**args)
    db.add(row)
    db.commit()
    return row


def bar(date, close):
    return SimpleNamespace(timestamp=date, close=close)


def provider(monkeypatch, bars):
    calls = []
    class Chart:
        async def get_ohlcv(self, symbol, **kwargs):
            calls.append((symbol, kwargs))
            return bars
    async def get():
        return Chart()
    monkeypatch.setattr(scorecard, "get_chart_provider", get)
    return calls


@pytest.mark.asyncio
async def test_old_signal_uses_historical_target_not_latest(db, monkeypatch):
    row = signal(db)
    calls = provider(monkeypatch, [
        bar("2026-11-15T00:00:00Z", 999), bar("2026-01-12T00:00:00Z", 95),
        bar("2026-01-13T00:00:00Z", 120), bar("2026-01-10T00:00:00Z", 90),
    ])
    result = await scorecard.evaluate_signals(db, "me", 10)
    assert result == {"evaluated": 1, "skipped": 0}
    assert row.realized_return_pct == -5
    assert row.correct == 0
    assert calls[0][1]["start"] == datetime(2026, 1, 11, tzinfo=timezone.utc)
    assert calls[0][1]["end"] == datetime(2026, 1, 19, tzinfo=timezone.utc)
    assert "period" not in calls[0][1]


@pytest.mark.asyncio
async def test_stored_horizon_preserved_and_offset_converted(db, monkeypatch):
    row = signal(db, created_at="2026-01-01T23:00:00-05:00", horizon_days=2)
    calls = provider(monkeypatch, [bar("2026-01-04T04:00:00+00:00", 102)])
    assert (await scorecard.evaluate_signals(db, "me", 30))["evaluated"] == 1
    assert row.horizon_days == 2
    assert calls[0][1]["start"].date().isoformat() == "2026-01-04"


@pytest.mark.asyncio
@pytest.mark.parametrize("created", ["bad", "", "2026-13-01", "2027-01-01T00:00:00Z", "2026-11-15T00:00:00Z"])
async def test_malformed_future_unmatured_do_not_fetch(db, monkeypatch, created):
    row = signal(db, created_at=created)
    calls = provider(monkeypatch, [])
    assert await scorecard.evaluate_signals(db, "me", 10) == {"evaluated": 0, "skipped": 1}
    assert row.correct is None
    assert calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("bars", [
    [], [bar("2026-01-10T00:00:00Z", 110)], [bar("2026-01-19T00:00:00Z", 110)],
    [bar("2027-01-11T00:00:00Z", 110)], [bar(None, 110)], [bar("bad", 110)],
    [bar(123456, 110)], [SimpleNamespace(close=110)],
])
async def test_missing_or_invalid_horizon_bar_stays_unevaluated(db, monkeypatch, bars):
    row = signal(db)
    provider(monkeypatch, bars)
    assert await scorecard.evaluate_signals(db, "me") == {"evaluated": 0, "skipped": 1}
    assert row.correct is None


@pytest.mark.asyncio
@pytest.mark.parametrize("price", [None, 0, -1, True, float("nan"), float("inf"), "105"])
async def test_bad_target_price_does_not_move_to_next_day(db, monkeypatch, price):
    row = signal(db)
    provider(monkeypatch, [bar("2026-01-11T00:00:00Z", price), bar("2026-01-12T00:00:00Z", 110)])
    assert (await scorecard.evaluate_signals(db, "me"))["skipped"] == 1
    assert row.correct is None


@pytest.mark.asyncio
async def test_current_day_incomplete_bar_is_excluded(db, monkeypatch):
    row = signal(db, created_at="2026-11-06T00:00:00Z")
    calls = provider(monkeypatch, [bar("2026-11-16T00:00:00Z", 110)])
    assert (await scorecard.evaluate_signals(db, "me"))["skipped"] == 1
    assert calls == []
    assert row.correct is None


@pytest.mark.asyncio
async def test_final_grace_day_allowed_and_other_user_untouched(db, monkeypatch):
    row = signal(db)
    other = signal(db, user_id="them")
    provider(monkeypatch, [bar("2026-01-18T23:00:00Z", 101)])
    assert (await scorecard.evaluate_signals(db, "me"))["evaluated"] == 1
    assert row.correct == 1
    assert other.correct is None


@pytest.mark.asyncio
@pytest.mark.parametrize("horizon", [0, 366, -1, True, 1.5, "10"])
async def test_horizon_argument_bounds(db, horizon):
    with pytest.raises(ValueError, match="horizon_days"):
        await scorecard.evaluate_signals(db, "me", horizon)


@pytest.mark.asyncio
async def test_invalid_stored_horizon_fails_closed(db, monkeypatch):
    row = signal(db, horizon_days=0)
    calls = provider(monkeypatch, [bar("2026-01-11T00:00:00Z", 110)])
    assert (await scorecard.evaluate_signals(db, "me"))["skipped"] == 1
    assert calls == []
    assert row.correct is None


@pytest.mark.asyncio
async def test_naive_timestamps_are_utc_and_repeated_settlement_is_noop(db, monkeypatch):
    row = signal(db, created_at="2026-01-01T15:00:00")
    calls = provider(monkeypatch, [bar(datetime(2026, 1, 11), 105)])
    assert (await scorecard.evaluate_signals(db, "me"))["evaluated"] == 1
    assert (await scorecard.evaluate_signals(db, "me")) == {"evaluated": 0, "skipped": 0}
    assert len(calls) == 1
    assert row.realized_return_pct == 5


@pytest.mark.asyncio
async def test_conflicting_duplicate_target_closes_fail_closed(db, monkeypatch):
    row = signal(db)
    provider(monkeypatch, [bar("2026-01-11T00:00:00Z", 105), bar("2026-01-11T00:00:00Z", 95)])
    assert (await scorecard.evaluate_signals(db, "me"))["skipped"] == 1
    assert row.correct is None
