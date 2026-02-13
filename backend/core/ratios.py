from __future__ import annotations

from typing import Any


def _safe_div(n: Any, d: Any) -> float | None:
    try:
        n_f = float(n)
        d_f = float(d)
        if d_f == 0:
            return None
        return n_f / d_f
    except (TypeError, ValueError):
        return None


def compute_ratios(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    price = row.get("current_price")
    eps = row.get("trailing_eps")
    fwd_eps = row.get("forward_eps")
    bv = row.get("book_value")
    ev = row.get("enterprise_value")
    ebitda = row.get("ebitda")
    debt = row.get("total_debt")
    cash = row.get("total_cash")
    rev = row.get("revenue_ttm")
    mcap = row.get("market_cap")

    out["pe"] = row.get("trailing_pe") or _safe_div(price, eps)
    out["forward_pe_calc"] = row.get("forward_pe") or _safe_div(price, fwd_eps)
    out["pb_calc"] = row.get("price_to_book") or _safe_div(price, bv)
    out["ps_calc"] = row.get("price_to_sales") or _safe_div(mcap, rev)
    out["ev_ebitda"] = _safe_div(ev, ebitda)
    out["net_debt"] = (float(debt) - float(cash)) if debt is not None and cash is not None else None
    out["debt_to_market_cap"] = _safe_div(debt, mcap)
    out["earnings_yield"] = _safe_div(1.0, out["pe"])

    roe = row.get("return_on_equity")
    roa = row.get("return_on_assets")
    out["roe_pct"] = float(roe) * 100 if isinstance(roe, (int, float)) else None
    out["roa_pct"] = float(roa) * 100 if isinstance(roa, (int, float)) else None
    out["op_margin_pct"] = float(row.get("operating_margin")) * 100 if isinstance(row.get("operating_margin"), (int, float)) else None
    out["net_margin_pct"] = float(row.get("profit_margin")) * 100 if isinstance(row.get("profit_margin"), (int, float)) else None
    out["rev_growth_pct"] = float(row.get("revenue_growth")) * 100 if isinstance(row.get("revenue_growth"), (int, float)) else None
    out["eps_growth_pct"] = float(row.get("earnings_growth")) * 100 if isinstance(row.get("earnings_growth"), (int, float)) else None
    out["div_yield_pct"] = float(row.get("dividend_yield")) * 100 if isinstance(row.get("dividend_yield"), (int, float)) else None
    return out
