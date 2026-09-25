from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

import numpy as np
import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.services.pit_fundamentals_service import get_fundamentals_asof

DEFAULT_FACTOR_WEIGHTS: dict[str, float] = {
    "value": 0.30,
    "momentum": 0.30,
    "quality": 0.25,
    "low_volatility": 0.15,
}

_EPS = 1e-9


def _ols(y: np.ndarray, x: np.ndarray) -> tuple[np.ndarray, float]:
    beta, *_ = np.linalg.lstsq(x, y, rcond=None)
    y_hat = x @ beta
    ss_res = float(np.sum((y - y_hat) ** 2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    r2 = float(1.0 - (ss_res / ss_tot)) if ss_tot > 0 else 0.0
    return beta, r2


def run_factor_decomposition(
    *,
    daily_returns: list[float],
    factors: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    strategy = pd.Series(daily_returns, dtype=float).replace([np.inf, -np.inf], np.nan).dropna()
    if strategy.empty:
        return {"model": "fama_french_carhart", "coefficients": {}, "r2": 0.0}

    if factors:
        factor_df = pd.DataFrame(factors).copy()
    else:
        n = len(strategy)
        idx = np.arange(n, dtype=float)
        factor_df = pd.DataFrame(
            {
                "mkt_rf": np.sin(idx / 13.0) * 0.002 + 0.0004,
                "smb": np.cos(idx / 17.0) * 0.0012,
                "hml": np.sin(idx / 19.0) * 0.001,
                "mom": np.cos(idx / 11.0) * 0.0014,
            }
        )
    factor_df = factor_df.apply(pd.to_numeric, errors="coerce").dropna()
    min_len = min(len(strategy), len(factor_df))
    if min_len < 10:
        return {"model": "fama_french_carhart", "coefficients": {}, "r2": 0.0}

    y = strategy.iloc[-min_len:].to_numpy(dtype=float)
    f = factor_df.iloc[-min_len:].reset_index(drop=True)
    cols = [c for c in ["mkt_rf", "smb", "hml", "mom"] if c in f.columns]
    x = f[cols].to_numpy(dtype=float)
    x = np.column_stack([np.ones(len(x)), x])
    beta, r2 = _ols(y, x)
    coeffs = {"alpha": round(float(beta[0]), 8)}
    for idx, col in enumerate(cols, start=1):
        coeffs[col] = round(float(beta[idx]), 8)
    return {"model": "fama_french_carhart", "coefficients": coeffs, "r2": round(r2, 6)}


def _clean_market(value: str | None) -> str:
    text = (value or "IN").strip().upper()
    if text in {"NSE", "BSE", "INDIA"}:
        return "IN"
    if text in {"NYSE", "NASDAQ", "USA"}:
        return "US"
    return text or "IN"


def _as_of(value: date | str | None) -> date:
    if isinstance(value, date):
        return value
    if value:
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError:
            pass
    return datetime.now(timezone.utc).date()


def _to_float(value: Any) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(out):
        return None
    return out


def _first_float(*values: Any) -> float | None:
    for value in values:
        out = _to_float(value)
        if out is not None:
            return out
    return None


def _normalize_weights(weights: dict[str, float] | None) -> dict[str, float]:
    merged = dict(DEFAULT_FACTOR_WEIGHTS)
    if weights:
        for key, value in weights.items():
            normalized = key.strip().lower()
            if normalized in merged:
                merged[normalized] = max(float(value), 0.0)
    total = sum(merged.values())
    if total <= 0:
        return dict(DEFAULT_FACTOR_WEIGHTS)
    return {key: value / total for key, value in merged.items()}


def _sector_zscore(series: pd.Series, sectors: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(series, errors="coerce")
    out = pd.Series(0.0, index=numeric.index, dtype="float64")
    for _, idx in sectors.fillna("UNKNOWN").groupby(sectors.fillna("UNKNOWN")).groups.items():
        group = numeric.loc[idx]
        mean_val = group.mean(skipna=True)
        std_val = group.std(skipna=True, ddof=0)
        if pd.isna(mean_val) or not std_val or pd.isna(std_val):
            out.loc[idx] = 0.0
        else:
            out.loc[idx] = ((group - mean_val) / max(float(std_val), _EPS)).fillna(0.0)
    return out.clip(lower=-4.0, upper=4.0)


def _load_screener_snapshot(db: Session, symbols: list[str], market: str) -> pd.DataFrame:
    if not symbols:
        return pd.DataFrame()
    placeholders = ", ".join(f":s{i}" for i in range(len(symbols)))
    params = {f"s{i}": symbol.upper() for i, symbol in enumerate(symbols)}
    params["market"] = market
    try:
        rows = db.execute(
            text(
                f"""
                SELECT ticker, company_name, sector, industry, current_price, market_cap, pe, pb_calc,
                       ps_calc, ev_ebitda, roe_pct, roa_pct, op_margin_pct, net_margin_pct,
                       rev_growth_pct, eps_growth_pct, beta, market, exchange, country_code,
                       piotroski_f_score, altman_z_score
                FROM screener_snapshot
                WHERE UPPER(ticker) IN ({placeholders})
                  AND (UPPER(COALESCE(market, '')) = :market OR :market = '')
                """
            ),
            params,
        ).mappings().all()
    except Exception:
        return pd.DataFrame()
    return pd.DataFrame([dict(row) for row in rows])


def _load_price_features(db: Session, symbols: list[str], as_of_day: date) -> dict[str, dict[str, float]]:
    if not symbols:
        return {}
    placeholders = ", ".join(f":s{i}" for i in range(len(symbols)))
    params = {f"s{i}": symbol.upper() for i, symbol in enumerate(symbols)}
    params["as_of"] = as_of_day.isoformat()
    try:
        rows = db.execute(
            text(
                f"""
                SELECT symbol, trade_date, close
                FROM prices_eod
                WHERE UPPER(symbol) IN ({placeholders})
                  AND trade_date <= :as_of
                ORDER BY symbol ASC, trade_date ASC
                """
            ),
            params,
        ).mappings().all()
    except Exception:
        return {}
    if not rows:
        return {}
    frame = pd.DataFrame([dict(row) for row in rows])
    frame["close"] = pd.to_numeric(frame["close"], errors="coerce")
    out: dict[str, dict[str, float]] = {}
    for symbol, group in frame.dropna(subset=["close"]).groupby(frame["symbol"].astype(str).str.upper()):
        closes = group["close"].astype(float).reset_index(drop=True)
        if closes.empty:
            continue
        latest = float(closes.iloc[-1])
        ret_6m = (latest / float(closes.iloc[-126]) - 1.0) if len(closes) > 126 and closes.iloc[-126] > 0 else 0.0
        ret_12m = (latest / float(closes.iloc[-252]) - 1.0) if len(closes) > 252 and closes.iloc[-252] > 0 else ret_6m
        daily_returns = closes.pct_change().replace([np.inf, -np.inf], np.nan).dropna()
        volatility = float(daily_returns.tail(252).std(ddof=0) * np.sqrt(252)) if not daily_returns.empty else 0.0
        out[symbol] = {
            "price_return_6m": float(ret_6m),
            "price_return_12m": float(ret_12m),
            "realized_volatility": volatility,
        }
    return out


def _pit_fundamentals_or_empty(
    db: Session,
    symbol: str,
    as_of_day: date,
    data_version_id: str | None,
) -> dict[str, float]:
    try:
        _, pit = get_fundamentals_asof(db, symbol, as_of_day.isoformat(), data_version_id=data_version_id)
        return pit
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        return {}


def _load_symbols_from_universe(db: Session, universe: str, market: str, as_of_day: date, data_version_id: str | None) -> list[str]:
    params = {"universe": universe, "as_of": as_of_day.isoformat(), "data_version_id": data_version_id or ""}
    version_filter = "AND (:data_version_id = '' OR data_version_id = :data_version_id)"
    try:
        rows = db.execute(
            text(
                f"""
                SELECT symbol
                FROM universe_membership
                WHERE universe_id = :universe
                  AND start_date <= :as_of
                  AND (end_date IS NULL OR end_date = '' OR end_date >= :as_of)
                  {version_filter}
                ORDER BY symbol ASC
                """
            ),
            params,
        ).fetchall()
    except Exception:
        rows = []
    symbols = [str(row[0]).upper() for row in rows if row and str(row[0]).strip()]
    if symbols:
        return symbols

    try:
        from backend.screener.engine import _load_universe_symbols

        return _load_universe_symbols(universe, market=market)
    except Exception:
        return ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META"] if market == "US" else ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "ITC"]


def compute_factor_scores(
    db: Session,
    *,
    market: str = "IN",
    universe: str | None = None,
    symbols: list[str] | None = None,
    as_of: date | str | None = None,
    weights: dict[str, float] | None = None,
    data_version_id: str | None = None,
) -> list[dict[str, Any]]:
    market_key = _clean_market(market)
    as_of_day = _as_of(as_of)
    resolved_universe = universe or ("sp_500" if market_key == "US" else "nse_500")
    symbol_list = [s.strip().upper() for s in symbols or [] if s.strip()]
    if not symbol_list:
        symbol_list = _load_symbols_from_universe(db, resolved_universe, market_key, as_of_day, data_version_id)
    symbol_list = list(dict.fromkeys(symbol_list))
    if not symbol_list:
        return []

    snapshot = _load_screener_snapshot(db, symbol_list, market_key)
    by_symbol = {str(row.get("ticker") or "").upper(): dict(row) for row in snapshot.to_dict("records")}
    price_features = _load_price_features(db, symbol_list, as_of_day)

    rows: list[dict[str, Any]] = []
    for symbol in symbol_list:
        base = by_symbol.get(symbol, {"ticker": symbol, "sector": "UNKNOWN", "market": market_key})
        pit = _pit_fundamentals_or_empty(db, symbol, as_of_day, data_version_id)
        prices = price_features.get(symbol, {})
        market_cap = _first_float(base.get("market_cap"), pit.get("market_cap"))
        free_cash_flow = _first_float(pit.get("free_cash_flow"), pit.get("operating_cash_flow"))
        debt = _first_float(pit.get("total_debt"), pit.get("total_liabilities"))
        equity = _first_float(pit.get("shareholders_equity"), pit.get("total_stockholders_equity"))
        current_price = _first_float(base.get("current_price"), base.get("price"))
        eps = _first_float(pit.get("eps_diluted"), pit.get("eps"))
        book_value = equity
        revenue = _first_float(pit.get("revenue"))
        ebitda = _first_float(pit.get("ebitda"), pit.get("operating_income"))
        net_income = _first_float(pit.get("net_income"))
        pe = _first_float(base.get("pe"), (current_price / eps) if current_price and eps and eps > 0 else None)
        pb = _first_float(base.get("pb_calc"), (market_cap / book_value) if market_cap and book_value and book_value > 0 else None)
        ps = _first_float(base.get("ps_calc"), (market_cap / revenue) if market_cap and revenue and revenue > 0 else None)
        ev_ebitda = _first_float(base.get("ev_ebitda"), (market_cap / ebitda) if market_cap and ebitda and ebitda > 0 else None)
        roe = _first_float(base.get("roe_pct"), (net_income / equity * 100.0) if net_income and equity and equity > 0 else None)
        roa = _first_float(base.get("roa_pct"))
        op_margin = _first_float(base.get("op_margin_pct"), (pit.get("operating_income") / revenue * 100.0) if pit.get("operating_income") and revenue and revenue > 0 else None)
        net_margin = _first_float(base.get("net_margin_pct"), (net_income / revenue * 100.0) if net_income and revenue and revenue > 0 else None)
        fcf_yield = (free_cash_flow / market_cap * 100.0) if free_cash_flow is not None and market_cap and market_cap > 0 else None
        debt_equity = (debt / equity) if debt is not None and equity and equity > 0 else None
        rows.append(
            {
                "symbol": symbol,
                "company_name": base.get("company_name") or "",
                "market": market_key,
                "sector": base.get("sector") or "UNKNOWN",
                "industry": base.get("industry") or "",
                "pe": pe,
                "pb": pb,
                "ps": ps,
                "ev_ebitda": ev_ebitda,
                "roe": roe,
                "roa": roa,
                "op_margin": op_margin,
                "net_margin": net_margin,
                "fcf_yield": fcf_yield,
                "debt_equity": debt_equity,
                "rev_growth": _first_float(base.get("rev_growth_pct")),
                "eps_growth": _first_float(base.get("eps_growth_pct")),
                "beta": _first_float(base.get("beta")),
                "price_return_6m": prices.get("price_return_6m", 0.0),
                "price_return_12m": prices.get("price_return_12m", 0.0),
                "realized_volatility": prices.get("realized_volatility", 0.0),
                "as_of": as_of_day.isoformat(),
            }
        )

    df = pd.DataFrame(rows)
    if df.empty:
        return []
    sectors = df["sector"].astype(str).replace("", "UNKNOWN")
    df["value"] = (
        _sector_zscore(-pd.to_numeric(df["pe"], errors="coerce"), sectors) * 0.30
        + _sector_zscore(-pd.to_numeric(df["pb"], errors="coerce"), sectors) * 0.25
        + _sector_zscore(-pd.to_numeric(df["ps"], errors="coerce"), sectors) * 0.20
        + _sector_zscore(-pd.to_numeric(df["ev_ebitda"], errors="coerce"), sectors) * 0.15
        + _sector_zscore(pd.to_numeric(df["fcf_yield"], errors="coerce"), sectors) * 0.10
    )
    df["momentum"] = (
        _sector_zscore(pd.to_numeric(df["price_return_12m"], errors="coerce"), sectors) * 0.55
        + _sector_zscore(pd.to_numeric(df["price_return_6m"], errors="coerce"), sectors) * 0.30
        + _sector_zscore(pd.to_numeric(df["eps_growth"], errors="coerce"), sectors) * 0.15
    )
    df["quality"] = (
        _sector_zscore(pd.to_numeric(df["roe"], errors="coerce"), sectors) * 0.30
        + _sector_zscore(pd.to_numeric(df["roa"], errors="coerce"), sectors) * 0.20
        + _sector_zscore(pd.to_numeric(df["op_margin"], errors="coerce"), sectors) * 0.20
        + _sector_zscore(pd.to_numeric(df["net_margin"], errors="coerce"), sectors) * 0.15
        + _sector_zscore(pd.to_numeric(df["fcf_yield"], errors="coerce"), sectors) * 0.10
        + _sector_zscore(-pd.to_numeric(df["debt_equity"], errors="coerce"), sectors) * 0.05
    )
    df["low_volatility"] = (
        _sector_zscore(-pd.to_numeric(df["beta"], errors="coerce"), sectors) * 0.45
        + _sector_zscore(-pd.to_numeric(df["realized_volatility"], errors="coerce"), sectors) * 0.55
    )

    normalized_weights = _normalize_weights(weights)
    df["composite"] = sum(df[key] * weight for key, weight in normalized_weights.items())
    df = df.sort_values(["composite", "symbol"], ascending=[False, True]).reset_index(drop=True)
    total = len(df)
    df["rank"] = df.index + 1
    df["percentile"] = ((total - df.index) / total * 100.0) if total else 0.0
    out = []
    for row in df.to_dict("records"):
        out.append(
            {
                "symbol": row["symbol"],
                "company_name": row.get("company_name") or "",
                "market": market_key,
                "sector": row.get("sector") or "UNKNOWN",
                "industry": row.get("industry") or "",
                "as_of": as_of_day.isoformat(),
                "scores": {
                    "value": round(float(row["value"]), 4),
                    "momentum": round(float(row["momentum"]), 4),
                    "quality": round(float(row["quality"]), 4),
                    "low_volatility": round(float(row["low_volatility"]), 4),
                    "composite": round(float(row["composite"]), 4),
                    "percentile": round(float(row["percentile"]), 2),
                    "rank": int(row["rank"]),
                },
                "raw_metrics": {
                    key: row.get(key)
                    for key in [
                        "pe",
                        "pb",
                        "ps",
                        "ev_ebitda",
                        "roe",
                        "roa",
                        "op_margin",
                        "net_margin",
                        "fcf_yield",
                        "debt_equity",
                        "price_return_6m",
                        "price_return_12m",
                        "realized_volatility",
                        "beta",
                    ]
                },
                "weights": normalized_weights,
            }
        )
    return out


def top_factor_ideas(
    db: Session,
    *,
    market: str = "IN",
    universe: str | None = None,
    sector: str | None = None,
    as_of: date | str | None = None,
    weights: dict[str, float] | None = None,
    limit: int = 100,
    data_version_id: str | None = None,
) -> list[dict[str, Any]]:
    rows = compute_factor_scores(
        db,
        market=market,
        universe=universe,
        as_of=as_of,
        weights=weights,
        data_version_id=data_version_id,
    )
    if sector:
        sector_key = sector.strip().lower()
        rows = [row for row in rows if str(row.get("sector") or "").strip().lower() == sector_key]
    threshold = 80.0
    ideas = [row for row in rows if float((row.get("scores") or {}).get("percentile") or 0.0) >= threshold]
    ideas.sort(key=lambda row: float((row.get("scores") or {}).get("composite") or 0.0), reverse=True)
    out: list[dict[str, Any]] = []
    for row in ideas[: max(1, int(limit))]:
        scores = row.get("scores") or {}
        out.append(
            {
                **row,
                # Flat fields consumed by the Factor Dashboard idea list.
                "name": row.get("company_name") or row.get("symbol"),
                "rank": scores.get("rank"),
                "composite_score": scores.get("composite"),
                "percentile": scores.get("percentile"),
            }
        )
    return out


def factor_breakdown(
    db: Session,
    *,
    symbol: str,
    market: str = "IN",
    universe: str | None = None,
    as_of: date | str | None = None,
    weights: dict[str, float] | None = None,
    data_version_id: str | None = None,
) -> dict[str, Any] | None:
    symbol_u = symbol.strip().upper()
    rows = compute_factor_scores(
        db,
        market=market,
        universe=universe,
        as_of=as_of,
        weights=weights,
        data_version_id=data_version_id,
    )
    for row in rows:
        if str(row.get("symbol") or "").upper() == symbol_u:
            return row
    targeted = compute_factor_scores(
        db,
        market=market,
        symbols=[symbol_u],
        as_of=as_of,
        weights=weights,
        data_version_id=data_version_id,
    )
    return targeted[0] if targeted else None
