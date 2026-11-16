"""Publication-time guards, independent of fiscal periods and ingestion time."""

from __future__ import annotations

import re
from datetime import date, datetime, time, timezone
from typing import Any
from zoneinfo import ZoneInfo


def cutoff_utc(value: date | str) -> datetime:
    """A YYYY-MM-DD cutoff includes that entire UTC date, strictly parsed."""
    if isinstance(value, datetime):
        value = value.date()
    if isinstance(value, date):
        day = value
    elif isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        day = date.fromisoformat(value)
    else:
        raise ValueError("as_of must use ISO YYYY-MM-DD (inclusive end of UTC date)")
    return datetime.combine(day, time.max, tzinfo=timezone.utc)


def publication_time(chunk: dict[str, Any], *, verified: bool = False) -> datetime | None:
    """Read only filed_at, whose trusted ingestors populate publication metadata.

    Date-only source filings are conservatively available at the END of their
    source-local publication date. Thus an SEC filing date can become eligible
    on the following UTC day; no intraday publication time is fabricated.
    """
    if any(chunk.get(flag) for flag in ("filed_at_estimated", "release_date_estimated", "availability_estimated")):
        return None
    source = str(chunk.get("source") or "").lower()
    source_zones = {"sec": "America/New_York", "nse": "Asia/Kolkata"}
    if verified and source not in source_zones:
        return None
    value = chunk.get("filed_at")
    if value is None or not str(value).strip():
        return None
    text = str(value).strip()
    try:
        zone = ZoneInfo(source_zones[source]) if source in source_zones else timezone.utc
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
            return datetime.combine(date.fromisoformat(text), time.max, tzinfo=zone).astimezone(timezone.utc)
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            if source != "nse":
                return None
            parsed = datetime.strptime(text, "%d-%b-%Y %H:%M:%S")
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=zone)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return None
