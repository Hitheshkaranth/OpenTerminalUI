from __future__ import annotations

import asyncio
import json
from datetime import date, datetime, timedelta
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel

from backend.api.deps import get_db, get_unified_fetcher
from backend.db.models import NewsArticle
from backend.shared.cache import cache


class EventType(str, Enum):
    DIVIDEND = "dividend"
    BONUS = "bonus"
    SPLIT = "split"
    RIGHTS = "rights"
    AGM = "agm"
    EGM = "egm"
    BOARD_MEETING = "board_meeting"
    BUYBACK = "buyback"
    DELISTING = "delisting"
    IPO = "ipo"
    MERGER = "merger"
    EARNINGS = "earnings"
    INSIDER_TRADE = "insider_trade"
    BLOCK_DEAL = "block_deal"
    BULK_DEAL = "bulk_deal"
    CREDIT_RATING = "credit_rating"


class CorporateEvent(BaseModel):
    symbol: str
    event_type: EventType
    title: str
    description: str
    event_date: date
    ex_date: Optional[date] = None
    record_date: Optional[date] = None
    payment_date: Optional[date] = None
    value: Optional[str] = None
    source: str
    impact: str = "neutral"
    url: Optional[str] = None


def _parse_date(raw: Any) -> Optional[date]:
    if raw is None:
        return None
    if isinstance(raw, date) and not isinstance(raw, datetime):
        return raw
    if isinstance(raw, datetime):
        return raw.date()
    text = str(raw).strip()
    if not text:
        return None
    for fmt in (
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%Y/%m/%d",
        "%Y-%m-%d %H:%M:%S",
        "%d-%b-%Y",
        "%b %d, %Y",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
    ):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except Exception:
        return None


def _infer_event_type(text: str) -> EventType:
    low = text.lower()
    if "dividend" in low:
        return EventType.DIVIDEND
    if "bonus" in low:
        return EventType.BONUS
    if "split" in low:
        return EventType.SPLIT
    if "right" in low:
        return EventType.RIGHTS
    if "agm" in low:
        return EventType.AGM
    if "egm" in low:
        return EventType.EGM
    if "board" in low or "meeting" in low:
        return EventType.BOARD_MEETING
    if "buyback" in low:
        return EventType.BUYBACK
    if "delist" in low:
        return EventType.DELISTING
    if "ipo" in low:
        return EventType.IPO
    if "merger" in low or "amalgamation" in low:
        return EventType.MERGER
    if "earnings" in low or "result" in low or "quarter" in low:
        return EventType.EARNINGS
    if "insider" in low:
        return EventType.INSIDER_TRADE
    if "bulk" in low:
        return EventType.BULK_DEAL
    if "block" in low:
        return EventType.BLOCK_DEAL
    if "rating" in low:
        return EventType.CREDIT_RATING
    return EventType.BOARD_MEETING


def _impact_for(event_type: EventType) -> str:
    if event_type in (EventType.DIVIDEND, EventType.BONUS, EventType.BUYBACK, EventType.MERGER):
        return "positive"
    if event_type in (EventType.DELISTING,):
        return "negative"
    return "neutral"


class CorporateActionsService:
    CACHE_TTL_SECONDS = 6 * 60 * 60

    async def _fetch_nse_events(self, symbol: str) -> list[CorporateEvent]:
        fetcher = await get_unified_fetcher()
        payload = await fetcher.nse._request(
            "/corporates-corporateActions",
            {"index": "equities", "symbol": symbol.upper()},
        )
        rows = payload if isinstance(payload, list) else []
        events: list[CorporateEvent] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            title = str(
                row.get("subject")
                or row.get("purpose")
                or row.get("description")
                or row.get("corporateAction")
                or "Corporate action"
            ).strip()
            event_type = _infer_event_type(title)
            event_date = _parse_date(
                row.get("exDate")
                or row.get("date")
                or row.get("recordDate")
                or row.get("boardMeetingDate")
            )
            if not event_date:
                continue
            ex_date = _parse_date(row.get("exDate"))
            record_date = _parse_date(row.get("recordDate"))
            payment_date = _parse_date(row.get("paymentDate"))
            value = row.get("remarks") or row.get("dividend") or row.get("ratio")
            events.append(
                CorporateEvent(
                    symbol=symbol.upper(),
                    event_type=event_type,
                    title=title,
                    description=str(row.get("details") or row.get("remarks") or title),
                    event_date=event_date,
                    ex_date=ex_date,
                    record_date=record_date,
                    payment_date=payment_date,
                    value=str(value).strip() if value else None,
                    source="nse",
                    impact=_impact_for(event_type),
                    url=str(row.get("attchmntFile") or "").strip() or None,
                )
            )
        return events

    async def _fetch_fmp_dividends_splits(self, symbol: str) -> list[CorporateEvent]:
        fetcher = await get_unified_fetcher()
        dividends = await fetcher.fmp._get(f"/historical-price-full/stock_dividend/{fetcher.fmp._symbol(symbol)}")
        splits = await fetcher.fmp._get(f"/historical-price-full/stock_split/{fetcher.fmp._symbol(symbol)}")

        events: list[CorporateEvent] = []
        for row in (dividends or {}).get("historical", []) if isinstance(dividends, dict) else []:
            if not isinstance(row, dict):
                continue
            event_date = _parse_date(row.get("date"))
            if not event_date:
                continue
            amount = row.get("adjDividend") or row.get("dividend")
            value = None
            if amount is not None:
                value = f"{amount} per share"
            events.append(
                CorporateEvent(
                    symbol=symbol.upper(),
                    event_type=EventType.DIVIDEND,
                    title="Dividend",
                    description="Dividend announced/paid",
                    event_date=event_date,
                    ex_date=event_date,
                    value=value,
                    source="fmp",
                    impact="positive",
                )
            )

        for row in (splits or {}).get("historical", []) if isinstance(splits, dict) else []:
            if not isinstance(row, dict):
                continue
            event_date = _parse_date(row.get("date"))
            if not event_date:
                continue
            ratio = row.get("numerator") and row.get("denominator")
            value = f"{row.get('numerator')}:{row.get('denominator')} split" if ratio else str(row.get("label") or "Split")
            events.append(
                CorporateEvent(
                    symbol=symbol.upper(),
                    event_type=EventType.SPLIT,
                    title="Stock Split",
                    description="Stock split event",
                    event_date=event_date,
                    ex_date=event_date,
                    value=value,
                    source="fmp",
                    impact="neutral",
                )
            )

        return events

    async def _fetch_fmp_ipo(self, symbol: str) -> list[CorporateEvent]:
        fetcher = await get_unified_fetcher()
        payload = await fetcher.fmp._get("/ipo_calendar")
        rows = payload if isinstance(payload, list) else []
        out: list[CorporateEvent] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            ticker = str(row.get("symbol") or "").upper().replace(".NS", "")
            if ticker != symbol.upper():
                continue
            event_date = _parse_date(row.get("date") or row.get("ipoDate"))
            if not event_date:
                continue
            out.append(
                CorporateEvent(
                    symbol=symbol.upper(),
                    event_type=EventType.IPO,
                    title="IPO",
                    description=str(row.get("company") or "IPO listing"),
                    event_date=event_date,
                    value=str(row.get("priceRange") or "").strip() or None,
                    source="fmp",
                    impact="neutral",
                )
            )
        return out

    async def _fetch_news_mentions(self, symbol: str) -> list[CorporateEvent]:
        keywords: list[tuple[str, EventType]] = [
            ("board meeting", EventType.BOARD_MEETING),
            ("agm", EventType.AGM),
            ("egm", EventType.EGM),
            ("earnings", EventType.EARNINGS),
            ("quarterly", EventType.EARNINGS),
            ("buyback", EventType.BUYBACK),
            ("insider", EventType.INSIDER_TRADE),
            ("block deal", EventType.BLOCK_DEAL),
            ("bulk deal", EventType.BULK_DEAL),
            ("rating", EventType.CREDIT_RATING),
        ]

        def _query_news() -> list[NewsArticle]:
            db_gen = get_db()
            db = next(db_gen)
            try:
                rows = (
                    db.query(NewsArticle)
                    .filter(NewsArticle.tickers.like(f"%{symbol.upper()}%"))
                    .order_by(NewsArticle.published_at.desc())
                    .limit(120)
                    .all()
                )
                return rows
            finally:
                db.close()

        rows = await asyncio.to_thread(_query_news)
        out: list[CorporateEvent] = []
        for row in rows:
            txt = f"{row.title or ''} {row.summary or ''}".lower()
            for keyword, evt_type in keywords:
                if keyword not in txt:
                    continue
                event_date = _parse_date(row.published_at)
                if not event_date:
                    continue
                out.append(
                    CorporateEvent(
                        symbol=symbol.upper(),
                        event_type=evt_type,
                        title=row.title or keyword.title(),
                        description=row.summary or row.title or keyword,
                        event_date=event_date,
                        source="finnhub",
                        impact=_impact_for(evt_type),
                        url=row.url,
                    )
                )
                break
        return out

    async def _fetch_bse_announcements(self, symbol: str) -> list[CorporateEvent]:
        # BSE scraper scaffold not implemented in this codebase yet.
        return []

    @staticmethod
    def _dedupe_events(events: list[CorporateEvent]) -> list[CorporateEvent]:
        seen: set[str] = set()
        out: list[CorporateEvent] = []
        for evt in sorted(events, key=lambda x: (x.event_date, x.event_type.value, x.title), reverse=True):
            marker = json.dumps(
                {
                    "type": evt.event_type.value,
                    "date": evt.event_date.isoformat(),
                    "title": evt.title.lower().strip(),
                    "value": (evt.value or "").lower().strip(),
                },
                sort_keys=True,
            )
            if marker in seen:
                continue
            seen.add(marker)
            out.append(evt)
        return out

    async def get_events(
        self,
        symbol: str,
        event_types: Optional[list[EventType]] = None,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        include_upcoming: bool = True,
    ) -> list[CorporateEvent]:
        clean = symbol.strip().upper()
        cache_key = cache.build_key(
            "corporate_events",
            clean,
            {
                "types": [x.value for x in (event_types or [])],
                "from": from_date.isoformat() if from_date else None,
                "to": to_date.isoformat() if to_date else None,
                "upcoming": include_upcoming,
            },
        )
        cached = await cache.get(cache_key)
        if isinstance(cached, list):
            return [CorporateEvent(**x) if isinstance(x, dict) else x for x in cached]

        gathered = await asyncio.gather(
            self._fetch_nse_events(clean),
            self._fetch_fmp_dividends_splits(clean),
            self._fetch_fmp_ipo(clean),
            self._fetch_news_mentions(clean),
            self._fetch_bse_announcements(clean),
            return_exceptions=True,
        )

        events: list[CorporateEvent] = []
        for batch in gathered:
            if isinstance(batch, Exception):
                continue
            events.extend(batch)

        events = self._dedupe_events(events)

        today = date.today()
        filtered: list[CorporateEvent] = []
        for evt in events:
            if event_types and evt.event_type not in event_types:
                continue
            if from_date and evt.event_date < from_date:
                continue
            if to_date and evt.event_date > to_date:
                continue
            if not include_upcoming and evt.event_date > today:
                continue
            filtered.append(evt)

        filtered.sort(key=lambda x: x.event_date, reverse=True)
        await cache.set(cache_key, [x.model_dump() for x in filtered], ttl=self.CACHE_TTL_SECONDS)
        return filtered

    async def get_upcoming_events(self, symbol: str, days_ahead: int = 90) -> list[CorporateEvent]:
        today = date.today()
        end = today + timedelta(days=max(1, days_ahead))
        events = await self.get_events(symbol=symbol, from_date=today, to_date=end, include_upcoming=True)
        return [x for x in events if x.event_date >= today]

    async def get_portfolio_events(self, symbols: list[str], days_ahead: int = 30) -> list[CorporateEvent]:
        sem = asyncio.Semaphore(5)

        async def _one(sym: str) -> list[CorporateEvent]:
            async with sem:
                return await self.get_upcoming_events(sym, days_ahead=days_ahead)

        tasks = [_one(sym.strip().upper()) for sym in symbols if sym and sym.strip()]
        rows = await asyncio.gather(*tasks, return_exceptions=True)
        merged: list[CorporateEvent] = []
        for row in rows:
            if isinstance(row, Exception):
                continue
            merged.extend(row)
        merged = self._dedupe_events(merged)
        merged.sort(key=lambda x: x.event_date)
        return merged

    async def get_dividend_history(self, symbol: str) -> list[CorporateEvent]:
        events = await self.get_events(symbol=symbol, event_types=[EventType.DIVIDEND], include_upcoming=True)
        return [x for x in events if x.event_type == EventType.DIVIDEND]


corporate_actions_service = CorporateActionsService()
