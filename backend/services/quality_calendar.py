"""Session expectations for cash-equity/crypto quality monitoring.

Reuse the application's bundled holiday calendar. Its coverage is deliberately
reported rather than presenting a partial static file as an exchange feed.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone

from backend.shared import market_calendar

# Cash-equity early closes, verified 2026-11-14 against the NYSE/Nasdaq schedules:
# https://www.nyse.com/trade/hours-calendars
# https://www.nasdaq.com/holiday-trading-hours
_US_EARLY_CLOSES = {"2026-11-27", "2026-12-24"}


def resolve_market(symbol: str, market: str | None = None) -> str:
    if market:
        value = market.strip().upper()
        aliases = {"INDIA": "NSE", "IN": "NSE", "USA": "US", "CRYPTOCURRENCY": "CRYPTO"}
        return aliases.get(value, value)
    value = symbol.strip().upper()
    prefix = value.split(":", 1)[0] if ":" in value else ""
    if prefix in {"NSE", "BSE", "NYSE", "NASDAQ"}:
        return prefix
    if value.endswith(".NS"):
        return "NSE"
    if value.endswith(".BO"):
        return "BSE"
    return "UNKNOWN"


@dataclass(frozen=True)
class QualitySession:
    market: str
    scope: str
    state: str
    timezone: str | None
    date: str | None
    open: datetime | None
    close: datetime | None
    calendar_source: str
    calendar_coverage: str
    note: str

    def fields(self) -> dict:
        return {
            "market": self.market, "session_scope": self.scope,
            "session_state": self.state, "timezone": self.timezone,
            "session_date": self.date,
            "session_open": self.open.isoformat() if self.open else None,
            "session_close": self.close.isoformat() if self.close else None,
            "calendar_source": self.calendar_source,
            "calendar_coverage": self.calendar_coverage, "calendar_note": self.note,
        }

    def elapsed_minutes(self, now: datetime) -> int | None:
        if self.state == "unknown":
            return None
        if self.open is None or self.close is None:
            return 0
        elapsed = (min(now, self.close) - self.open).total_seconds()
        return max(0, int(elapsed // 60))


def session_for(symbol: str, now: datetime, market: str | None = None, scope: str = "regular") -> QualitySession:
    now = now.replace(tzinfo=timezone.utc) if now.tzinfo is None else now.astimezone(timezone.utc)
    venue = resolve_market(symbol, market)
    if venue == "CRYPTO":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return QualitySession(venue, "continuous", "open", "UTC", start.date().isoformat(),
                              start, start + timedelta(days=1), "continuous_24x7", "not_applicable",
                              "Continuous trading assumption; venue maintenance is not modeled.")
    exchange = "NYSE" if venue == "US" else venue
    supported = exchange in {"NYSE", "NASDAQ", "NSE", "BSE"}
    if not supported:
        return QualitySession(venue, scope, "unknown", None, None, None, None, "unavailable", "unsupported",
                              "Explicit supported cash-equity market or crypto metadata is required; bare tickers are ambiguous.")
    config = market_calendar.SESSIONS[exchange]
    local = now.astimezone(config.tz)
    holidays = market_calendar._get_holidays(exchange)
    years = sorted({d.year for d in holidays})
    coverage = "bundled_years:" + ",".join(map(str, years))
    note = "Bundled holiday entries, not a live exchange calendar; exceptional sessions and unscheduled closures are not modeled."
    if exchange in {"NSE", "BSE"}:
        note += " Cash equities only; special/Muhurat sessions and equity derivatives are excluded."
    else:
        note += " US cash equities; regular 09:30–16:00 or explicit consolidated extended 04:00–20:00 assumption."
    unknown = local.year not in years or scope not in {"regular", "extended"} or (scope == "extended" and exchange in {"NSE", "BSE"})
    if unknown:
        return QualitySession(venue, scope, "unknown", str(config.tz), local.date().isoformat(), None, None,
                              "data/holidays.json", coverage, note + " Requested year/session is outside supported coverage.")
    if local.weekday() >= 5 or local.date() in holidays:
        return QualitySession(venue, scope, "closed", str(config.tz), local.date().isoformat(), None, None,
                              "data/holidays.json", coverage, note)
    early = exchange in {"NYSE", "NASDAQ"} and local.date().isoformat() in _US_EARLY_CLOSES
    opening = config.open_time if scope == "regular" else time(4)
    closing = (time(13) if early else config.close_time) if scope == "regular" else (time(17) if early else time(20))
    start = datetime.combine(local.date(), opening, config.tz).astimezone(timezone.utc)
    end = datetime.combine(local.date(), closing, config.tz).astimezone(timezone.utc)
    if early:
        note += " 2026 early close: regular 13:00 ET; consolidated extended assumption ends 17:00 ET."
    source = "data/holidays.json"
    if exchange in {"NYSE", "NASDAQ"}:
        source += " + NYSE/Nasdaq 2026 early closes"
    return QualitySession(venue, scope, "open" if start <= now < end else "closed", str(config.tz),
                          local.date().isoformat(), start, end,
                          source, coverage, note)
