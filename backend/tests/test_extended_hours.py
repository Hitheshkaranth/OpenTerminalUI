
import pytest
from datetime import datetime
from zoneinfo import ZoneInfo
from backend.services.extended_hours_service import ExtendedHoursService

@pytest.mark.asyncio
async def test_tag_session_us():
    service = ExtendedHoursService()

    # 8:00 AM ET - Pre-market
    dt = datetime(2026, 2, 24, 8, 0, tzinfo=ZoneInfo("America/New_York"))
    bar = {"time": int(dt.timestamp())}
    tagged = service._tag_session(bar, "US")
    assert tagged["session"] == "pre"
    assert tagged["isExtended"] is True

    # 10:00 AM ET - Regular
    dt = datetime(2026, 2, 24, 10, 0, tzinfo=ZoneInfo("America/New_York"))
    bar = {"time": int(dt.timestamp())}
    tagged = service._tag_session(bar, "US")
    assert tagged["session"] == "rth"
    assert tagged["isExtended"] is False

    # 6:00 PM ET - After-hours
    dt = datetime(2026, 2, 24, 18, 0, tzinfo=ZoneInfo("America/New_York"))
    bar = {"time": int(dt.timestamp())}
    tagged = service._tag_session(bar, "US")
    assert tagged["session"] == "post"
    assert tagged["isExtended"] is True

@pytest.mark.asyncio
async def test_tag_session_india():
    service = ExtendedHoursService()

    # 9:05 AM IST - Pre-open
    dt = datetime(2026, 2, 24, 9, 5, tzinfo=ZoneInfo("Asia/Kolkata"))
    bar = {"time": int(dt.timestamp())}
    tagged = service._tag_session(bar, "IN")
    assert tagged["session"] == "pre_open"
    assert tagged["isExtended"] is True

    # 10:00 AM IST - Regular
    dt = datetime(2026, 2, 24, 10, 0, tzinfo=ZoneInfo("Asia/Kolkata"))
    bar = {"time": int(dt.timestamp())}
    tagged = service._tag_session(bar, "IN")
    assert tagged["session"] == "rth"
    assert tagged["isExtended"] is False
