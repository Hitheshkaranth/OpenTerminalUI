"""Market hours calendar with holiday support for NSE, NYSE, CME."""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import NamedTuple
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

_HOLIDAYS_PATH = Path(__file__).resolve().parents[2] / "data" / "holidays.json"


class MarketSession(NamedTuple):
    tz: ZoneInfo
    open_time: time
    close_time: time
    pre_market_open: time | None = None
    after_hours_close: time | None = None


SESSIONS: dict[str, MarketSession] = {
    "NSE": MarketSession(
        tz=ZoneInfo("Asia/Kolkata"),
        open_time=time(9, 15),
        close_time=time(15, 30),
    ),
    "BSE": MarketSession(
        tz=ZoneInfo("Asia/Kolkata"),
        open_time=time(9, 15),
        close_time=time(15, 30),
    ),
    "NFO": MarketSession(
        tz=ZoneInfo("Asia/Kolkata"),
        open_time=time(9, 15),
        close_time=time(15, 30),
    ),
    "NYSE": MarketSession(
        tz=ZoneInfo("America/New_York"),
        open_time=time(9, 30),
        close_time=time(16, 0),
        pre_market_open=time(4, 0),
        after_hours_close=time(20, 0),
    ),
    "NASDAQ": MarketSession(
        tz=ZoneInfo("America/New_York"),
        open_time=time(9, 30),
        close_time=time(16, 0),
        pre_market_open=time(4, 0),
        after_hours_close=time(20, 0),
    ),
    "CME": MarketSession(
        tz=ZoneInfo("America/New_York"),
        open_time=time(18, 0),
        close_time=time(17, 0),
    ),
}


def _load_holidays() -> dict[str, list[str]]:
    """Load holiday dates from JSON. Returns {exchange: [YYYY-MM-DD, ...]}."""
    if not _HOLIDAYS_PATH.exists():
        logger.warning("holidays.json not found at %s — no holidays loaded", _HOLIDAYS_PATH)
        return {}
    try:
        return json.loads(_HOLIDAYS_PATH.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("Failed to parse holidays.json")
        return {}


_holidays_cache: dict[str, set[date]] | None = None


def _get_holidays(exchange: str) -> set[date]:
    global _holidays_cache
    if _holidays_cache is None:
        raw = _load_holidays()
        _holidays_cache = {}
        for ex, dates in raw.items():
            _holidays_cache[ex.upper()] = {date.fromisoformat(d) for d in dates}
    exchange_upper = exchange.upper()
    if exchange_upper in {"BSE", "NFO", "BFO"}:
        exchange_upper = "NSE"
    elif exchange_upper == "NASDAQ":
        exchange_upper = "NYSE"
    return _holidays_cache.get(exchange_upper, set())


def is_market_open(exchange: str, dt: datetime | None = None) -> bool:
    """Check whether the given exchange is open at datetime `dt`.

    If dt is None, uses current wall-clock time.
    Returns False on weekends and holidays.
    """
    ex = exchange.upper()
    session = SESSIONS.get(ex)
    if session is None:
        raise ValueError(f"Unknown exchange: {ex}")

    now = dt or datetime.now(session.tz)
    if now.tzinfo is None:
        now = now.replace(tzinfo=session.tz)
    local = now.astimezone(session.tz)

    if local.weekday() >= 5:
        return False

    if local.date() in _get_holidays(ex):
        return False

    t = local.time()

    if ex == "CME":
        return not (time(17, 0) <= t < time(18, 0))

    return session.open_time <= t < session.close_time


def is_extended_hours(exchange: str, dt: datetime | None = None) -> bool:
    """True if in pre-market or after-hours for US exchanges."""
    ex = exchange.upper()
    session = SESSIONS.get(ex)
    if session is None or session.pre_market_open is None:
        return False

    now = dt or datetime.now(session.tz)
    if now.tzinfo is None:
        now = now.replace(tzinfo=session.tz)
    local = now.astimezone(session.tz)

    if local.weekday() >= 5:
        return False
    if local.date() in _get_holidays(ex):
        return False

    t = local.time()
    in_pre = session.pre_market_open <= t < session.open_time
    in_after = session.close_time <= t < (session.after_hours_close or session.close_time)
    return in_pre or in_after


def next_market_open(exchange: str, dt: datetime | None = None) -> datetime:
    """Return the next market open datetime from the given point."""
    ex = exchange.upper()
    session = SESSIONS.get(ex)
    if session is None:
        raise ValueError(f"Unknown exchange: {ex}")

    now = dt or datetime.now(session.tz)
    if now.tzinfo is None:
        now = now.replace(tzinfo=session.tz)
    local = now.astimezone(session.tz)

    candidate = local.replace(
        hour=session.open_time.hour,
        minute=session.open_time.minute,
        second=0,
        microsecond=0,
    )
    if local >= candidate:
        candidate += timedelta(days=1)

    for _ in range(10):
        if candidate.weekday() < 5 and candidate.date() not in _get_holidays(ex):
            return candidate
        candidate += timedelta(days=1)

    return candidate
