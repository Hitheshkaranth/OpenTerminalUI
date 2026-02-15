from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

import pytest
import requests

from backend.core.nse_results_calendar import NSEResultsCalendar, infer_quarter


@dataclass
class _FakeResponse:
    status_code: int = 200
    payload: Any = None
    raise_json_error: bool = False

    def json(self) -> Any:
        if self.raise_json_error:
            raise ValueError("bad json")
        return self.payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"status={self.status_code}")


class _FakeSession:
    def __init__(self, routes: dict[str, list[_FakeResponse]]) -> None:
        self.routes = routes
        self.headers: dict[str, str] = {}
        self.calls: list[str] = []

    def get(self, url: str, params: dict[str, Any] | None = None, timeout: int | float = 0) -> _FakeResponse:
        self.calls.append(url)
        for key in sorted(self.routes.keys(), key=len, reverse=True):
            responses = self.routes[key]
            if key in url:
                if responses:
                    return responses.pop(0)
                return _FakeResponse(status_code=200, payload=[])
        return _FakeResponse(status_code=200, payload=[])


def test_session_init_and_cookie_handling(monkeypatch: pytest.MonkeyPatch) -> None:
    routes = {
        "nseindia.com": [_FakeResponse(payload={})],
        "corporate-board-meetings": [
            _FakeResponse(
                payload=[
                    {
                        "bm_date": "2025-04-15",
                        "bm_purpose": "Board meeting to consider quarterly financial results",
                    }
                ]
            )
        ],
        "corporate-announcements": [_FakeResponse(payload=[])],
    }
    sessions: list[_FakeSession] = []

    def _factory() -> _FakeSession:
        session = _FakeSession(routes=routes)
        sessions.append(session)
        return session

    monkeypatch.setattr("backend.core.nse_results_calendar.requests.Session", _factory)
    monkeypatch.setattr("backend.core.nse_results_calendar.time.sleep", lambda _: None)

    cal = NSEResultsCalendar()
    rows = cal.get_result_dates("RELIANCE", force_refresh=True)

    assert rows
    assert sessions, "expected session factory to be used"
    calls = sessions[-1].calls
    assert any("nseindia.com" in url and "/api/" not in url for url in calls)
    assert any("corporate-board-meetings" in url for url in calls)


def test_parse_board_meetings_json(monkeypatch: pytest.MonkeyPatch) -> None:
    cal = NSEResultsCalendar()
    monkeypatch.setattr(
        cal,
        "_nse_get_json",
        lambda *_args, **_kwargs: [
            {"bm_date": "15-04-2025", "bm_purpose": "Quarterly financial results"},
            {"bm_date": "16-04-2025", "bm_purpose": "Issue of bonus shares"},
            {"bm_date": "17-04-2025", "bm_desc": "Unaudited Financial Result"},
        ],
    )
    rows = cal._fetch_board_meetings_nse("TCS")
    assert len(rows) == 2
    assert all(row["source"] == "NSE" for row in rows)
    assert rows[0]["symbol"] == "TCS"


@pytest.mark.parametrize(
    ("d", "expected"),
    [
        (date(2025, 7, 15), "Q1 FY26"),
        (date(2025, 10, 20), "Q2 FY26"),
        (date(2026, 1, 10), "Q3 FY2526"),
        (date(2026, 4, 22), "Q4 FY2526"),
        (date(2026, 6, 1), "Unknown"),
    ],
)
def test_infer_quarter(d: date, expected: str) -> None:
    assert infer_quarter(d) == expected


def test_cache_hit_miss_expiry_force_refresh(monkeypatch: pytest.MonkeyPatch) -> None:
    cal = NSEResultsCalendar()
    calls = {"nse": 0}
    now = {"t": 1000.0}

    monkeypatch.setattr("backend.core.nse_results_calendar.time.time", lambda: now["t"])
    monkeypatch.setattr(cal, "_init_nse_session", lambda: None)
    monkeypatch.setattr(cal, "_fetch_announcements_nse", lambda _s: [])
    monkeypatch.setattr(cal, "_fetch_from_bse", lambda _s: [])

    def _nse_rows(_symbol: str) -> list[dict[str, Any]]:
        calls["nse"] += 1
        return [
            {
                "symbol": "INFY",
                "date": "2025-04-15",
                "day": "Tuesday",
                "purpose": "Quarterly financial results",
                "quarter": "Q4 FY2526",
                "type": "past",
                "source": "NSE",
                "attachment_url": None,
            }
        ]

    monkeypatch.setattr(cal, "_fetch_board_meetings_nse", _nse_rows)

    cal.get_result_dates("INFY")
    assert calls["nse"] == 1

    cal.get_result_dates("INFY")
    assert calls["nse"] == 1, "second call should use cache"

    now["t"] += 7 * 60 * 60
    cal.get_result_dates("INFY")
    assert calls["nse"] == 2, "expired cache should refresh"

    cal.get_result_dates("INFY", force_refresh=True)
    assert calls["nse"] == 3, "force refresh should bypass cache"


def test_fallback_from_nse_to_bse(monkeypatch: pytest.MonkeyPatch) -> None:
    cal = NSEResultsCalendar()
    monkeypatch.setattr(cal, "_init_nse_session", lambda: None)
    monkeypatch.setattr(cal, "_fetch_board_meetings_nse", lambda _s: [])
    monkeypatch.setattr(cal, "_fetch_announcements_nse", lambda _s: [])
    monkeypatch.setattr(
        cal,
        "_fetch_from_bse",
        lambda _s: [
            {
                "symbol": "SBIN",
                "date": "2025-04-30",
                "day": "Wednesday",
                "purpose": "Board Meeting - Financial result",
                "quarter": "Q4 FY2526",
                "type": "past",
                "source": "BSE",
                "attachment_url": None,
            }
        ],
    )

    rows = cal.get_result_dates("SBIN", force_refresh=True)
    assert len(rows) == 1
    assert rows[0]["source"] == "BSE"


def test_error_scenarios(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("backend.core.nse_results_calendar.time.sleep", lambda _: None)

    # Connection error followed by success.
    cal1 = NSEResultsCalendar()
    init_calls = {"n": 0}
    monkeypatch.setattr(cal1, "_rate_limit_nse", lambda: None)
    monkeypatch.setattr(cal1, "_init_nse_session", lambda: init_calls.__setitem__("n", init_calls["n"] + 1))

    attempts = {"n": 0}

    def _conn_then_ok(*_args: Any, **_kwargs: Any) -> _FakeResponse:
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise requests.exceptions.ConnectionError("net")
        return _FakeResponse(payload={"ok": True})

    cal1._session.get = _conn_then_ok  # type: ignore[assignment]
    payload = cal1._nse_get_json("https://www.nseindia.com/api/corporate-board-meetings")
    assert payload == {"ok": True}
    assert init_calls["n"] >= 1

    # 403 followed by success should re-init and retry.
    cal2 = NSEResultsCalendar()
    monkeypatch.setattr(cal2, "_rate_limit_nse", lambda: None)
    reinit_calls = {"n": 0}
    monkeypatch.setattr(cal2, "_init_nse_session", lambda: reinit_calls.__setitem__("n", reinit_calls["n"] + 1))

    seq = [_FakeResponse(status_code=403, payload={}), _FakeResponse(status_code=200, payload={"x": 1})]
    cal2._session.get = lambda *_a, **_k: seq.pop(0)  # type: ignore[assignment]
    payload2 = cal2._nse_get_json("https://www.nseindia.com/api/corporate-announcements")
    assert payload2 == {"x": 1}
    assert reinit_calls["n"] >= 1

    # Malformed JSON should return None gracefully.
    cal3 = NSEResultsCalendar()
    monkeypatch.setattr(cal3, "_rate_limit_nse", lambda: None)
    cal3._session.get = lambda *_a, **_k: _FakeResponse(payload=None, raise_json_error=True)  # type: ignore[assignment]
    assert cal3._nse_get_json("https://www.nseindia.com/api/corporate-announcements") is None

    # Empty NSE + empty BSE should return empty list, not crash.
    cal4 = NSEResultsCalendar()
    monkeypatch.setattr(cal4, "_init_nse_session", lambda: None)
    monkeypatch.setattr(cal4, "_fetch_board_meetings_nse", lambda _s: [])
    monkeypatch.setattr(cal4, "_fetch_announcements_nse", lambda _s: [])
    monkeypatch.setattr(cal4, "_fetch_from_bse", lambda _s: [])
    assert cal4.get_result_dates("WIPRO", force_refresh=True) == []
