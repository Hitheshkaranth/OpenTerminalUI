from __future__ import annotations

import asyncio
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.api.routes.insider import get_cluster_buys
from backend.filings_rag.models import FilingAnalysisORM
from backend.filings_rag.store import list_documents
from backend.models.core import FundamentalsPitORM, InsiderTrade
from backend.nlp.filing_parser import fetch_public_filings
from backend.reports.routes import bulk_deals
from backend.services.hotlist_service import _UNIVERSE_NAMES, get_hotlist_service

_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}

_CATEGORY_META: tuple[tuple[str, str, str], ...] = (
    ("insider_buying", "Insider buying", "Promoter / insider stake increases"),
    ("bulk_block_deals", "Bulk & block deals", "Large-block trades (India)"),
    ("order_wins", "Order wins", "New contracts & work orders"),
    ("capex_expansion", "Capex & expansion", "Capacity & plant expansions"),
    ("regulatory_approvals", "Regulatory approvals", "FDA / DCGI / EIR approvals (positive only)"),
    ("results_momentum", "Results momentum", "Latest-quarter YoY revenue & profit growth > 20%"),
    ("near_52w_high", "Near 52-week high", "Stocks at or near 52-week highs"),
    ("volume_breakouts", "Volume breakouts", "Unusual volume spikes"),
)

_ORDER_PATTERNS = ("order", "contract", "loa", "letter of award", "bagged", "work order")
_CAPEX_PATTERNS = ("capacity expansion", "capex", "new plant", "commissioning", "greenfield", "brownfield")
_REGULATORY_PATTERNS = ("us-fda", "usfda", "fdasoft", "anda", "eir", "approval", "ce mark", "dgci")
_WARNING_PATTERNS = ("warning letter", "warning-letter", "show cause", "caution order", "censory", "penalty order")
_ORDER_VALUE_RE = re.compile(
    r"(₹|Rs\.?|INR\.?|rupees?)\s*([\d,]+(?:\.\d+)?)\s*(crore|crores|lakh|lac|million|billion|trillion|thousand|cr|mn)?",
    re.IGNORECASE,
)
_ORDER_MULTIPLIERS = {
    "crore": 1.0,
    "crores": 1.0,
    "lakh": 0.0001,
    "lac": 0.0001,
    "million": 0.1,
    "billion": 100.0,
    "trillion": 1000.0,
    "thousand": 0.00001,
    "cr": 1.0,
    "mn": 0.1,
}

_SYMBOL_NAMES: dict[str, str] = {}
for _pairs in _UNIVERSE_NAMES.values():
    for _sym, _name in _pairs:
        _SYMBOL_NAMES[_sym] = _name


def _normalize_market(market: str) -> str:
    m = str(market or "").strip().upper()
    if m in ("NSE", "BSE", "INDIA", "IN"):
        return "IN"
    return "US"


def _symbol_name(symbol: str) -> str:
    return _SYMBOL_NAMES.get(str(symbol).strip().upper(), str(symbol).strip().upper())


def _watched_symbols(market: str) -> tuple[str, ...]:
    return tuple(sym for sym, _ in _UNIVERSE_NAMES.get(market, ()))


def _num(value: Any) -> float | None:
    try:
        if value is None:
            return None
        f = float(value)
        return f if f == f else None
    except (TypeError, ValueError):
        return None


def _to_float(value: Any) -> float | None:
    return _num(value)


def _as_date_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    if not text:
        return None
    for candidate in (text[:10], text):
        try:
            return date.fromisoformat(candidate).isoformat()
        except ValueError:
            continue
    # NSE formats: "01-Oct-2026 18:51:31", "01-OCT-2026", "01-10-2026"
    for fmt in ("%d-%b-%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(text.split()[0], fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _parse_order_value(text: str) -> float | None:
    match = _ORDER_VALUE_RE.search(text or "")
    if not match:
        return None
    number = float(match.group(2).replace(",", ""))
    unit = (match.group(3) or "").lower()
    if not unit:
        return None
    multiplier = _ORDER_MULTIPLIERS.get(unit, 1.0)
    value = number * multiplier
    if value <= 0:
        return None
    return round(value, 2)


# Word-boundary patterns. Plain substrings misfired badly: "anda" matched "Standalone financial
# results", "eir" matched "their", "loa" matched "loan", and "order" matched "court order".
_ORDER_WIN_RE = re.compile(
    r"bagging/receiving of orders|\bletter of (award|intent)\b|\bLoA\b|\bwork orders?\b|\border (win|inflow)s?\b|"
    r"\b(bag(s|ged)?|receiv(ed|es|ing)|secur(ed|es|ing)|won|wins|award(ed)?)\b[^.]{0,80}\b(orders?|contracts?)\b",
    re.IGNORECASE,
)
# NSE's own disclosure categories are authoritative for order wins.
_NSE_ORDER_CATEGORY_RE = re.compile(r"bagging/receiving of orders|awarding of order", re.I)
# Only for free-text matches: legal/tax "orders" are not order wins. (Not "SEBI" — every LODR filing cites it.)
_ORDER_EXCLUDE_RE = re.compile(r"\b(court|tribunal|nclt|arbitration|amalgamation|tax demand|penalty|show cause)\b", re.I)
_CAPEX_RE = re.compile(
    r"\b(capacity expansion|capex|new (plant|facility|unit)|commission(ed|ing) of|greenfield|brownfield|"
    r"commencement of commercial production|commercial production)\b",
    re.IGNORECASE,
)
_REGULATORY_RE = re.compile(r"\b(US ?FDA|USFDA|ANDA|NDA|EIR|DCGI|CE mark|EU ?GMP|WHO ?GMP|tentative approval|final approval)\b", re.I)
_REGULATORY_ADVERSE_RE = re.compile(
    r"warning[- ]letter|form 483|\b483\b|import alert|\bOAI\b|official action indicated|show cause|observations?\b",
    re.IGNORECASE,
)


def classify(title: str, text: str) -> tuple[str | None, float | None]:
    body = f"{title or ''}\n{text or ''}"
    if _NSE_ORDER_CATEGORY_RE.search(title or "") or (_ORDER_WIN_RE.search(body) and not _ORDER_EXCLUDE_RE.search(body)):
        return "order_wins", _parse_order_value(body)
    if _CAPEX_RE.search(body) and not re.search(r"\b(postpone\w*|delay\w*|defer\w*|suspen\w*|shut ?down|closure)\b", body, re.I):
        return "capex_expansion", None
    # An inspection with observations, a 483 or a warning letter is a headwind, never an idea.
    if _REGULATORY_RE.search(body) and not _REGULATORY_ADVERSE_RE.search(body):
        return "regulatory_approvals", None
    return None, None


# ---------------------------------------------------------------------------
# Source loaders — each returns (items, warning | None). A raised source is
# caught here so a single failing upstream yields a warning, never a 500.
# ---------------------------------------------------------------------------
def _load_insider_buys_in(db: Session, market: str) -> tuple[list[dict[str, Any]], str | None]:
    try:
        rows = (
            db.query(InsiderTrade)
            .filter(
                func.lower(InsiderTrade.transaction_type) == "buy",
                InsiderTrade.source.notin_(("SEEDED",)),
            )
            .order_by(InsiderTrade.value.desc(), InsiderTrade.date.desc())
            .limit(12)
            .all()
        )
        items = [
            {
                "symbol": str(row.symbol),
                "name": _symbol_name(row.symbol),
                "headline": f"{_symbol_name(row.symbol)} insider buying",
                "metric_label": "Value bought",
                "metric_value": _to_float(row.value),
                "date": row.date.date().isoformat() if row.date else None,
                "source_url": None,
            }
            for row in rows
        ]
        return items, None
    except Exception as exc:  # noqa: BLE001
        return [], f"insider buying source failed: {exc}"


def _load_cluster_buys_us(db: Session, market: str) -> tuple[list[dict[str, Any]], str | None]:
    try:
        payload = get_cluster_buys(db)
        clusters = payload.get("clusters") if isinstance(payload, dict) else []
        items = []
        for cluster in clusters[:12]:
            items.append(
                {
                    "symbol": str(cluster.get("symbol")),
                    "name": cluster.get("name") or str(cluster.get("symbol")),
                    "headline": f"{cluster.get('name') or cluster.get('symbol')} insider cluster buy",
                    "metric_label": "Cluster buys value",
                    "metric_value": _to_float(cluster.get("total_value")),
                    "date": cluster.get("date"),
                    "source_url": None,
                }
            )
        return items, None
    except Exception as exc:  # noqa: BLE001
        return [], f"US insider cluster buys source failed: {exc}"


def _is_bulk_valid(deal: Any) -> bool:
    if not isinstance(deal, dict):
        return False
    return bool(deal.get("Symbol") or deal.get("symbol") or deal.get("CompanyName") or deal.get("company_name"))


def _bulk_data_list(data: Any) -> list[Any]:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("data", "deals", "results", "records"):
            value = data.get(key)
            if isinstance(value, list):
                return value
    return []


def _bulk_item(deal: Any) -> dict[str, Any]:
    symbol = str(deal.get("Symbol") or deal.get("symbol") or "").upper()
    name = deal.get("CompanyName") or deal.get("company_name") or deal.get("Name") or deal.get("name") or symbol
    value = _to_float(deal.get("dealValue") or deal.get("DealValue") or deal.get("value") or deal.get("Value"))
    quantity = deal.get("quantity") or deal.get("qty") or deal.get("DealQuantity") or deal.get("Quantity")
    side = str(deal.get("buySell") or "").upper()
    client = deal.get("clientName")
    headline = " ".join(p for p in (side or None, "by" if client else None, client) if p) or f"{name} bulk/block deal"
    return {
        "symbol": symbol,
        "name": name,
        "headline": headline,
        # NSE gives quantity × weighted average price in rupees; show crore like the other ₹ metrics.
        "metric_label": "Deal value (₹ cr)" if value is not None else "Deal quantity",
        "metric_value": round(value / 1e7, 2) if value is not None else _to_float(quantity),
        "date": _as_date_str(deal.get("Date") or deal.get("date") or deal.get("TradeDate")),
        "source_url": None,
    }


async def _load_bulk_deals(market: str) -> tuple[list[dict[str, Any]], str | None]:
    if market != "IN":
        return [], None
    try:
        # bulk_deals is an async route function; calling it without await returned a coroutine,
        # so this category was silently always empty.
        payload = await bulk_deals()
        if isinstance(payload, dict) and payload.get("error"):
            return [], f"bulk deals source failed: {payload.get('error')}"
        items = [_bulk_item(d) for d in _bulk_data_list(payload) if _is_bulk_valid(d)]
        items = sorted((i for i in items if i["headline"].startswith("BUY")), key=lambda i: -(i["metric_value"] or 0))[:12]
        return items, None
    except Exception as exc:  # noqa: BLE001
        return [], f"bulk deals source failed: {exc}"


_NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    "Accept": "application/json",
    "Referer": "https://www.nseindia.com/",
}


async def _fetch_nse_market_announcements(days: int = 7) -> list[dict[str, Any]]:
    """Every NSE equity announcement in the window (thousands), so ideas are market-wide
    rather than limited to a fixed large-cap list."""
    to_d = date.today()
    from_d = to_d - timedelta(days=days)
    async with httpx.AsyncClient(headers=_NSE_HEADERS, timeout=40.0, follow_redirects=True, trust_env=False) as client:
        await client.get("https://www.nseindia.com/")
        resp = await client.get(
            "https://www.nseindia.com/api/corporate-announcements",
            params={"index": "equities", "from_date": from_d.strftime("%d-%m-%Y"), "to_date": to_d.strftime("%d-%m-%Y")},
        )
        resp.raise_for_status()
        rows = resp.json()
    out: list[dict[str, Any]] = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or not row.get("symbol"):
            continue
        out.append({
            "_symbol": str(row["symbol"]).upper(),
            "_name": row.get("sm_name"),
            "title": row.get("desc") or "",
            "text": row.get("attchmntText") or "",
            "published_at": row.get("sort_date") or row.get("an_dt"),
            "source_url": row.get("attchmntFile") or None,
        })
    return out


async def _fetch_all_announcements(market: str) -> tuple[list[dict[str, Any]], int]:
    if market == "IN":
        try:
            docs = await _fetch_nse_market_announcements()
            if docs:
                return docs, 0
        except Exception:  # noqa: BLE001 - fall back to the per-symbol scan below
            pass
    all_docs: list[dict[str, Any]] = []
    errors = 0
    for symbol in _watched_symbols(market):
        try:
            docs = await fetch_public_filings(symbol, market)
        except Exception:  # noqa: BLE001
            errors += 1
            continue
        if isinstance(docs, list):
            for doc in docs:
                if isinstance(doc, dict):
                    doc.setdefault("_symbol", symbol)
                    all_docs.append(doc)
    return all_docs, errors


_GENERIC_TITLES = {"general updates", "updates", "press release", "general", "announcement", "intimation"}


def _headline(title: str, text: str, symbol: str) -> str:
    # NSE categories like "General Updates" say nothing; the attachment text carries the news.
    t = (title or "").strip()
    body = re.sub(r"^.{0,120}?has informed the exchange (about|regarding)\s*", "", (text or "").strip(), flags=re.I)
    if (not t or t.lower() in _GENERIC_TITLES) and body:
        return body[:160]
    return t or symbol


def _classify_docs(docs: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {"order_wins": [], "capex_expansion": [], "regulatory_approvals": []}
    for doc in docs:
        title = str(doc.get("title") or "")
        text = str(doc.get("text") or doc.get("summary") or "")
        category, metric = classify(title, text)
        if category is None:
            continue
        symbol = str(doc.get("_symbol") or "")
        out[category].append(
            {
                "symbol": symbol,
                "name": doc.get("_name") or (_symbol_name(symbol) if symbol else title or "Company"),
                "headline": _headline(title, text, symbol),
                "metric_label": "Order value (₹ cr)" if category == "order_wins" else None,
                "metric_value": metric,
                "date": _as_date_str(doc.get("published_at") or doc.get("date") or doc.get("filed_at")),
                "source_url": doc.get("source_url"),
            }
        )
    return out


def _load_results(db: Session, market: str) -> tuple[list[dict[str, Any]], str | None]:
    try:
        rows = db.query(FundamentalsPitORM).filter(
            FundamentalsPitORM.metric.in_(("revenue", "net_income"))
        ).order_by(FundamentalsPitORM.as_of_date.asc()).all()
    except Exception as exc:  # noqa: BLE001
        return [], f"results source failed: {exc}"

    by_symbol: dict[str, dict[str, list[float | None]]] = {}
    for row in rows:
        bucket = by_symbol.setdefault(str(row.symbol), {"revenue": [], "net_income": []})
        bucket[str(row.metric).lower()].append(_to_float(row.value))

    items: list[dict[str, Any]] = []
    for symbol, series in by_symbol.items():
        revenue = [value for value in series["revenue"] if value is not None]
        profit = [value for value in series["net_income"] if value is not None]
        if len(revenue) < 2 or len(profit) < 2:
            continue
        latest_revenue, previous_revenue = revenue[-1], revenue[-2]
        latest_profit, previous_profit = profit[-1], profit[-2]
        revenue_growth = ((latest_revenue - previous_revenue) / previous_revenue * 100.0) if previous_revenue else None
        profit_growth = ((latest_profit - previous_profit) / previous_profit * 100.0) if previous_profit else None
        if (
            revenue_growth is not None
            and profit_growth is not None
            and revenue_growth > 20.0
            and profit_growth > 20.0
        ):
            items.append(
                {
                    "symbol": symbol,
                    "name": _symbol_name(symbol),
                    "headline": f"{_symbol_name(symbol)} revenue +{round(revenue_growth, 1)}% YoY",
                    "metric_label": "Revenue YoY %",
                    "metric_value": round(revenue_growth, 2),
                    "date": None,
                    "source_url": None,
                }
            )
    if not by_symbol:
        return [], "results source unavailable: no quarterly financials found"
    return items, None


async def _load_hotlist(market: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str | None]:
    try:
        service_instance = get_hotlist_service()
        highs = await asyncio.wait_for(service_instance.get_hotlist("52w_high", market, 12), timeout=20)
        volumes = await asyncio.wait_for(service_instance.get_hotlist("unusual_volume", market, 12), timeout=20)
    except Exception as exc:  # noqa: BLE001
        return [], [], f"hotlist source failed: {exc}"

    today = date.today().isoformat()
    high_items = [
        {
            "symbol": item["symbol"],
            "name": item.get("name"),
            "headline": f"{item.get('name') or item['symbol']} near 52-week high",
            "metric_label": "Change %",
            "metric_value": _to_float(item.get("change_pct")),
            "date": today,
            "source_url": None,
        }
        for item in (highs if isinstance(highs, list) else [])
    ]
    volume_items = [
        {
            "symbol": item["symbol"],
            "name": item.get("name"),
            "headline": f"{item.get('name') or item['symbol']} volume breakout",
            "metric_label": "Volume change %",
            "metric_value": item.get("change_pct"),
            "date": today,
            "source_url": None,
        }
        for item in (volumes if isinstance(volumes, list) else [])
    ]
    return high_items, volume_items, None


def _sort_by_metric(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def key(item: dict[str, Any]) -> tuple[int, float]:
        value = _num(item.get("metric_value"))
        return (1, 0.0) if value is None else (0, -value)

    return sorted(items, key=key)[:12]


def _sort_by_date(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    dated = sorted([item for item in items if item.get("date")], key=lambda item: item["date"], reverse=True)
    return (dated + [item for item in items if not item.get("date")])[:12]


async def build_ideas_board(db: Session, market: str) -> dict[str, Any]:
    market = _normalize_market(market)
    warnings: list[str] = []

    if market == "IN":
        insider_items, warning = _load_insider_buys_in(db, market)
    else:
        insider_items, warning = _load_cluster_buys_us(db, market)
    if warning:
        warnings.append(warning)

    bulk_items, warning = await _load_bulk_deals(market)
    if warning:
        warnings.append(warning)

    docs, errors = await _fetch_all_announcements(market)
    classified = _classify_docs(docs)
    if errors and not docs:
        warnings.append(f"filings source unavailable for {errors} of {len(_watched_symbols(market))} symbols")

    results_items, warning = _load_results(db, market)
    if warning:
        warnings.append(warning)

    hotlist_52w, hotlist_volume, hotlist_warning = await _load_hotlist(market)
    if hotlist_warning:
        warnings.append(hotlist_warning)

    by_id: dict[str, list[dict[str, Any]]] = {
        "insider_buying": insider_items,
        "bulk_block_deals": bulk_items,
        "order_wins": classified["order_wins"],
        "capex_expansion": classified["capex_expansion"],
        "regulatory_approvals": classified["regulatory_approvals"],
        "results_momentum": results_items,
        "near_52w_high": hotlist_52w,
        "volume_breakouts": hotlist_volume,
    }

    categories: list[dict[str, Any]] = []
    for category_id, label, description in _CATEGORY_META:
        items = by_id.get(category_id, [])
        if category_id in ("near_52w_high", "volume_breakouts"):
            items = items[:12]
        elif category_id in ("capex_expansion", "regulatory_approvals"):
            items = _sort_by_date(items)
        else:
            items = _sort_by_metric(items)
        categories.append(
            {
                "id": category_id,
                "label": label,
                "description": description,
                "items": items,
            }
        )

    return {
        "market": market,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "categories": categories,
        "warnings": warnings,
    }


_CACHE_TTL_SECONDS = 600


async def get_ideas_board(db: Session, market: str) -> dict[str, Any]:
    market = _normalize_market(market)
    now = datetime.now(timezone.utc).timestamp()
    cached = _CACHE.get(market)
    if cached and cached[0] > now - _CACHE_TTL_SECONDS:
        return cached[1]
    result = await build_ideas_board(db, market)
    _CACHE[market] = (now, result)
    return result


# ---------------------------------------------------------------------------
# Timeline
# ---------------------------------------------------------------------------
def _doc_event(doc: dict[str, Any], symbol: str) -> dict[str, Any]:
    return {
        "date": _as_date_str(doc.get("filed_at") or doc.get("created_at") or doc.get("period")),
        "symbol": symbol,
        "kind": "filing",
        "headline": doc.get("title") or symbol,
        "source_url": doc.get("source_url"),
    }


def _analysis_events(db: Session, symbol: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    try:
        rows = (
            db.query(FilingAnalysisORM)
            .filter(FilingAnalysisORM.symbol == str(symbol).upper())
            .order_by(FilingAnalysisORM.created_at.desc())
            .limit(1)
            .all()
        )
    except Exception:  # noqa: BLE001
        return events
    for row in rows:
        payload = row.payload or {}
        stance = payload.get("stance") or payload.get("headline") or "analysis"
        events.append(
            {
                "date": row.created_at.date().isoformat() if row.created_at else None,
                "symbol": symbol,
                "kind": "analysis",
                "headline": f"Filings analysis: {stance}",
                "source_url": None,
            }
        )
    return events


def _insider_timeline_events(db: Session, symbol: str) -> list[dict[str, Any]]:
    rows = (
        db.query(InsiderTrade)
        .filter(
            InsiderTrade.symbol == str(symbol).upper(),
            func.lower(InsiderTrade.transaction_type) == "buy",
            InsiderTrade.source.notin_(("SEEDED",)),
        )
        .order_by(InsiderTrade.date.desc())
        .all()
    )
    return [
        {
            "date": row.date.date().isoformat(),
            "symbol": symbol,
            "kind": "insider",
            "headline": f"{_symbol_name(row.symbol)} insider buying",
            "source_url": None,
        }
        for row in rows
    ]


def _results_timeline_events(db: Session, symbol: str, market: str) -> list[dict[str, Any]]:
    items, _warning = _load_results(db, market)
    return [
        {
            "date": item.get("date"),
            "symbol": symbol,
            "kind": "results",
            "headline": item.get("headline") or f"{_symbol_name(symbol)} results momentum",
            "source_url": None,
        }
        for item in items
        if str(item.get("symbol")).upper() == str(symbol).upper()
    ]


async def build_timeline(db: Session, symbols: str, market: str, limit: int) -> dict[str, Any]:
    market = _normalize_market(market)
    safe_limit = max(1, min(int(limit or 50), 200))
    requested = [s.strip() for s in str(symbols or "").split(",") if s.strip()]
    symbol_list = [s.upper() for s in requested] or [s for s in _watched_symbols(market)]

    events: list[dict[str, Any]] = []
    for symbol in symbol_list:
        for loader in (
            lambda db: _insider_timeline_events(db, symbol),
            lambda db: _analysis_events(db, symbol),
            lambda db: _results_timeline_events(db, symbol, market),
        ):
            try:
                events.extend(loader(db))
            except Exception:  # noqa: BLE001
                continue

        try:
            filings = list_documents(db, symbol)
        except Exception:  # noqa: BLE001
            filings = []
        for doc in filings or []:
            if isinstance(doc, dict):
                events.append(_doc_event(doc, symbol))

        try:
            docs = await fetch_public_filings(symbol, market)
        except Exception:  # noqa: BLE001
            continue
        if isinstance(docs, list):
            for doc in docs:
                if not isinstance(doc, dict):
                    continue
                category, _metric = classify(str(doc.get("title") or ""), str(doc.get("text") or doc.get("summary") or ""))
                kind = {"order_wins": "order_win", "capex_expansion": "capex", "regulatory_approvals": "regulatory"}.get(category)
                if kind is None:
                    continue
                title = str(doc.get("title") or "")
                text = str(doc.get("text") or doc.get("summary") or "")
                events.append(
                    {
                        "date": _as_date_str(doc.get("published_at") or doc.get("date") or doc.get("filed_at")),
                        "symbol": symbol,
                        "kind": kind,
                        "headline": _headline(title, text, symbol),
                        "source_url": None,
                    }
                )

    dated = sorted([e for e in events if e.get("date")], key=lambda e: e["date"], reverse=True)
    undated = [e for e in events if not e.get("date")]
    ordered = dated + undated
    return {"items": ordered[:safe_limit]}