from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta
from typing import Any

from pydantic import BaseModel

from backend.equity.services.earnings import earnings_service
from backend.shared.cache import cache

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #
_LATEST_TTL_SECONDS = 30 * 60
_REPORT_WINDOW_DAYS = 14
_MAX_CONCURRENT = 5
_PER_SYMBOL_TIMEOUT_SECONDS = 15
_MAX_RAW_QUARTERS = 40
_YOY_WINDOWN_DAYS = 45
_ANNOUNCEMENT_WINDOW_DAYS = 120


# --------------------------------------------------------------------------- #
# Normalisation helpers
# --------------------------------------------------------------------------- #
def _to_float(value: Any) -> float | None:
    if value in (None, "", "NA", "N/A", "-", "null", "None"):
        return None
    try:
        out = float(value)
        if out != out or out in (float("inf"), float("-inf")):
            return None
        return out
    except (TypeError, ValueError):
        return None


def _pct_change(cur: float | None, prev: float | None) -> float | None:
    if cur is None or prev is None or prev == 0:
        return None
    return ((cur - prev) / abs(prev)) * 100.0


def _ebitda_margin(ebitda: float | None, revenue: float | None) -> float | None:
    if ebitda is None or revenue in (None, 0):
        return None
    return (ebitda / revenue) * 100.0


def _net_margin(profit: float | None, revenue: float | None) -> float | None:
    if profit is None or revenue in (None, 0):
        return None
    return (profit / revenue) * 100.0


def _parse_date(raw: Any) -> date | None:
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _subtract_a_year(day: date) -> date:
    try:
        return day.replace(year=day.year - 1)
    except ValueError:
        return day.replace(year=day.year - 1, month=2, day=28)


def _yoy_reference(
    period_end: date,
    by_date: dict[date, dict[str, Any]],
) -> dict[str, Any] | None:
    target = _subtract_a_year(period_end)
    low = target - timedelta(days=_YOY_WINDOWN_DAYS)
    high = target + timedelta(days=_YOY_WINDOWN_DAYS)
    best: date | None = None
    for day, quarter in by_date.items():
        if day <= period_end and low <= day <= high:
            if best is None or day > best:
                best = day
    return by_date[best] if best is not None else None


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
class ResultsQuarter(BaseModel):
    period: str
    period_end: str | None = None
    revenue: float | None = None
    ebitda: float | None = None
    net_income: float | None = None
    eps: float | None = None
    ebitda_margin_pct: float | None = None
    net_margin_pct: float | None = None
    revenue_yoy_pct: float | None = None
    revenue_qoq_pct: float | None = None
    profit_yoy_pct: float | None = None
    profit_qoq_pct: float | None = None
    eps_estimate: float | None = None
    eps_surprise_pct: float | None = None


class Scorecard(BaseModel):
    label: str
    reasons: list[str]


class ResultsHistory(BaseModel):
    symbol: str
    currency: str | None = None
    quarters: list[ResultsQuarter]
    scorecard: Scorecard
    warnings: list[str]


class ResultsRow(BaseModel):
    symbol: str
    name: str | None
    period: str = ""
    announced_at: str | None = None
    revenue_yoy_pct: float | None = None
    profit_yoy_pct: float | None = None
    eps_surprise_pct: float | None = None
    scorecard: str


# --------------------------------------------------------------------------- #
# Raw normalisation
# --------------------------------------------------------------------------- #
def _normalize_raw(row: Any) -> dict[str, Any] | None:
    if isinstance(row, dict):
        raw: dict[str, Any] = row
    elif hasattr(row, "model_dump"):
        raw = row.model_dump()
    else:
        raw = {k: getattr(row, k) for k in (
            "date", "quarter_end_date", "revenue", "ebitda",
            "net_profit", "net_income", "eps", "quarter",
        )}

    period_end = _parse_date(
        raw.get("date") or raw.get("quarter_end_date") or raw.get("quarterEndDate")
    )
    if period_end is None:
        return None
    return {
        "period_end": period_end,
        "revenue": _to_float(raw.get("revenue") or raw.get("totalRevenue")),
        "ebitda": _to_float(raw.get("ebitda")),
        "net_profit": _to_float(raw.get("net_profit") or raw.get("net_income")),
        "eps": _to_float(raw.get("eps")),
        "period": str(raw.get("quarter") or "").strip(),
    }


def _closest_announcement(
    period_end: date,
    events: dict[date, dict[str, Any]],
) -> dict[str, Any] | None:
    window_start = period_end - timedelta(days=_ANNOUNCEMENT_WINDOW_DAYS)
    best: date | None = None
    for day, value in events.items():
        if window_start <= day <= period_end + timedelta(days=365):
            if best is None or abs((day - period_end).days) < abs((best - period_end).days):
                best = day
    return events[best] if best is not None else None


# --------------------------------------------------------------------------- #
# Scorecard
# --------------------------------------------------------------------------- #
def evaluate_scorecard(
    revenue_yoy: float | None,
    profit_yoy: float | None,
    num_quarters: int,
) -> Scorecard:
    if num_quarters < 5:
        return Scorecard(
            label="insufficient_data",
            reasons=[f"Fewer than 5 quarters of history available ({num_quarters})"],
        )

    if revenue_yoy is not None and profit_yoy is not None:
        if revenue_yoy >= 15 and profit_yoy >= 15:
            return Scorecard(
                label="strong",
                reasons=[
                    f"Revenue YoY {revenue_yoy:+.1f}% and net profit YoY {profit_yoy:+.1f}% both >= 15%"
                ],
            )
        if revenue_yoy < 0 and profit_yoy < 0:
            return Scorecard(
                label="weak",
                reasons=[
                    f"Revenue YoY {revenue_yoy:+.1f}% and net profit YoY {profit_yoy:+.1f}% both negative"
                ],
            )
        if revenue_yoy * profit_yoy < 0:
            return Scorecard(
                label="mixed",
                reasons=[
                    f"Revenue YoY {revenue_yoy:+.1f}% but net profit YoY {profit_yoy:+.1f}% (divergent signs)"
                ],
            )

    rev_str = (
        f"Revenue YoY {revenue_yoy:+.1f}%" if revenue_yoy is not None else "no comparable prior quarter"
    )
    profit_str = (
        f"net profit YoY {profit_yoy:+.1f}%" if profit_yoy is not None else "no comparable prior profit"
    )
    return Scorecard(
        label="steady",
        reasons=[f"{rev_str}; {profit_str} — strong/weak/mixed thresholds not met"],
    )


# --------------------------------------------------------------------------- #
# History
# --------------------------------------------------------------------------- #
async def _raw_quarters(symbol: str) -> list[dict[str, Any]]:
    rows = await earnings_service.get_quarterly_financials(symbol, quarters=_MAX_RAW_QUARTERS)
    out: list[dict[str, Any]] = []
    for row in rows:
        norm = _normalize_raw(row)
        if norm is not None:
            out.append(norm)
    return out


async def _announcement_map(symbol: str) -> dict[date, dict[str, Any]]:
    try:
        calendar = await earnings_service.get_earnings_calendar(
            from_date=date.today() - timedelta(days=1000),
            to_date=date.today(),
            symbols=[symbol],
        )
    except Exception:
        return {}
    out: dict[date, dict[str, Any]] = {}
    for event in calendar:
        day = _parse_date(getattr(event, "earnings_date", None))
        if not day:
            continue
        out[day] = {
            "estimate": _to_float(getattr(event, "estimated_eps", None)),
            "surprise_pct": _to_float(getattr(event, "eps_surprise_pct", None)),
        }
    return out


def build_quarters(
    raw: list[dict[str, Any]],
    estimate_events: dict[date, dict[str, Any]],
    quarters: int,
) -> list[ResultsQuarter]:
    normalised = [q for q in raw if q["period_end"] is not None]
    normalised.sort(key=lambda q: q["period_end"])

    by_date: dict[date, dict[str, Any]] = {}
    for q in normalised:
        by_date[q["period_end"]] = q

    quarters_out: list[ResultsQuarter] = []
    for idx, q in enumerate(normalised):
        period_end = q["period_end"]
        revenue = q.get("revenue")
        profit = q.get("net_profit")
        ebitda = q.get("ebitda")
        eps = q.get("eps")

        yoy = _yoy_reference(period_end, by_date)
        prev = normalised[idx - 1] if idx > 0 else None
        est = _closest_announcement(period_end, estimate_events)

        quarters_out.append(
            ResultsQuarter(
                period=q["period"],
                period_end=period_end.isoformat(),
                revenue=revenue,
                ebitda=ebitda,
                net_income=profit,
                eps=eps,
                ebitda_margin_pct=_ebitda_margin(ebitda, revenue),
                net_margin_pct=_net_margin(profit, revenue),
                revenue_yoy_pct=_pct_change(revenue, yoy.get("revenue") if yoy else None),
                revenue_qoq_pct=_pct_change(revenue, prev.get("revenue") if prev else None),
                profit_yoy_pct=_pct_change(profit, yoy.get("net_profit") if yoy else None),
                profit_qoq_pct=_pct_change(profit, prev.get("net_profit") if prev else None),
                eps_estimate=est["estimate"] if est else None,
                eps_surprise_pct=est["surprise_pct"] if est else None,
            )
        )

    quarters_out.reverse()
    if quarters is not None and 1 <= quarters <= 24:
        quarters_out = quarters_out[:int(quarters)]
    return quarters_out


async def _is_indian(symbol: str) -> bool:
    try:
        from backend.shared.market_classifier import market_classifier

        return (await market_classifier.classify(symbol)).country_code == "IN"
    except Exception:
        return True  # keep the existing (Indian FY) labels if classification fails


def _calendar_quarter_label(period_end: Any) -> str | None:
    try:
        d = period_end if isinstance(period_end, date) else date.fromisoformat(str(period_end)[:10])
    except (TypeError, ValueError):
        return None
    return f"Q{(d.month - 1) // 3 + 1} {d.year}"


async def build_history(symbol: str, quarters: int = 8) -> dict[str, Any]:
    clean = (symbol or "").strip().upper()
    warnings: list[str] = []
    if not clean:
        raise ValueError("symbol is required")

    raw = await _raw_quarters(clean)
    if not raw:
        warnings.append(f"Quarterly financials are unavailable for {clean}.")
    elif not await _is_indian(clean):
        # The shared earnings labeller uses India's Apr–Mar fiscal year, which labelled AAPL's
        # June-2026 quarter "Q1 FY2027". Outside India use the calendar quarter of the period end.
        for row in raw:
            row["period"] = _calendar_quarter_label(row.get("period_end")) or row.get("period")

    estimate_events = await _announcement_map(clean)
    quarters_out = build_quarters(raw, estimate_events, quarters)

    last = quarters_out[0] if quarters_out else None
    scorecard = evaluate_scorecard(
        last.revenue_yoy_pct if last else None,
        last.profit_yoy_pct if last else None,
        len(quarters_out),
    )

    history = ResultsHistory(
        symbol=clean,
        currency=None,
        quarters=quarters_out,
        scorecard=scorecard,
        warnings=warnings,
    )
    return history.model_dump(mode="json")


# --------------------------------------------------------------------------- #
# Latest
# --------------------------------------------------------------------------- #
def _is_recent(period_end: date, today: date) -> bool:
    return period_end >= today - timedelta(days=_REPORT_WINDOW_DAYS)


async def _reporting_events(limit: int, today: date) -> list[dict[str, Any]]:
    from_dt = today - timedelta(days=_REPORT_WINDOW_DAYS)
    try:
        calendar = await earnings_service.get_earnings_calendar(
            from_date=from_dt, to_date=today
        )
    except Exception:
        return []

    by_symbol: dict[str, dict[str, Any]] = {}
    for event in calendar:
        day = _parse_date(getattr(event, "earnings_date", None))
        if day is None or not (from_dt <= day <= today):
            continue
        symbol = str(getattr(event, "symbol", "") or "").strip().upper()
        if not symbol:
            continue
        previous = by_symbol.get(symbol)
        if previous is None or day > _parse_date(getattr(previous, "earnings_date", None)):
            by_symbol[symbol] = event

    rows = []
    for symbol, event in by_symbol.items():
        rows.append(
            {
                "symbol": symbol,
                "name": str(getattr(event, "company_name", "") or "").strip() or symbol,
                "announced_at": getattr(event, "earnings_date", None),
            }
        )
    rows.sort(key=lambda r: str(r["announced_at"]), reverse=True)
    return rows[:limit]


def _row_from_history(event: dict[str, Any], history: dict[str, Any]) -> dict[str, Any] | None:
    quarters = history.get("quarters")
    if not isinstance(quarters, list) or not quarters:
        return None
    latest = quarters[0]
    scorecard = history.get("scorecard")
    score_label = scorecard.get("label") if isinstance(scorecard, dict) else ""
    announced_at = event.get("announced_at")
    return ResultsRow(
        symbol=event["symbol"],
        name=event.get("name"),
        period=latest.get("period") or latest.get("period_end") or "",
        announced_at=str(announced_at.isoformat()) if hasattr(announced_at, "isoformat") else str(announced_at),
        revenue_yoy_pct=latest.get("revenue_yoy_pct"),
        profit_yoy_pct=latest.get("profit_yoy_pct"),
        eps_surprise_pct=latest.get("eps_surprise_pct"),
        scorecard=score_label or "",
    ).model_dump(mode="json")


async def _one_latest(event: dict[str, Any]) -> dict[str, Any] | None:
    history = await build_history(event["symbol"], quarters=8)
    if history.get("warnings"):
        return None
    return _row_from_history(event, history)


async def get_latest(market: str = "IN", limit: int = 50) -> dict[str, Any]:
    clean_market = str(market or "IN").upper()
    if clean_market not in ("IN", "US"):
        clean_market = "US"
    limit = max(1, min(int(limit), 200))

    cache_key = cache.build_key("results_latest", clean_market, {"limit": limit})
    cached = await cache.get(cache_key)
    if isinstance(cached, dict):
        return cached

    today = date.today()
    try:
        events = await _reporting_events(limit, today)
        events = [e for e in events if _is_recent(_parse_date(e["announced_at"]), today)]
    except Exception:
        events = []

    sem = asyncio.Semaphore(_MAX_CONCURRENT)
    completed: list[dict[str, Any] | None] = []
    warnings: list[str] = []

    async def _run(event: dict[str, Any]) -> None:
        symbol = event["symbol"]
        async with sem:
            try:
                async with asyncio.timeout(_PER_SYMBOL_TIMEOUT_SECONDS):
                    result = await _one_latest(event)
            except (TimeoutError, asyncio.TimeoutError):
                warnings.append(f"{symbol}: timed out fetching financials")
                result = None
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"{symbol}: {type(exc).__name__}")
                result = None
            completed.append(result)

    await asyncio.gather(*(_run(e) for e in events))

    items = [r for r in completed if r is not None]
    if not items:
        warnings.append("No quarterly results could be computed for reported symbols.")

    return {
        "market": clean_market,
        "items": items,
        "warnings": warnings,
        "updated_at": today.isoformat(),
    }