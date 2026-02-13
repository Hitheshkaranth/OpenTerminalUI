from __future__ import annotations

import math
from typing import Any


def _to_float(value: Any) -> float | None:
    if value in (None, "", "NA", "N/A", "-"):
        return None
    try:
        out = float(value)
        if math.isnan(out) or math.isinf(out):
            return None
        return out
    except (TypeError, ValueError):
        return None


def _safe_div(numerator: Any, denominator: Any) -> float | None:
    n = _to_float(numerator)
    d = _to_float(denominator)
    if n is None or d is None or d == 0:
        return None
    return n / d


def piotroski_f_score(financials: dict[str, Any]) -> int:
    score = 0
    roa = _to_float(financials.get("roa"))
    roa_prev = _to_float(financials.get("roa_prev"))
    cfo = _to_float(financials.get("cfo"))
    net_income = _to_float(financials.get("net_income"))
    long_term_debt = _to_float(financials.get("long_term_debt"))
    long_term_debt_prev = _to_float(financials.get("long_term_debt_prev"))
    total_assets = _to_float(financials.get("total_assets"))
    total_assets_prev = _to_float(financials.get("total_assets_prev"))
    current_ratio = _to_float(financials.get("current_ratio"))
    current_ratio_prev = _to_float(financials.get("current_ratio_prev"))
    shares_outstanding = _to_float(financials.get("shares_outstanding"))
    shares_outstanding_prev = _to_float(financials.get("shares_outstanding_prev"))
    gross_margin = _to_float(financials.get("gross_margin"))
    gross_margin_prev = _to_float(financials.get("gross_margin_prev"))
    asset_turnover = _to_float(financials.get("asset_turnover"))
    asset_turnover_prev = _to_float(financials.get("asset_turnover_prev"))

    if roa is not None and roa > 0:
        score += 1
    if cfo is not None and cfo > 0:
        score += 1
    if roa is not None and roa_prev is not None and roa > roa_prev:
        score += 1
    if cfo is not None and net_income is not None and cfo > net_income:
        score += 1

    leverage = _safe_div(long_term_debt, total_assets)
    leverage_prev = _safe_div(long_term_debt_prev, total_assets_prev)
    if leverage is not None and leverage_prev is not None and leverage < leverage_prev:
        score += 1
    if current_ratio is not None and current_ratio_prev is not None and current_ratio > current_ratio_prev:
        score += 1
    if shares_outstanding is not None and shares_outstanding_prev is not None and shares_outstanding <= shares_outstanding_prev:
        score += 1
    if gross_margin is not None and gross_margin_prev is not None and gross_margin > gross_margin_prev:
        score += 1
    if asset_turnover is not None and asset_turnover_prev is not None and asset_turnover > asset_turnover_prev:
        score += 1

    return max(0, min(9, score))


def altman_z_score(financials: dict[str, Any]) -> float:
    wc = _to_float(financials.get("working_capital"))
    re = _to_float(financials.get("retained_earnings"))
    ebit = _to_float(financials.get("ebit"))
    mve = _to_float(financials.get("market_value_equity"))
    tl = _to_float(financials.get("total_liabilities"))
    sales = _to_float(financials.get("sales"))
    ta = _to_float(financials.get("total_assets"))
    if None in (wc, re, ebit, mve, tl, sales, ta) or ta == 0 or tl == 0:
        return 0.0
    return float(1.2 * (wc / ta) + 1.4 * (re / ta) + 3.3 * (ebit / ta) + 0.6 * (mve / tl) + 1.0 * (sales / ta))


def graham_number(eps: float, book_value: float) -> float:
    eps_f = _to_float(eps)
    bv_f = _to_float(book_value)
    if eps_f is None or bv_f is None or eps_f <= 0 or bv_f <= 0:
        return 0.0
    return float(math.sqrt(22.5 * eps_f * bv_f))


def peg_ratio(pe: float, earnings_growth: float) -> float:
    pe_f = _to_float(pe)
    growth_f = _to_float(earnings_growth)
    if pe_f is None or growth_f is None or growth_f == 0:
        return 0.0
    return float(pe_f / growth_f)


def magic_formula_rank(earnings_yield: float, roic: float) -> float:
    ey = _to_float(earnings_yield)
    r = _to_float(roic)
    if ey is None or r is None:
        return 0.0
    return float(ey + r)


def dupont_analysis(net_income: float, revenue: float, assets: float, equity: float) -> dict[str, float]:
    margin = _safe_div(net_income, revenue) or 0.0
    turnover = _safe_div(revenue, assets) or 0.0
    leverage = _safe_div(assets, equity) or 0.0
    roe = margin * turnover * leverage
    return {
        "profit_margin": float(margin),
        "asset_turnover": float(turnover),
        "equity_multiplier": float(leverage),
        "roe": float(roe),
    }


def cash_conversion_cycle(dso: float, dio: float, dpo: float) -> float:
    dso_f = _to_float(dso) or 0.0
    dio_f = _to_float(dio) or 0.0
    dpo_f = _to_float(dpo) or 0.0
    return float(dso_f + dio_f - dpo_f)


def fcf_yield(fcf: float, market_cap: float) -> float:
    fcf_f = _to_float(fcf)
    mcap_f = _to_float(market_cap)
    if fcf_f is None or mcap_f is None or mcap_f == 0:
        return 0.0
    return float((fcf_f / mcap_f) * 100)


def cagr(start_value: float, end_value: float, years: float) -> float:
    s = _to_float(start_value)
    e = _to_float(end_value)
    y = _to_float(years)
    if s is None or e is None or y is None or s <= 0 or e <= 0 or y <= 0:
        return 0.0
    return float(((e / s) ** (1.0 / y) - 1.0) * 100)


def dvm_score(durability: float, valuation: float, momentum: float) -> dict[str, float | str]:
    d = max(0.0, min(100.0, _to_float(durability) or 0.0))
    v = max(0.0, min(100.0, _to_float(valuation) or 0.0))
    m = max(0.0, min(100.0, _to_float(momentum) or 0.0))
    overall = (0.4 * d) + (0.3 * v) + (0.3 * m)
    band = "weak"
    if overall >= 75:
        band = "strong"
    elif overall >= 50:
        band = "moderate"
    return {
        "durability": float(d),
        "valuation": float(v),
        "momentum": float(m),
        "overall": float(round(overall, 2)),
        "band": band,
    }
