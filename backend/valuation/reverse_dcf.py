from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional, Tuple

# Reverse DCF — back out the annual cash-flow growth rate that justifies today's
# enterprise value, then judge how demanding that growth is versus the company's
# own historical revenue/profit CAGR.
#
# Model (sum-of-parts with a Gordon terminal value):
#   EV = sum_{t=1..N} CF0*(1+g)^t / (1+r)^t  +  TV / (1+r)^N
#   TV = CFN*(1+g_t) / (r - g_t),  CFN = CF0*(1+g)^N
#
# g is solved numerically (bisection on [-0.5, 1.0], tolerance 1e-6).

_MIN_GROWTH = -0.5
_MAX_GROWTH = 1.0
_BISECT_TOL = 1e-6
_YEARS_PER_CAGR = 365.25


def _to_float(value: Any) -> Optional[float]:
    if value is None or value == "" or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        out = float(value)
        return out if out == out else None
    try:
        out = float(value)
        return out if out == out else None
    except (TypeError, ValueError):
        return None


def _parse_date(value: Any) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    value = value.strip()
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _yahoo_series(payload: Any, key: str) -> list[Tuple[datetime, float]]:
    if not isinstance(payload, dict):
        return []
    yf = payload.get("yahoo_fundamentals")
    if not isinstance(yf, dict):
        return []
    series = yf.get(key)
    if not isinstance(series, dict):
        return []
    out: list[Tuple[datetime, float]] = []
    for item in series.get("value") or []:
        if not isinstance(item, dict):
            continue
        rv = item.get("reportedValue")
        raw = rv.get("raw") if isinstance(rv, dict) else rv
        value = _to_float(raw)
        d = _parse_date(item.get("asOfDate") or item.get("period"))
        if value is None or d is None:
            continue
        out.append((d, value))
    return out


def _fmp_series(rows: Any, field: str) -> list[Tuple[datetime, float]]:
    out: list[Tuple[datetime, float]] = []
    if not isinstance(rows, list):
        return out
    for row in rows:
        if not isinstance(row, dict):
            continue
        value = _to_float(row.get(field))
        d = _parse_date(row.get("date") or row.get("calendarYear"))
        if value is None or d is None:
            continue
        out.append((d, value))
    return out


def _series_union(*lists: list[Tuple[datetime, float]]) -> list[Tuple[datetime, float]]:
    merged: list[Tuple[datetime, float]] = []
    for lst in lists:
        if lst:
            merged.extend(lst)
    return merged


def _latest(points: list[Tuple[datetime, float]]) -> Optional[float]:
    if not points:
        return None
    return sorted(points, key=lambda x: x[0])[-1][1]


def projected_ev(cf0: float, discount_rate: float, growth: float, terminal_growth: float, years: int) -> float:
    """Present value of the projected cash flows + terminal value at growth ``growth``."""
    base = 1.0 + growth
    disc = 1.0 + discount_rate
    total = 0.0
    for t in range(1, years + 1):
        total += cf0 * (base / disc) ** t
    cf_n = cf0 * base ** years
    tv = cf_n * (1.0 + terminal_growth) / (discount_rate - terminal_growth)
    total += tv / disc ** years
    return total


def solve_implied_growth(
    cf0: Optional[float],
    discount_rate: float,
    terminal_growth: float,
    years: int,
    enterprise_value: Optional[float],
) -> Optional[float]:
    """Bisection on [-0.5, 1.0] for the growth that reproduces ``enterprise_value``.

    Returns the implied annual growth (a fraction, e.g. 0.08) or ``None`` when the
    situation is not meaningful (non-positive base cash flow, r <= terminal growth,
    or no root in the searchable range).
    """
    cf0 = _to_float(cf0)
    if cf0 is None or cf0 <= 0:
        return None
    enterprise_value = _to_float(enterprise_value)
    if enterprise_value is None or enterprise_value <= 0:
        return None
    discount_rate = _to_float(discount_rate)
    terminal_growth = _to_float(terminal_growth)
    if discount_rate is None or terminal_growth is None:
        return None
    if discount_rate <= terminal_growth:
        return None
    if years < 1:
        return None

    def npv(g: float) -> float:
        return projected_ev(cf0, discount_rate, g, terminal_growth, years) - enterprise_value

    f_lo = npv(_MIN_GROWTH)
    f_hi = npv(_MAX_GROWTH)
    # npv is strictly increasing in g when cf0 > 0. If the root lies outside the
    # searchable band the market is pricing in growth we cannot back out.
    if f_lo > 0 or f_hi < 0:
        return None

    lo, hi = _MIN_GROWTH, _MAX_GROWTH
    for _ in range(200):
        mid = (lo + hi) / 2.0
        f_mid = npv(mid)
        if abs(hi - lo) < _BISECT_TOL:
            return mid
        if f_mid < 0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def _cagr(points: list[Tuple[datetime, float]], horizon_years: float) -> Optional[float]:
    """Annualized growth over a window ending on the latest observation.

    Returns ``None`` when the series does not extend ``horizon_years`` back from the
    most recent point, or when either end is not positive enough to take a root of.
    """
    if not points or horizon_years <= 0:
        return None
    ordered = sorted(points, key=lambda x: x[0])
    latest_date, latest_value = ordered[-1]
    cutoff = latest_date - timedelta(days=int(horizon_years * _YEARS_PER_CAGR))
    starts = [p for p in ordered if p[0] <= cutoff]
    if not starts:
        return None
    start_date, start_value = starts[-1]
    if start_value <= 0 or latest_value <= 0:
        return None
    years = (latest_date - start_date).days / _YEARS_PER_CAGR
    if years <= 0:
        return None
    return (latest_value / start_value) ** (1.0 / years) - 1.0


def historical_cagr(revenue: list[Tuple[datetime, float]], profit: list[Tuple[datetime, float]]) -> dict[str, Optional[float]]:
    return {
        "revenue_cagr_3y": _cagr(revenue, 3),
        "revenue_cagr_5y": _cagr(revenue, 5),
        "profit_cagr_3y": _cagr(profit, 3),
        "profit_cagr_5y": _cagr(profit, 5),
    }


def _best_historical(historical: dict[str, Optional[float]]) -> Optional[float]:
    for key in ("revenue_cagr_5y", "profit_cagr_5y", "revenue_cagr_3y", "profit_cagr_3y"):
        if historical.get(key) is not None:
            return historical[key]
    return None


def verdict_for(implied_growth: float, hist_growth: float) -> str:
    """Map (implied − historical) spread in percentage points to a verdict label."""
    diff = (implied_growth - hist_growth) * 100.0
    if diff > 10.0:
        return "priced_for_perfection"
    if diff >= 3.0:
        return "demanding"
    if diff >= -5.0:
        return "reasonable"
    return "undemanding"


def extract_fundamentals(financials: Any) -> dict[str, Any]:
    if not isinstance(financials, dict):
        return {"revenue": [], "profit": [], "fcf": [], "net_debt": None}
    fmp_inc = financials.get("fmp_income", []) or []
    fmp_bal = financials.get("fmp_balance", []) or []
    fmp_cf = financials.get("fmp_cashflow", []) or []

    revenue = _series_union(_yahoo_series(financials, "annualTotalRevenue"), _fmp_series(fmp_inc, "revenue"))
    profit = _series_union(_yahoo_series(financials, "annualNetIncome"), _fmp_series(fmp_inc, "netIncome"))
    fcf = _series_union(_yahoo_series(financials, "annualFreeCashFlow"), _fmp_series(fmp_cf, "freeCashFlow"))

    net_debt_series = _series_union(_yahoo_series(financials, "annualNetDebt"), _fmp_series(fmp_bal, "netDebt"))
    net_debt = _latest(net_debt_series)
    if net_debt is None:
        debt = _latest(_series_union(_yahoo_series(financials, "annualTotalDebt"), _fmp_series(fmp_bal, "totalDebt")))
        cash = _latest(_series_union(_yahoo_series(financials, "annualCashAndCashEquivalents"), _fmp_series(fmp_bal, "cashAndCashEquivalents")))
        if debt is not None and cash is not None:
            net_debt = debt - cash

    return {
        "revenue": revenue,
        "profit": profit,
        "fcf": fcf,
        "net_debt": net_debt,
    }


def build_reverse_dcf(
    symbol: str,
    *,
    price: Any,
    market_cap: Any,
    currency: Optional[str],
    financials: Any,
    discount_rate: float,
    terminal_growth: float,
    years: int,
    basis: str = "fcf",
) -> dict[str, Any]:
    """Pure builder: turn a snapshot + financials payload into a ReverseDcf document."""
    symbol_out = str(symbol).upper() if symbol else symbol
    basis = "net_income" if str(basis or "").strip().lower() == "net_income" else "fcf"

    notes: list[str] = [
        "Implied growth is the annual cash-flow growth rate that justifies today's "
        "enterprise value (market cap + net debt)."
    ]

    fund = extract_fundamentals(financials)
    base_cf = _latest(fund["profit"]) if basis == "net_income" else _latest(fund["fcf"])
    net_debt_out = fund["net_debt"]
    has_net_debt = net_debt_out is not None

    enterprise_value = _to_float(market_cap)
    if enterprise_value is not None and net_debt_out is not None:
        enterprise_value += net_debt_out

    historical = historical_cagr(fund["revenue"], fund["profit"])
    hist = _best_historical(historical)

    implied = solve_implied_growth(base_cf, discount_rate, terminal_growth, int(years), enterprise_value)
    implied_pct: Optional[float] = None

    verdict = "reasonable"
    if implied is not None:
        implied_pct = round(implied * 100, 4)
        if hist is None:
            notes.append(
                "No positive historical growth available; verdict is benchmarked against a 0% baseline."
            )
            hist = 0.0
        verdict = verdict_for(implied, hist)
    else:
        verdict = "not_meaningful"
        if base_cf is None or base_cf <= 0:
            notes.append("Base cash flow is non-positive; no meaningful implied growth.")
        elif _to_float(market_cap) is None:
            notes.append("Market cap unavailable; enterprise value cannot be formed.")
        elif discount_rate <= terminal_growth:
            notes.append("Discount rate is not greater than the terminal growth rate; no solution.")
        else:
            notes.append(
                "No implied growth in the range [{:.0f}%, {:.0f}%]; the market price "
                "implies growth outside the solvable band.".format(_MIN_GROWTH * 100, _MAX_GROWTH * 100)
            )

    if not has_net_debt:
        notes.append("Net debt unavailable from the balance sheet; assumed zero when pricing enterprise value.")

    discount_rate_f = float(discount_rate)
    rates = [
        round(discount_rate_f - 0.02, 6),
        round(discount_rate_f - 0.01, 6),
        discount_rate_f,
        round(discount_rate_f + 0.01, 6),
        round(discount_rate_f + 0.02, 6),
    ]
    growths = [0.02, 0.03, 0.04, 0.05, 0.06]
    grid: list[list[Optional[float] | None]] = []
    for r in rates:
        row: list[Optional[float]] = []
        for g_t in growths:
            if r <= g_t:
                row.append(None)
                continue
            g = solve_implied_growth(base_cf, r, g_t, int(years), enterprise_value)
            row.append(round(g * 100, 4) if g is not None else None)
        grid.append(row)

    return {
        "symbol": symbol_out,
        "currency": currency,
        "price": _to_float(price),
        "market_cap": _to_float(market_cap),
        "net_debt": net_debt_out,
        "basis": basis,
        "base_cash_flow": base_cf,
        "discount_rate": discount_rate_f,
        "terminal_growth": float(terminal_growth),
        "years": int(years),
        "implied_growth_pct": implied_pct,
        "historical": historical,
        "verdict": verdict,
        "sensitivity": {
            "discount_rates": rates,
            "terminal_growths": growths,
            "implied_growth_pct": grid,
        },
        "notes": notes,
    }