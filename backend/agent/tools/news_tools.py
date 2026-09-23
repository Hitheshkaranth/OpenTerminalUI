"""Read-only news, corporate-event and ownership tools for the agent.

Every handler calls an existing service/route function directly — never an
HTTP round-trip back into the app — per C-series contract: news.py,
events_hub.py, insider.py, shareholding.py and dividends.py already do the
real fetching/caching/DB work, so these tools just call them and compact the
result with ``envelope.project``/``envelope.cap``.

Two of the five sources have a *known* synthetic fallback baked in upstream:
``insider.py`` seeds fabricated sample trades when its table is empty, and
``dividends.py`` is entirely hardcoded stub data (it ignores its own
``symbol`` argument). Those handlers detect the fallback and report
``quality="synthetic"`` so the agent never states fabricated numbers as real
— this mirrors the NSE/Kite/Finnhub container-block failure mode this
project already guards against for prices.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.agent.tools.envelope import cap, err, ok, project
from backend.agent.tools.registry import ToolSpec
from backend.api.routes.dividends import get_dividend_history as _get_dividend_history_route
from backend.api.routes.insider import _load_filtered_trades, _trade_payload
from backend.api.routes.news import (
    get_latest_news as _get_latest_news,
    get_news_by_ticker as _get_news_by_ticker,
    get_news_sentiment as _get_news_sentiment_route,
    get_news_sentiment_summary as _get_news_sentiment_summary,
)
from backend.equity.services.shareholding import ShareholdingService
from backend.services.events_hub import get_upcoming_events as _get_upcoming_events
from backend.shared.db import SessionLocal

_NEWS_FIELDS = ("id", "title", "source", "published_at", "url", "summary", "sentiment", "tickers")
_SHAREHOLDING_KEYS = ("promoter", "fii", "dii", "public", "government")


def _clamp(value: Any, default: int, lo: int, hi: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = default
    return max(lo, min(hi, n))


# ---------------------------------------------------------------------------
# 1. get_news_sentiment
# ---------------------------------------------------------------------------

async def get_news_sentiment(args: dict[str, Any]) -> dict[str, Any]:
    symbol = str(args.get("symbol") or "").strip().upper() or None
    limit = _clamp(args.get("limit"), default=20, lo=1, hi=100)

    try:
        if symbol:
            headlines_payload = await _get_news_by_ticker(ticker=symbol, limit=limit, market=None)
            aggregate = await _get_news_sentiment_route(ticker=symbol, days=7, market=None)
        else:
            headlines_payload = await _get_latest_news(limit=limit)
            aggregate = await _get_news_sentiment_summary(days=7, limit=max(limit, 20))
    except Exception as exc:  # noqa: BLE001 — provider/DB failure must reach the agent as data, not a crash
        return err(f"news sentiment fetch failed: {exc}", code="upstream_error")

    items = headlines_payload.get("items", []) if isinstance(headlines_payload, dict) else []
    kept, dropped = cap(items, limit)
    headlines = project(kept, _NEWS_FIELDS)

    data = {
        "symbol": symbol,
        "headline_count": len(items),
        "headlines": headlines,
        "aggregate_read": aggregate,
    }
    return ok(data, source="news_service", truncated=dropped)


# ---------------------------------------------------------------------------
# 2. get_corporate_events
# ---------------------------------------------------------------------------

async def get_corporate_events(args: dict[str, Any]) -> dict[str, Any]:
    raw_symbols = args.get("symbols") or []
    if not isinstance(raw_symbols, list):
        return err("symbols must be an array of tickers", code="invalid_args")
    symbols = [str(s).strip().upper() for s in raw_symbols if str(s).strip()]
    if not symbols:
        # This tool is explicit-symbol scoped, unlike get_upcoming_events (watchlist-scoped).
        return err(
            "symbols is required — pass explicit tickers. For a watchlist-scoped "
            "events feed use get_upcoming_events instead.",
            code="invalid_args",
        )
    days = _clamp(args.get("days"), default=30, lo=1, hi=365)
    raw_types = args.get("types") or []
    types = {str(t).strip().lower() for t in raw_types if str(t).strip()} or None

    try:
        result = await _get_upcoming_events(symbols=symbols, days=days, types=types)
    except Exception as exc:  # noqa: BLE001
        return err(f"corporate events fetch failed: {exc}", code="upstream_error")

    items = result.get("items", []) if isinstance(result, dict) else []
    errors = result.get("errors", []) if isinstance(result, dict) else []
    kept, dropped = cap(items, 50)

    data = {
        "symbols": symbols,
        "days": days,
        "items": kept,
        "source_errors": errors,
    }
    note = f"{len(errors)} upstream source(s) failed for this window" if errors else None
    return ok(data, source="events_hub", truncated=dropped, note=note)


# ---------------------------------------------------------------------------
# 3. get_insider_activity
# ---------------------------------------------------------------------------

async def get_insider_activity(args: dict[str, Any]) -> dict[str, Any]:
    symbol = str(args.get("symbol") or "").strip().upper()
    if not symbol:
        return err("symbol is required", code="invalid_args")
    days = _clamp(args.get("days"), default=90, lo=1, hi=3650)

    db = SessionLocal()
    try:
        trades = _load_filtered_trades(db, days=days, symbol=symbol, limit=200)
    except Exception as exc:  # noqa: BLE001
        return err(f"insider activity fetch failed: {exc}", code="upstream_error")
    finally:
        db.close()

    total_buys = sum(float(t.value or 0.0) for t in trades if str(t.transaction_type).lower() == "buy")
    total_sells = sum(float(t.value or 0.0) for t in trades if str(t.transaction_type).lower() == "sell")
    net_value = total_buys - total_sells
    net_direction = "buying" if net_value > 0 else "selling" if net_value < 0 else "neutral"
    # The route seeds fabricated sample trades when its table is empty (source="SEEDED").
    is_synthetic = any(str(getattr(t, "source", "")).upper() == "SEEDED" for t in trades)

    rows = [_trade_payload(t) for t in trades]
    kept, dropped = cap(rows, 50)

    data = {
        "symbol": symbol,
        "period_days": days,
        "trades": kept,
        "summary": {
            "total_buys": round(total_buys, 2),
            "total_sells": round(total_sells, 2),
            "net_value": round(net_value, 2),
            "net_direction": net_direction,
            "insider_count": len({str(t.insider_name).strip().lower() for t in trades if t.insider_name}),
        },
    }
    quality = "synthetic" if is_synthetic else "live"
    note = "Seeded sample data — no real insider filings ingested for this symbol" if is_synthetic else None
    return ok(data, source="insider_trades", quality=quality, note=note, truncated=dropped)


# ---------------------------------------------------------------------------
# 4. get_shareholding_pattern
# ---------------------------------------------------------------------------

async def get_shareholding_pattern(args: dict[str, Any]) -> dict[str, Any]:
    symbol = str(args.get("symbol") or "").strip().upper()
    if not symbol:
        return err("symbol is required", code="invalid_args")

    service = ShareholdingService()
    try:
        pattern = await service.get_shareholding(symbol)
    except Exception as exc:  # noqa: BLE001
        return err(f"shareholding fetch failed: {exc}", code="upstream_error")

    payload = pattern.model_dump() if hasattr(pattern, "model_dump") else pattern.dict()
    historical = payload.get("historical") or []
    qoq_change = None
    if len(historical) >= 2:
        latest, prior = historical[-1], historical[-2]
        qoq_change = {
            key: round(float(latest.get(key, 0.0)) - float(prior.get(key, 0.0)), 2)
            for key in _SHAREHOLDING_KEYS
            if key in latest
        }

    data = {
        "symbol": symbol,
        "quarter": payload.get("quarter"),
        "promoter_holding": payload.get("promoter_holding"),
        "fii_holding": payload.get("fii_holding"),
        "dii_holding": payload.get("dii_holding"),
        "public_holding": payload.get("public_holding"),
        "government_holding": payload.get("government_holding"),
        "qoq_change": qoq_change,
        "historical": historical[-8:],
        "warning": payload.get("warning"),
    }
    # ShareholdingService marks source="fallback" when NSE scraping fails/non-NSE symbol.
    is_synthetic = payload.get("source") == "fallback"
    quality = "synthetic" if is_synthetic else "live"
    return ok(data, source=str(payload.get("source") or "shareholding_service"), quality=quality)


# ---------------------------------------------------------------------------
# 5. get_dividend_history
# ---------------------------------------------------------------------------

def _dividend_year(row: dict[str, Any]) -> int | None:
    try:
        return datetime.fromisoformat(str(row.get("date"))).year
    except (TypeError, ValueError):
        return None


async def get_dividend_history(args: dict[str, Any]) -> dict[str, Any]:
    symbol = str(args.get("symbol") or "").strip().upper()
    if not symbol:
        return err("symbol is required", code="invalid_args")
    years = args.get("years")

    try:
        rows = await _get_dividend_history_route(symbol)
    except Exception as exc:  # noqa: BLE001
        return err(f"dividend history fetch failed: {exc}", code="upstream_error")

    if years:
        cutoff_year = datetime.now(timezone.utc).year - int(years)
        rows = [r for r in rows if (_dividend_year(r) or 0) >= cutoff_year]

    payouts = [{"date": r.get("date"), "amount": r.get("amount")} for r in rows]
    amounts = [float(p["amount"]) for p in payouts if p.get("amount") is not None]
    consistency = "consistent" if amounts and all(a > 0 for a in amounts) else "no_data"

    data = {
        "symbol": symbol,
        "payouts": payouts,
        "consistency": consistency,
    }
    # backend/api/routes/dividends.py hardcodes its response and ignores `symbol` entirely.
    return ok(
        data,
        source="dividends_route",
        quality="synthetic",
        note="Backing endpoint returns fixed placeholder figures, not symbol-specific dividend filings",
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def news_tool_specs(user_id: str) -> list[ToolSpec]:
    """Return the five read-only news/events/ownership tool specs.

    ``user_id`` is accepted for factory-signature symmetry with
    ``portfolio_tool_specs``/``action_tool_specs`` — this data is public
    market data, not user-scoped, so it is unused today.
    """
    del user_id

    return [
        ToolSpec(
            name="get_news_sentiment",
            description="Return recent headlines for a symbol (or the market if no symbol given) with "
            "per-headline sentiment scores, plus an aggregate sentiment read (bullish/bearish/neutral "
            "split, average score, daily trend). Use for 'what's the news/sentiment on X' questions.",
            parameters={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Optional ticker. Omit for market-wide news."},
                    "limit": {"type": "integer", "default": 20, "minimum": 1, "maximum": 100},
                },
            },
            handler=get_news_sentiment,
            read_only=True,
            write_class="none",
        ),
        ToolSpec(
            name="get_corporate_events",
            description="Return upcoming corporate events (earnings, dividends, splits, bonuses, rights, "
            "board meetings) for EXPLICIT symbols you supply. Use this when the user names specific "
            "tickers. For 'what's coming up for my watchlist' use get_upcoming_events instead — that one "
            "is scoped to the user's own watchlist and does not take a symbols argument.",
            parameters={
                "type": "object",
                "properties": {
                    "symbols": {"type": "array", "items": {"type": "string"}, "description": "Required tickers."},
                    "days": {"type": "integer", "default": 30, "minimum": 1, "maximum": 365},
                    "types": {
                        "type": "array",
                        "items": {"type": "string", "enum": ["earnings", "dividend", "corporate", "expiry", "macro"]},
                        "description": "Optional event-type filter.",
                    },
                },
                "required": ["symbols"],
            },
            handler=get_corporate_events,
            read_only=True,
            write_class="none",
        ),
        ToolSpec(
            name="get_insider_activity",
            description="Return insider/promoter buy and sell transactions for a symbol over the trailing "
            "window, with total buy/sell value and a net_direction (buying/selling/neutral) read. Flags "
            "quality=synthetic when the underlying table has no ingested filings and returned seeded "
            "sample data.",
            parameters={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "days": {"type": "integer", "default": 90, "minimum": 1, "maximum": 3650},
                },
                "required": ["symbol"],
            },
            handler=get_insider_activity,
            read_only=True,
            write_class="none",
        ),
        ToolSpec(
            name="get_shareholding_pattern",
            description="Return a symbol's promoter/FII/DII/public/government shareholding split, the "
            "quarter-over-quarter change in each bucket, and recent quarterly history. Flags "
            "quality=synthetic when NSE scraping failed or the symbol is non-NSE and a fallback estimate "
            "was used.",
            parameters={
                "type": "object",
                "properties": {"symbol": {"type": "string"}},
                "required": ["symbol"],
            },
            handler=get_shareholding_pattern,
            read_only=True,
            write_class="none",
        ),
        ToolSpec(
            name="get_dividend_history",
            description="Return a symbol's historical dividend payouts and a payout-consistency read. "
            "NOTE: the backing endpoint currently returns fixed placeholder figures regardless of symbol "
            "— this tool always reports quality=synthetic so the agent never states these as real filings.",
            parameters={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "years": {"type": "integer", "minimum": 1, "maximum": 30, "description": "Optional lookback filter."},
                },
                "required": ["symbol"],
            },
            handler=get_dividend_history,
            read_only=True,
            write_class="none",
        ),
    ]
