from __future__ import annotations

import asyncio
import hashlib
from datetime import date, datetime, timezone
from typing import Any, List, Dict

from fastapi import APIRouter, HTTPException, Query

from backend.api.deps import get_unified_fetcher
from backend.shared.market_calendar import is_market_open

router = APIRouter()
US_MARKETS = {"NASDAQ", "NYSE"}
IN_MARKETS = {"NSE", "BSE"}
SUPPORTED_MARKETS = US_MARKETS | IN_MARKETS


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        out = float(value)
        return out if out == out else None
    if isinstance(value, str):
        cleaned = value.replace(",", "").strip()
        if cleaned in ("", "-", "NA", "N/A", "null", "None"):
            return None
        try:
            out = float(cleaned)
            return out if out == out else None
        except ValueError:
            return None
    return None


def _extract_index_metrics(payload: Dict[str, Any], accepted_names: set[str]) -> tuple[float | None, float | None]:
    candidates: list[dict[str, Any]] = []
    for key in ("data", "indexList", "indices", "results"):
        node = payload.get(key)
        if isinstance(node, list):
            candidates.extend([x for x in node if isinstance(x, dict)])
    if not candidates and payload:
        candidates = [payload]

    for row in candidates:
        name = str(
            row.get("index")
            or row.get("indexName")
            or row.get("name")
            or row.get("symbol")
            or ""
        ).strip().upper()
        if name not in accepted_names:
            continue
        value_out: float | None = None
        pct_out: float | None = None
        for value_key in ("last", "lastPrice", "ltp", "indexValue", "value", "current"):
            parsed = _to_float(row.get(value_key))
            if parsed is not None:
                value_out = parsed
                break
        for pct_key in ("pChange", "percentChange", "changePercent", "netChangePercent"):
            parsed = _to_float(row.get(pct_key))
            if parsed is not None:
                pct_out = parsed
                break
        if value_out is not None or pct_out is not None:
            return value_out, pct_out
    return None, None


def _quarter_end(year: int, quarter: int) -> date:
    if quarter == 1:
        return date(year, 3, 31)
    if quarter == 2:
        return date(year, 6, 30)
    if quarter == 3:
        return date(year, 9, 30)
    return date(year, 12, 31)


def _last_quarter_ends(limit: int) -> list[date]:
    today = date.today()
    quarter = ((today.month - 1) // 3) + 1
    year = today.year
    out: list[date] = []
    while len(out) < limit:
        q_end = _quarter_end(year, quarter)
        if q_end <= today:
            out.append(q_end)
        quarter -= 1
        if quarter == 0:
            quarter = 4
            year -= 1
    return out


def _iso_day(day: date) -> str:
    return datetime(day.year, day.month, day.day, tzinfo=timezone.utc).isoformat()


def _stable_id(market: str, symbol: str, period_end: str, report_type: str) -> str:
    raw = f"{market}|{symbol}|{period_end}|{report_type}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:16]

@router.get("/reports/bulk-deals")
async def bulk_deals() -> Dict[str, Any]:
    fetcher = await get_unified_fetcher()
    try:
        data = await fetcher.nse.get_bulk_deals()
        return data
    except Exception as e:
        return {"error": str(e), "data": []}

@router.get("/reports/block-deals")
async def block_deals() -> Dict[str, Any]:
    fetcher = await get_unified_fetcher()
    try:
        data = await fetcher.nse.get_block_deals()
        return data
    except Exception as e:
        return {"error": str(e), "data": []}

# Last successfully fetched value per ticker key. When a provider call fails we
# serve the last real value flagged as stale instead of fabricating a number.
_LAST_GOOD_TICKERS: dict[str, tuple[float, float | None]] = {}

_YAHOO_TICKER_SYMBOLS: dict[str, str] = {
    "sp500": "^GSPC",
    "nasdaq": "^IXIC",
    "dowjones": "^DJI",
    "ftse100": "^FTSE",
    "dax": "^GDAXI",
    "nikkei225": "^N225",
    "hangseng": "^HSI",
    "usdInr": "USDINR=X",
    "gold": "GC=F",
    "silver": "SI=F",
    "crude": "CL=F",
}


def _exchange_status(exchange: str) -> str:
    try:
        return "OPEN" if is_market_open(exchange) else "CLOSED"
    except Exception:
        return "UNKNOWN"


def _nse_capital_market_open(market_state: list[Any]) -> bool | None:
    """Status of the NSE Capital Market segment from NSE's marketState list, if present."""
    for row in market_state:
        if not isinstance(row, dict):
            continue
        if str(row.get("market") or "").strip().lower() == "capital market":
            return str(row.get("marketStatus") or "").strip().upper() == "OPEN"
    return None


@router.get("/reports/market-status")
async def market_status() -> Dict[str, Any]:
    fetcher = await get_unified_fetcher()

    # Concurrent tasks for speed
    nse_market_task = fetcher.nse.get_market_status()
    nse_indices_task = fetcher.nse.get_index_quote("NIFTY 50")
    yahoo_quotes_task = fetcher.yahoo.get_quotes(
        ["^NSEI", "^BSESN", *_YAHOO_TICKER_SYMBOLS.values(), "INRUSD=X", "BTC-USD", "ETH-USD"]
    )

    results = await asyncio.gather(
        nse_market_task,
        nse_indices_task,
        yahoo_quotes_task,
        return_exceptions=True,
    )

    nse_market_raw = results[0] if not isinstance(results[0], Exception) else {}
    indices_payload = results[1] if not isinstance(results[1], Exception) else {}
    yahoo_quotes = results[2] if not isinstance(results[2], Exception) else []
    if not isinstance(indices_payload, dict):
        indices_payload = {}

    yahoo_map: dict[str, dict[str, Any]] = {}
    for item in yahoo_quotes if isinstance(yahoo_quotes, list) else []:
        if isinstance(item, dict) and item.get("symbol"):
            yahoo_map[str(item["symbol"]).upper()] = item

    def _yahoo(symbol: str) -> tuple[float | None, float | None]:
        q = yahoo_map.get(symbol, {})
        return _to_float(q.get("regularMarketPrice")), _to_float(q.get("regularMarketChangePercent"))

    values: dict[str, tuple[float | None, float | None]] = {}
    nifty = _extract_index_metrics(indices_payload, {"NIFTY 50", "NIFTY50", "NIFTY"})
    sensex = _extract_index_metrics(indices_payload, {"SENSEX", "BSE SENSEX"})
    nse_indices_ok = nifty[0] is not None
    values["nifty50"] = nifty if nifty[0] is not None else _yahoo("^NSEI")
    values["sensex"] = sensex if sensex[0] is not None else _yahoo("^BSESN")
    for key, symbol in _YAHOO_TICKER_SYMBOLS.items():
        values[key] = _yahoo(symbol)

    # Never fabricate prices: a missing value is served as the last real value
    # (flagged stale) or as null (flagged unavailable).
    stale: list[str] = []
    unavailable: list[str] = []
    out: dict[str, Any] = {}
    for key, (price, pct) in values.items():
        if price is not None:
            _LAST_GOOD_TICKERS[key] = (price, pct)
        elif key in _LAST_GOOD_TICKERS:
            price, pct = _LAST_GOOD_TICKERS[key]
            stale.append(key)
        else:
            pct = None
            unavailable.append(key)
        out[key] = price
        out[f"{key}Pct"] = pct

    market_state = nse_market_raw.get("marketState", []) if isinstance(nse_market_raw, dict) else []
    if not isinstance(market_state, list):
        market_state = []

    nse_status = _exchange_status("NSE")
    if nse_status == "OPEN" and _nse_capital_market_open(market_state) is False:
        # Inside regular hours but NSE reports the capital market closed (unlisted holiday/halt).
        nse_status = "CLOSED"

    return {
        "marketState": market_state,
        "nseStatus": nse_status,
        "nyseStatus": _exchange_status("NYSE"),
        **out,
        "stale": stale,
        "unavailable": unavailable,
        "source": {"nseIndices": nse_indices_ok},
        "fallbackEnabled": not nse_indices_ok or bool(stale) or bool(unavailable),
        "ts": datetime.now(timezone.utc).isoformat()
    }

_EVENTS_UNIVERSE = (
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR", "ITC", "SBIN",
    "BHARTIARTL", "KOTAKBANK", "LT", "AXISBANK", "MARUTI", "SUNPHARMA", "TITAN",
)


@router.get("/reports/events")
async def events(days: int = Query(default=30, ge=1, le=120)) -> List[Dict[str, Any]]:
    """Upcoming earnings / dividend / corporate events for large-cap NSE names from the events hub.

    Returns an empty list when the upstream sources are unavailable — never placeholder events.
    """
    from backend.services.events_hub import get_upcoming_events

    try:
        payload = await get_upcoming_events(list(_EVENTS_UNIVERSE), days=days, types={"earnings", "dividend", "corporate"})
    except Exception:
        return []
    return [
        {"date": item["date"], "ticker": item.get("symbol") or "", "event": item.get("title") or item.get("type") or ""}
        for item in (payload.get("items") or [])
        if item.get("date")
    ]


@router.get("/reports/quarterly")
async def quarterly_reports(
    market: str = Query(..., description="NSE|BSE|NASDAQ|NYSE"),
    symbol: str = Query(..., min_length=1, max_length=24),
    limit: int = Query(default=8, ge=1, le=50),
) -> Dict[str, Any]:
    market_code = market.strip().upper()
    ticker = symbol.strip().upper()
    if market_code not in SUPPORTED_MARKETS:
        raise HTTPException(status_code=400, detail=f"Unsupported market: {market_code}")

    # India contract stability path: no provider linked yet.
    if market_code in IN_MARKETS:
        return {"items": []}

    # US stub with SEC links. TODO: replace with direct SEC filings API ingestion.
    quarter_ends = _last_quarter_ends(limit)
    items: list[dict[str, Any]] = []
    for period in quarter_ends:
        report_type = "10-K" if period.month == 12 else "10-Q"
        published = period.replace(day=min(period.day, 28))
        published_day = published if report_type == "10-Q" else date(period.year + 1, 2, 28)
        period_iso = _iso_day(period)
        published_iso = _iso_day(published_day)
        sec_query = f"{ticker} {report_type}"
        sec_search_url = f"https://www.sec.gov/edgar/search/#/q={sec_query.replace(' ', '%20')}"
        items.append(
            {
                "id": _stable_id(market_code, ticker, period_iso, report_type),
                "symbol": ticker,
                "market": market_code,
                "periodEndDate": period_iso,
                "publishedAt": published_iso,
                "reportType": report_type,
                "title": f"{ticker} {report_type} filing",
                "links": [
                    {"label": "PDF", "url": sec_search_url},
                    {"label": "SOURCE", "url": sec_search_url},
                ],
                "source": "SEC",
            }
        )

    items.sort(key=lambda item: item["publishedAt"], reverse=True)
    return {"items": items[:limit]}


# ---------------------------------------------------------------------------
# Scheduled reports — the scheduler service existed but was never exposed, so the
# Settings → Scheduled Reports panel 404'd on every load.
# ---------------------------------------------------------------------------
from dataclasses import asdict as _asdict  # noqa: E402

from pydantic import BaseModel as _BaseModel, Field as _Field  # noqa: E402

from backend.reports.scheduler import scheduled_reports_service  # noqa: E402


class ScheduledReportCreate(_BaseModel):
    report_type: str = _Field(min_length=1, max_length=64)
    frequency: str = _Field(pattern="^(daily|weekly|monthly)$")
    email: str = _Field(min_length=3, max_length=254)
    data_type: str = _Field(default="positions", max_length=64)


@router.get("/reports/scheduled")
def list_scheduled_reports() -> dict[str, Any]:
    return {"items": [_asdict(cfg) for cfg in scheduled_reports_service.list()]}


@router.post("/reports/scheduled")
def create_scheduled_report(payload: ScheduledReportCreate) -> dict[str, Any]:
    cfg = scheduled_reports_service.upsert(payload.report_type, payload.frequency, payload.email, payload.data_type)
    return _asdict(cfg)


@router.delete("/reports/scheduled/{config_id}")
def delete_scheduled_report(config_id: str) -> dict[str, Any]:
    if not scheduled_reports_service.delete(config_id):
        raise HTTPException(status_code=404, detail="Scheduled report not found")
    return {"status": "deleted", "id": config_id}
