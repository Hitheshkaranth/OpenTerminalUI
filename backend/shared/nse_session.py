from __future__ import annotations

import threading
import time
from typing import Any

import requests


class NSESession:
    """Manages HTTP session with NSE India website, handling cookies and rate limits."""

    BASE_URL = "https://www.nseindia.com"
    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.nseindia.com/",
    }

    def __init__(self) -> None:
        self._session = requests.Session()
        self._session.headers.update(self.HEADERS)
        self._last_request = 0.0
        self._cookie_expiry = 0.0
        self._lock = threading.Lock()

    def _ensure_cookies(self) -> None:
        if time.time() <= self._cookie_expiry:
            return
        self._session.get(self.BASE_URL, timeout=10)
        self._cookie_expiry = time.time() + 300

    def get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        with self._lock:
            self._ensure_cookies()
            elapsed = time.time() - self._last_request
            if elapsed < 0.5:
                time.sleep(0.5 - elapsed)
            resp = self._session.get(f"{self.BASE_URL}{path}", params=params, timeout=15)
            self._last_request = time.time()

        resp.raise_for_status()
        payload = resp.json()
        return payload if isinstance(payload, dict) else {"data": payload}
