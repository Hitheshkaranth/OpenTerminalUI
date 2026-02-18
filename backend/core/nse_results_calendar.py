from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

import requests

logger = logging.getLogger(__name__)


_HOME_URL = "https://www.nseindia.com"
_NSE_BOARD_MEETINGS_URL = "https://www.nseindia.com/api/corporate-board-meetings"
_NSE_ANNOUNCEMENTS_URL = "https://www.nseindia.com/api/corporate-announcements"
_BSE_SCRIP_LIST_URL = "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w"
_BSE_CORP_ACTION_URL = "https://api.bseindia.com/BseIndiaAPI/api/CorporateAction/w"

_RESULT_KEYWORDS = (
    "financial result",
    "quarterly",
    "un-audited",
    "unaudited",
    "audited financial",
)


@dataclass
class _CacheEntry:
    created_at: float
    rows: list[dict[str, Any]]


def _parse_date(value: Any) -> date | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None

    # Normalization for common NSE/BSE date representations.
    text = raw.replace("T", " ").replace("Z", "").strip()
    if " " in text:
        text = text.split(" ", 1)[0]

    formats = (
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%d-%b-%Y",
        "%d-%B-%Y",
        "%Y/%m/%d",
    )
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue

    # Graceful fallback for loose ISO-like values.
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        return None


def infer_quarter(meeting_date: date) -> str:
    month = meeting_date.month
    year = meeting_date.year
    if month in (7, 8):
        return f"Q1 FY{str(year + 1)[-2:]}"
    if month in (10, 11):
        return f"Q2 FY{str(year + 1)[-2:]}"
    if month in (1, 2):
        fy = year - 1
        return f"Q3 FY{str(fy)[-2:]}{str(fy + 1)[-2:]}"
    if month in (4, 5):
        fy = year - 1
        return f"Q4 FY{str(fy)[-2:]}{str(fy + 1)[-2:]}"
    return "Unknown"


def format_results_table(rows: list[dict[str, Any]]) -> str:
    header = "Symbol      | Date       | Day       | Quarter    | Status   | Purpose"
    sep = "------------|------------|-----------|------------|----------|--------------------------------"
    lines = [header, sep]
    for row in rows:
        symbol = str(row.get("symbol", "-"))[:10].ljust(10)
        dt = str(row.get("date", "-"))[:10].ljust(10)
        day = str(row.get("day", "-"))[:9].ljust(9)
        quarter = str(row.get("quarter", "-"))[:10].ljust(10)
        status = str(row.get("type", "-")).capitalize()[:8].ljust(8)
        purpose = str(row.get("purpose", "-"))
        lines.append(f"{symbol} | {dt} | {day} | {quarter} | {status} | {purpose}")
    return "\n".join(lines)


class NSEResultsCalendar:
    HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.nseindia.com/",
        "Connection": "keep-alive",
    }

    def __init__(self) -> None:
        self._session = self._new_session()
        self._cache: dict[str, _CacheEntry] = {}
        self._cache_ttl_seconds = 6 * 60 * 60
        self._min_nse_call_gap_seconds = 1.0
        self._last_nse_call_at = 0.0

    def _new_session(self) -> requests.Session:
        session = requests.Session()
        session.headers.update(self.HEADERS)
        return session

    def _init_nse_session(self) -> None:
        self._session = self._new_session()
        self._session.get(_HOME_URL, timeout=15)

    def _rate_limit_nse(self) -> None:
        elapsed = time.time() - self._last_nse_call_at
        if elapsed < self._min_nse_call_gap_seconds:
            time.sleep(self._min_nse_call_gap_seconds - elapsed)
        self._last_nse_call_at = time.time()

    def _nse_get_json(self, url: str, params: dict[str, Any] | None = None) -> Any:
        backoff = 1.0
        for attempt in range(1, 4):
            try:
                self._rate_limit_nse()
                resp = self._session.get(url, params=params, timeout=20)
                if resp.status_code in (401, 403):
                    logger.warning("NSE auth/cookie failure status=%s url=%s attempt=%s", resp.status_code, url, attempt)
                    self._init_nse_session()
                    time.sleep(backoff)
                    backoff *= 2
                    continue
                resp.raise_for_status()
                return resp.json()
            except requests.exceptions.ConnectionError:
                logger.warning("NSE connection error url=%s attempt=%s", url, attempt)
                self._init_nse_session()
                time.sleep(backoff)
                backoff *= 2
            except ValueError:
                logger.warning("NSE malformed JSON url=%s attempt=%s", url, attempt)
                if attempt == 3:
                    return None
                time.sleep(backoff)
                backoff *= 2
            except requests.RequestException as exc:
                logger.warning("NSE request failed url=%s attempt=%s error=%s", url, attempt, exc)
                if attempt == 3:
                    return None
                time.sleep(backoff)
                backoff *= 2
        return None

    @staticmethod
    def _extract_list(payload: Any) -> list[dict[str, Any]]:
        if isinstance(payload, list):
            return [row for row in payload if isinstance(row, dict)]
        if isinstance(payload, dict):
            for key in ("data", "records", "rows", "result", "table"):
                val = payload.get(key)
                if isinstance(val, list):
                    return [row for row in val if isinstance(row, dict)]
            # Some NSE payloads may already be a single record dict.
            return [payload]
        return []

    @staticmethod
    def _is_financial_results_purpose(text: str) -> bool:
        norm = text.lower()
        return any(keyword in norm for keyword in _RESULT_KEYWORDS)

    def _to_result_row(
        self,
        *,
        symbol: str,
        dt: date,
        purpose: str,
        source: str,
        attachment_url: str | None,
    ) -> dict[str, Any]:
        today = date.today()
        return {
            "symbol": symbol,
            "date": dt.isoformat(),
            "day": dt.strftime("%A"),
            "purpose": purpose,
            "quarter": infer_quarter(dt),
            "type": "upcoming" if dt >= today else "past",
            "source": source,
            "attachment_url": attachment_url,
        }

    def _fetch_board_meetings_nse(self, symbol: str) -> list[dict[str, Any]]:
        payload = self._nse_get_json(
            _NSE_BOARD_MEETINGS_URL,
            params={"index": "equities", "symbol": symbol},
        )
        rows = self._extract_list(payload)
        out: list[dict[str, Any]] = []
        for row in rows:
            purpose = str(row.get("bm_purpose") or row.get("bm_desc") or "").strip()
            if not purpose or not self._is_financial_results_purpose(purpose):
                continue
            dt = _parse_date(row.get("bm_date"))
            if not dt:
                continue
            attachment = row.get("attachment")
            out.append(
                self._to_result_row(
                    symbol=symbol,
                    dt=dt,
                    purpose=purpose,
                    source="NSE",
                    attachment_url=str(attachment).strip() if attachment else None,
                )
            )
        return out

    def _fetch_announcements_nse(self, symbol: str) -> list[dict[str, Any]]:
        payload = self._nse_get_json(
            _NSE_ANNOUNCEMENTS_URL,
            params={
                "index": "equities",
                "symbol": symbol,
                "issuer": "",
                "subject": "financial results",
            },
        )
        rows = self._extract_list(payload)
        out: list[dict[str, Any]] = []
        for row in rows:
            subject = str(row.get("subject") or row.get("desc") or "Financial Results").strip()
            dt = _parse_date(row.get("an_dt"))
            if not dt:
                continue
            att = row.get("attchmntFile")
            out.append(
                self._to_result_row(
                    symbol=symbol,
                    dt=dt,
                    purpose=subject,
                    source="NSE",
                    attachment_url=str(att).strip() if att else None,
                )
            )
        return out

    def _resolve_bse_scrip_code(self, symbol: str) -> str | None:
        try:
            resp = requests.get(
                _BSE_SCRIP_LIST_URL,
                params={
                    "Group": "",
                    "Scripcode": "",
                    "industry": "",
                    "segment": "Equity",
                    "status": "Active",
                },
                timeout=30,
            )
            resp.raise_for_status()
            payload = resp.json()
        except Exception as exc:
            logger.warning("BSE scrip list lookup failed symbol=%s error=%s", symbol, exc)
            return None

        rows = self._extract_list(payload)
        target = symbol.upper().strip()
        for row in rows:
            row_symbol = str(
                row.get("SecurityId")
                or row.get("securityid")
                or row.get("symbol")
                or row.get("Symbol")
                or ""
            ).upper()
            if row_symbol != target:
                continue
            code = row.get("ScripCode") or row.get("scripcode") or row.get("scripCode")
            if code:
                return str(code)
        return None

    def _fetch_from_bse(self, symbol: str) -> list[dict[str, Any]]:
        scrip_code = self._resolve_bse_scrip_code(symbol)
        if not scrip_code:
            return []

        today = date.today()
        from_date = date(today.year - 5, 1, 1).strftime("%Y-%m-%d")
        to_date = today.strftime("%Y-%m-%d")

        try:
            resp = requests.get(
                _BSE_CORP_ACTION_URL,
                params={
                    "scripcode": scrip_code,
                    "index": "0",
                    "from": from_date,
                    "to": to_date,
                    "category": "Board Meeting",
                    "subcategory": "",
                },
                timeout=30,
            )
            resp.raise_for_status()
            payload = resp.json()
        except Exception as exc:
            logger.warning("BSE corporate action failed symbol=%s scrip=%s error=%s", symbol, scrip_code, exc)
            return []

        rows = self._extract_list(payload)
        out: list[dict[str, Any]] = []
        for row in rows:
            purpose = str(row.get("Purpose") or row.get("purpose") or row.get("Particulars") or "").strip()
            if not purpose or not self._is_financial_results_purpose(purpose):
                continue
            dt = _parse_date(
                row.get("Date")
                or row.get("date")
                or row.get("ExDate")
                or row.get("MeetingDate")
                or row.get("ActionDate")
            )
            if not dt:
                continue
            out.append(
                self._to_result_row(
                    symbol=symbol,
                    dt=dt,
                    purpose=purpose,
                    source="BSE",
                    attachment_url=None,
                )
            )
        return out

    @staticmethod
    def _dedupe_sort(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[tuple[str, str, str]] = set()
        out: list[dict[str, Any]] = []
        for row in rows:
            key = (
                str(row.get("symbol", "")),
                str(row.get("date", "")),
                str(row.get("purpose", "")).lower(),
            )
            if key in seen:
                continue
            seen.add(key)
            out.append(row)
        out.sort(key=lambda r: str(r.get("date", "")), reverse=True)
        return out

    def get_result_dates(
        self,
        symbol: str,
        include_past: bool = True,
        force_refresh: bool = False,
    ) -> list[dict[str, Any]]:
        ticker = symbol.strip().upper()
        if not ticker:
            return []

        cache_entry = self._cache.get(ticker)
        now = time.time()
        if (
            cache_entry
            and not force_refresh
            and (now - cache_entry.created_at) < self._cache_ttl_seconds
        ):
            rows = cache_entry.rows
        else:
            try:
                self._init_nse_session()
            except Exception as exc:
                logger.warning("NSE session initialization failed symbol=%s error=%s", ticker, exc)

            board_rows = self._fetch_board_meetings_nse(ticker)
            announcement_rows = self._fetch_announcements_nse(ticker)
            rows = self._dedupe_sort(board_rows + announcement_rows)
            if not rows:
                rows = self._dedupe_sort(self._fetch_from_bse(ticker))
            self._cache[ticker] = _CacheEntry(created_at=now, rows=rows)

        if include_past:
            return rows
        return [row for row in rows if row.get("type") == "upcoming"]

    def get_upcoming_results(self, symbol: str) -> list[dict[str, Any]]:
        return self.get_result_dates(symbol, include_past=False)

    def get_next_result_date(self, symbol: str) -> dict[str, Any] | None:
        upcoming = self.get_upcoming_results(symbol)
        if not upcoming:
            return None
        # Since list is newest-first, we pick minimum date for "next".
        return min(upcoming, key=lambda row: str(row.get("date", "")))

    def get_bulk_upcoming(self, symbols: list[str]) -> dict[str, list[dict[str, Any]]]:
        result: dict[str, list[dict[str, Any]]] = {}
        for idx, symbol in enumerate(symbols):
            ticker = symbol.strip().upper()
            if not ticker:
                continue
            if idx > 0:
                time.sleep(2.0)
            result[ticker] = self.get_upcoming_results(ticker)
        return result
