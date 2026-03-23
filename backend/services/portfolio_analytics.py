from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Iterable

import pandas as pd
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from backend.api.deps import fetch_stock_snapshot_coalesced, get_unified_fetcher
from backend.db.models import Holding, PortfolioHoldingORM, PortfolioORM, TaxLot
from backend.equity.services.corporate_actions import corporate_actions_service
from backend.shared.db import init_db

TRADING_DAYS = 252
BENCHMARK_MAP = {
    "NIFTY50": "^NSEI",
    "NIFTY 50": "^NSEI",
    "SENSEX": "^BSESN",
    "S&P500": "^GSPC",
    "S&P 500": "^GSPC",
    "SP500": "^GSPC",
}
PORTFOLIO_PERIOD_RANGE_MAP = {
    "1W": "5d",
    "1M": "1mo",
    "3M": "3mo",
    "6M": "6mo",
    "1Y": "1y",
    "YTD": "ytd",
}
FACTOR_NAMES = ("Market", "Size", "Value", "Momentum", "Quality", "Volatility")


@dataclass
class TaxRealizationLine:
    lot_id: int
    ticker: str
    quantity: float
    buy_price: float
    sell_price: float
    buy_date: str
    sell_date: str
    holding_days: int
    holding_period: str
    realized_gain: float


def _normalize_period(period: str) -> str:
    label = str(period or "").strip().upper()
    if label not in PORTFOLIO_PERIOD_RANGE_MAP:
        raise ValueError(f"Unsupported attribution period '{period}'")
    return label


def _series_return(close: pd.Series) -> float:
    if close.empty:
        return 0.0
    series = close.dropna()
    if series.empty:
        return 0.0
    start = float(series.iloc[0])
    end = float(series.iloc[-1])
    if start <= 0:
        return 0.0
    return (end / start) - 1.0


def compute_brinson_attribution(
    portfolio_weights: dict[str, float],
    benchmark_weights: dict[str, float],
    portfolio_returns: dict[str, float],
    benchmark_returns: dict[str, float],
    sector_map: dict[str, str],
) -> dict[str, Any]:
    sectors = sorted(
        {
            *(sector_map.values() if sector_map else []),
            *portfolio_weights.keys(),
            *benchmark_weights.keys(),
            *portfolio_returns.keys(),
            *benchmark_returns.keys(),
        }
    )
    if not sectors:
        return {
            "sectors": [],
            "total_allocation": 0.0,
            "total_selection": 0.0,
            "total_interaction": 0.0,
            "check_sum": 0.0,
            "portfolio_return": 0.0,
            "benchmark_return": 0.0,
            "active_return": 0.0,
        }

    portfolio_total = sum(float(portfolio_weights.get(sector, 0.0)) * float(portfolio_returns.get(sector, 0.0)) for sector in sectors)
    benchmark_total = sum(float(benchmark_weights.get(sector, 0.0)) * float(benchmark_returns.get(sector, 0.0)) for sector in sectors)
    active_return = portfolio_total - benchmark_total

    rows: list[dict[str, Any]] = []
    total_allocation = 0.0
    total_selection = 0.0
    total_interaction = 0.0
    for sector in sectors:
        wp = float(portfolio_weights.get(sector, 0.0))
        wb = float(benchmark_weights.get(sector, 0.0))
        rp = float(portfolio_returns.get(sector, 0.0))
        rb = float(benchmark_returns.get(sector, 0.0))
        allocation = (wp - wb) * (rb - benchmark_total)
        selection = wb * (rp - rb)
        interaction = (wp - wb) * (rp - rb)
        total = allocation + selection + interaction
        total_allocation += allocation
        total_selection += selection
        total_interaction += interaction
        rows.append(
            {
                "sector": sector,
                "portfolio_weight": wp,
                "benchmark_weight": wb,
                "portfolio_return": rp,
                "benchmark_return": rb,
                "allocation": allocation,
                "selection": selection,
                "interaction": interaction,
                "total": total,
            }
        )

    return {
        "sectors": rows,
        "total_allocation": total_allocation,
        "total_selection": total_selection,
        "total_interaction": total_interaction,
        "check_sum": total_allocation + total_selection + total_interaction,
        "portfolio_return": portfolio_total,
        "benchmark_return": benchmark_total,
        "active_return": active_return,
    }


def compute_factor_attribution(
    holdings: list[dict[str, Any]],
    factor_exposures: dict[str, dict[str, float]],
    factor_returns: dict[str, float],
    target_return: float | None = None,
) -> dict[str, Any]:
    if not holdings or not factor_returns:
        return {
            "exposures": {factor: 0.0 for factor in factor_returns},
            "factor_returns": {factor: float(value) for factor, value in factor_returns.items()},
            "contributions": {factor: 0.0 for factor in factor_returns},
            "alpha": float(target_return or 0.0),
            "check_sum": float(target_return or 0.0),
        }

    weights = {str(row.get("symbol") or row.get("ticker") or row.get("id") or idx): max(0.0, float(row.get("weight") or 0.0)) for idx, row in enumerate(holdings)}
    weight_total = sum(weights.values())
    if weight_total <= 0:
        normalized_weights = {key: 1.0 / len(weights) for key in weights}
    else:
        normalized_weights = {key: weight / weight_total for key, weight in weights.items()}

    exposures: dict[str, float] = {}
    for factor in factor_returns:
        exposures[factor] = 0.0
        for row in holdings:
            key = str(row.get("symbol") or row.get("ticker") or row.get("id") or "")
            row_weight = normalized_weights.get(key, 0.0)
            exposures[factor] += row_weight * float(factor_exposures.get(key, {}).get(factor, 0.0))

    contributions = {factor: exposures[factor] * float(factor_returns[factor]) for factor in factor_returns}
    explained = sum(contributions.values())
    residual = float(target_return or 0.0) - explained
    return {
        "exposures": exposures,
        "factor_returns": {factor: float(value) for factor, value in factor_returns.items()},
        "contributions": contributions,
        "alpha": residual,
        "check_sum": explained + residual,
    }


class PortfolioAnalyticsService:
    async def _close_series(self, symbol: str, range_str: str = "5y", interval: str = "1d") -> pd.Series:
        fetcher = await get_unified_fetcher()
        raw = await fetcher.fetch_history(symbol, range_str=range_str, interval=interval)
        if isinstance(raw, dict) and "chart" in raw:
            try:
                result = (((raw.get("chart") or {}).get("result") or [])[0])
                timestamps = result.get("timestamp") or []
                quote = (((result.get("indicators") or {}).get("quote") or [])[0])
                closes = quote.get("close") or []
                points: list[tuple[pd.Timestamp, float]] = []
                for ts, close in zip(timestamps, closes):
                    if close is None:
                        continue
                    try:
                        points.append((pd.Timestamp(int(ts), unit="s", tz="UTC"), float(close)))
                    except Exception:
                        continue
                if not points:
                    return pd.Series(dtype="float64")
                df = pd.DataFrame(points, columns=["date", "close"]).drop_duplicates(subset=["date"]).set_index("date").sort_index()
                return df["close"]
            except Exception:
                return pd.Series(dtype="float64")
        if isinstance(raw, dict) and "historical" in raw:
            rows = raw.get("historical") if isinstance(raw.get("historical"), list) else []
            pts: list[tuple[pd.Timestamp, float]] = []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                dt = str(row.get("date") or "")
                close = row.get("close")
                try:
                    pts.append((pd.Timestamp(f"{dt}T00:00:00Z"), float(close)))
                except Exception:
                    continue
            if not pts:
                return pd.Series(dtype="float64")
            df = pd.DataFrame(pts, columns=["date", "close"]).drop_duplicates(subset=["date"]).set_index("date").sort_index()
            return df["close"]
        return pd.Series(dtype="float64")

    async def sector_allocation(self, holdings: Iterable[Holding]) -> dict[str, Any]:
        rows: list[dict[str, Any]] = []
        total = 0.0
        for h in holdings:
            snap = await fetch_stock_snapshot_coalesced(h.ticker)
            sector = str(snap.get("sector") or snap.get("industry") or "Unknown").strip() or "Unknown"
            industry = str(snap.get("industry") or "Unknown").strip() or "Unknown"
            price = snap.get("current_price")
            current = float(h.quantity) * float(price) if isinstance(price, (int, float)) else float(h.quantity) * float(h.avg_buy_price)
            total += current
            rows.append({"ticker": h.ticker, "sector": sector, "industry": industry, "value": current})

        by_sector = (
            pd.DataFrame(rows).groupby("sector", as_index=False)["value"].sum() if rows else pd.DataFrame(columns=["sector", "value"])
        )
        by_industry = (
            pd.DataFrame(rows).groupby("industry", as_index=False)["value"].sum() if rows else pd.DataFrame(columns=["industry", "value"])
        )
        sectors = [
            {
                "sector": str(r["sector"]),
                "value": float(r["value"]),
                "weight_pct": (float(r["value"]) / total * 100.0) if total > 0 else 0.0,
            }
            for _, r in by_sector.sort_values("value", ascending=False).iterrows()
        ]
        industries = [
            {
                "industry": str(r["industry"]),
                "value": float(r["value"]),
                "weight_pct": (float(r["value"]) / total * 100.0) if total > 0 else 0.0,
            }
            for _, r in by_industry.sort_values("value", ascending=False).iterrows()
        ]
        return {"total_value": total, "sectors": sectors, "industries": industries}

    async def _portfolio_returns(self, holdings: Iterable[Holding], range_str: str = "1y") -> pd.Series:
        series: dict[str, pd.Series] = {}
        qty_map: dict[str, float] = {}
        for h in holdings:
            close = await self._close_series(h.ticker, range_str=range_str)
            if close.empty:
                continue
            series[h.ticker] = close
            qty_map[h.ticker] = float(h.quantity)
        if not series:
            return pd.Series(dtype="float64")
        df = pd.concat(series, axis=1).sort_index().ffill().dropna(how="all")
        weights = pd.Series({k: max(0.0, qty_map[k]) for k in df.columns}, dtype="float64")
        weights = weights / max(1e-12, float(weights.sum()))
        returns = df.pct_change().dropna(how="all").fillna(0.0)
        port = (returns * weights.reindex(returns.columns).fillna(0.0)).sum(axis=1)
        return port

    async def risk_metrics(self, holdings: Iterable[Holding], risk_free_rate: float = 0.06, benchmark: str = "NIFTY50") -> dict[str, Any]:
        port = await self._portfolio_returns(holdings, range_str="2y")
        if port.empty:
            return {
                "sharpe_ratio": 0.0,
                "sortino_ratio": 0.0,
                "max_drawdown": 0.0,
                "beta": 0.0,
                "alpha": 0.0,
                "information_ratio": 0.0,
            }
        bench_symbol = BENCHMARK_MAP.get(benchmark.upper(), benchmark)
        bench_close = await self._close_series(bench_symbol, range_str="2y")
        bench = bench_close.pct_change().dropna() if not bench_close.empty else pd.Series(dtype="float64")
        aligned = pd.concat([port, bench], axis=1, join="inner").dropna()
        if aligned.shape[0] >= 5:
            rp = aligned.iloc[:, 0]
            rb = aligned.iloc[:, 1]
        else:
            rp = port
            rb = pd.Series(dtype="float64")

        rf_daily = risk_free_rate / TRADING_DAYS
        excess = rp - rf_daily
        vol = float(rp.std())
        downside = rp[rp < rf_daily]
        downside_dev = float(downside.std()) if not downside.empty else 0.0

        sharpe = float((excess.mean() / vol) * math.sqrt(TRADING_DAYS)) if vol > 0 else 0.0
        sortino = float((excess.mean() / downside_dev) * math.sqrt(TRADING_DAYS)) if downside_dev > 0 else 0.0

        equity = (1.0 + rp).cumprod()
        drawdown = (equity / equity.cummax()) - 1.0
        max_dd = float(drawdown.min()) if not drawdown.empty else 0.0

        beta = 0.0
        alpha = 0.0
        info_ratio = 0.0
        if not rb.empty and float(rb.var()) > 0:
            cov = float(rp.cov(rb))
            var_b = float(rb.var())
            beta = cov / var_b if var_b else 0.0
            ann_rp = float(rp.mean()) * TRADING_DAYS
            ann_rb = float(rb.mean()) * TRADING_DAYS
            alpha = ann_rp - (risk_free_rate + beta * (ann_rb - risk_free_rate))
            active = rp - rb
            active_std = float(active.std())
            info_ratio = float((active.mean() / active_std) * math.sqrt(TRADING_DAYS)) if active_std > 0 else 0.0

        return {
            "sharpe_ratio": sharpe,
            "sortino_ratio": sortino,
            "max_drawdown": max_dd,
            "beta": beta,
            "alpha": alpha,
            "information_ratio": info_ratio,
        }

    async def correlation_matrix(self, holdings: Iterable[Holding], window: int = 60) -> dict[str, Any]:
        symbols: list[str] = []
        returns: list[pd.Series] = []
        for h in holdings:
            close = await self._close_series(h.ticker, range_str="1y")
            ret = close.pct_change().dropna()
            if ret.empty:
                continue
            symbols.append(h.ticker)
            returns.append(ret.rename(h.ticker))
        if not returns:
            return {"symbols": [], "matrix": [], "rolling": []}
        df = pd.concat(returns, axis=1).dropna(how="all").fillna(0.0)
        corr = df.corr().fillna(0.0)
        matrix = [
            [{"x": c, "y": i, "value": float(corr.loc[i, c])} for c in corr.columns]
            for i in corr.index
        ]
        rolling_rows: list[dict[str, Any]] = []
        if len(df) >= window and len(df.columns) >= 2:
            pairs: list[tuple[str, str]] = []
            cols = list(df.columns)
            for i in range(len(cols)):
                for j in range(i + 1, len(cols)):
                    pairs.append((cols[i], cols[j]))
            for a, b in pairs:
                roll = df[a].rolling(window).corr(df[b]).dropna()
                for idx, val in roll.items():
                    rolling_rows.append({"date": idx.date().isoformat(), "pair": f"{a}-{b}", "value": float(val)})
        return {"symbols": list(corr.columns), "matrix": matrix, "rolling": rolling_rows}

    async def dividend_tracker(self, holdings: Iterable[Holding], days: int = 180) -> dict[str, Any]:
        symbols = sorted({h.ticker.strip().upper() for h in holdings if h.ticker})
        qty = {h.ticker.strip().upper(): float(h.quantity) for h in holdings if h.ticker}
        events = await corporate_actions_service.get_portfolio_events(symbols, days_ahead=max(1, days))
        dividends = [e for e in events if str(e.event_type).lower() == "dividend"]
        rows: list[dict[str, Any]] = []
        annual_income = 0.0
        for evt in dividends:
            q = qty.get(evt.symbol.upper(), 0.0)
            amt = 0.0
            raw_value = str(evt.value or "").strip()
            try:
                amt = float(raw_value.replace("INR", "").replace(",", "").strip())
            except Exception:
                amt = 0.0
            projected = amt * q
            annual_income += projected
            rows.append(
                {
                    "symbol": evt.symbol,
                    "event_date": evt.event_date,
                    "ex_date": evt.ex_date,
                    "payment_date": evt.payment_date,
                    "dividend_per_share": amt,
                    "position_qty": q,
                    "projected_income": projected,
                    "title": evt.title,
                }
            )

        for h in holdings:
            snap = await fetch_stock_snapshot_coalesced(h.ticker)
            div_yield = snap.get("div_yield_pct")
            if isinstance(div_yield, (int, float)) and isinstance(snap.get("current_price"), (int, float)):
                annual_income += float(h.quantity) * float(snap["current_price"]) * (float(div_yield) / 100.0)

        rows.sort(key=lambda x: (x.get("ex_date") or x.get("event_date") or ""))
        return {"upcoming": rows, "annual_income_projection": annual_income}

    async def benchmark_overlay(self, holdings: Iterable[Holding], benchmark: str = "NIFTY50") -> dict[str, Any]:
        symbols = [h.ticker for h in holdings]
        buy_dates = {h.ticker: h.buy_date for h in holdings}
        quantities = {h.ticker: float(h.quantity) for h in holdings}
        frames: dict[str, pd.Series] = {}
        for symbol in symbols:
            s = await self._close_series(symbol, range_str="5y")
            if not s.empty:
                frames[symbol] = s
        if not frames:
            return {"equity_curve": [], "alpha": 0.0, "tracking_error": 0.0, "benchmark": benchmark}

        price_df = pd.concat(frames, axis=1).sort_index().ffill().dropna(how="all")
        portfolio_values = pd.Series(0.0, index=price_df.index)
        for symbol in price_df.columns:
            qty = quantities.get(symbol, 0.0)
            buy_dt = pd.Timestamp(f"{buy_dates.get(symbol, '1900-01-01')}T00:00:00Z")
            mask = price_df.index >= buy_dt
            portfolio_values.loc[mask] = portfolio_values.loc[mask] + price_df.loc[mask, symbol] * qty

        portfolio_values = portfolio_values.replace(0, pd.NA).ffill().dropna()
        if portfolio_values.empty:
            return {"equity_curve": [], "alpha": 0.0, "tracking_error": 0.0, "benchmark": benchmark}

        bench_symbol = BENCHMARK_MAP.get(benchmark.upper(), benchmark)
        bench_close = await self._close_series(bench_symbol, range_str="5y")
        bench_close = bench_close.reindex(portfolio_values.index).ffill().dropna()
        if bench_close.empty:
            bench_norm = pd.Series(1.0, index=portfolio_values.index)
        else:
            bench_norm = bench_close / float(bench_close.iloc[0])

        port_norm = portfolio_values / float(portfolio_values.iloc[0])
        port_ret = port_norm.pct_change().dropna()
        bench_ret = bench_norm.pct_change().dropna()
        aligned = pd.concat([port_ret, bench_ret], axis=1).dropna()
        alpha = float((aligned.iloc[:, 0].mean() - aligned.iloc[:, 1].mean()) * TRADING_DAYS) if not aligned.empty else 0.0
        tracking_error = float((aligned.iloc[:, 0] - aligned.iloc[:, 1]).std() * math.sqrt(TRADING_DAYS)) if not aligned.empty else 0.0

        curve = [
            {
                "date": idx.date().isoformat(),
                "portfolio": float(port_norm.loc[idx]),
                "benchmark": float(bench_norm.loc[idx]) if idx in bench_norm.index else 1.0,
            }
            for idx in port_norm.index
        ]
        return {
            "benchmark": benchmark,
            "equity_curve": curve,
            "alpha": alpha,
            "tracking_error": tracking_error,
        }

    async def _load_portfolio_attribution_context(
        self,
        db: Session,
        portfolio_id: str,
        period: str,
        benchmark: str,
    ) -> dict[str, Any]:
        period_label = _normalize_period(period)
        range_str = PORTFOLIO_PERIOD_RANGE_MAP[period_label]
        requested_benchmark = str(benchmark or "").strip().upper() or "NIFTY50"

        portfolio_key = str(portfolio_id or "").strip()
        if portfolio_key.lower() in {"", "current", "legacy", "default"}:
            holdings_rows = list(db.query(Holding).all())
            if not holdings_rows:
                return {
                    "portfolio_id": "current",
                    "portfolio_name": "Current Portfolio",
                    "benchmark": requested_benchmark,
                    "period": period_label,
                    "holdings": [],
                    "portfolio_return": 0.0,
                    "benchmark_return": 0.0,
                }
            benchmark_symbol = BENCHMARK_MAP.get(requested_benchmark, requested_benchmark)
            holdings: list[dict[str, Any]] = []
            symbols = [str(row.ticker).strip().upper() for row in holdings_rows if str(row.ticker).strip()]
            snapshot_tasks = {symbol: asyncio.create_task(fetch_stock_snapshot_coalesced(symbol)) for symbol in symbols}
            series_tasks = {symbol: asyncio.create_task(self._close_series(symbol, range_str=range_str)) for symbol in symbols}
            benchmark_task = asyncio.create_task(self._close_series(benchmark_symbol, range_str=range_str))
            snapshots = {symbol: await task for symbol, task in snapshot_tasks.items()}
            series_map = {symbol: await task for symbol, task in series_tasks.items()}
            benchmark_close = await benchmark_task
            benchmark_return = _series_return(benchmark_close)
            total_value = 0.0
            for row in holdings_rows:
                symbol = str(row.ticker).strip().upper()
                snap = snapshots.get(symbol, {})
                close = series_map.get(symbol, pd.Series(dtype="float64"))
                period_return = _series_return(close)
                price = snap.get("current_price")
                current_price = float(price) if isinstance(price, (int, float)) else float(row.avg_buy_price)
                current_value = max(0.0, float(row.quantity)) * current_price
                total_value += current_value
                sector = str(snap.get("sector") or snap.get("industry") or "Unknown").strip() or "Unknown"
                holdings.append(
                    {
                        "symbol": symbol,
                        "sector": sector,
                        "weight": 0.0,
                        "return": period_return,
                        "current_value": current_value,
                        "market_cap": float(snap.get("market_cap") or 0.0) if isinstance(snap.get("market_cap"), (int, float)) else 0.0,
                        "pe_ratio": float(snap.get("pe_ratio") or 0.0) if isinstance(snap.get("pe_ratio"), (int, float)) else 0.0,
                        "roe_pct": float(snap.get("roe_pct") or 0.0) if isinstance(snap.get("roe_pct"), (int, float)) else 0.0,
                        "beta": float(snap.get("beta") or 0.0) if isinstance(snap.get("beta"), (int, float)) else 0.0,
                        "quality": float(snap.get("roe_pct") or 0.0) / 100.0 if isinstance(snap.get("roe_pct"), (int, float)) else 0.0,
                    }
                )

            if total_value > 0:
                for row in holdings:
                    row["weight"] = float(row["current_value"]) / total_value
            else:
                weight = 1.0 / len(holdings) if holdings else 0.0
                for row in holdings:
                    row["weight"] = weight

            portfolio_return = sum(float(row["weight"]) * float(row["return"]) for row in holdings)
            return {
                "portfolio_id": "current",
                "portfolio_name": "Current Portfolio",
                "benchmark": requested_benchmark,
                "period": period_label,
                "holdings": holdings,
                "portfolio_return": portfolio_return,
                "benchmark_return": benchmark_return,
            }

        try:
            portfolio = db.query(PortfolioORM).filter(PortfolioORM.id == portfolio_key).first()
        except OperationalError:
            init_db()
            portfolio = db.query(PortfolioORM).filter(PortfolioORM.id == portfolio_key).first()
        if portfolio is None:
            raise ValueError("Portfolio not found")

        try:
            rows = db.query(PortfolioHoldingORM).filter(PortfolioHoldingORM.portfolio_id == portfolio_key).all()
        except OperationalError:
            init_db()
            rows = db.query(PortfolioHoldingORM).filter(PortfolioHoldingORM.portfolio_id == portfolio_key).all()

        benchmark_symbol = BENCHMARK_MAP.get((requested_benchmark or "").upper(), requested_benchmark) or portfolio.benchmark_symbol or "NIFTY50"
        symbols = [str(row.symbol).strip().upper() for row in rows if str(row.symbol).strip()]
        snapshot_tasks = {symbol: asyncio.create_task(fetch_stock_snapshot_coalesced(symbol)) for symbol in symbols}
        series_tasks = {symbol: asyncio.create_task(self._close_series(symbol, range_str=range_str)) for symbol in symbols}
        benchmark_task = asyncio.create_task(self._close_series(benchmark_symbol, range_str=range_str))
        snapshots = {symbol: await task for symbol, task in snapshot_tasks.items()}
        series_map = {symbol: await task for symbol, task in series_tasks.items()}
        benchmark_close = await benchmark_task
        benchmark_return = _series_return(benchmark_close)

        holdings: list[dict[str, Any]] = []
        total_value = 0.0
        for row in rows:
            symbol = str(row.symbol).strip().upper()
            snap = snapshots.get(symbol, {})
            close = series_map.get(symbol, pd.Series(dtype="float64"))
            period_return = _series_return(close)
            price = snap.get("current_price")
            current_price = float(price) if isinstance(price, (int, float)) else float(row.cost_basis_per_share)
            current_value = max(0.0, float(row.shares)) * current_price
            total_value += current_value
            sector = str(snap.get("sector") or snap.get("industry") or "Unknown").strip() or "Unknown"
            holdings.append(
                {
                    "symbol": symbol,
                    "sector": sector,
                    "weight": 0.0,
                    "return": period_return,
                    "current_value": current_value,
                    "market_cap": float(snap.get("market_cap") or 0.0) if isinstance(snap.get("market_cap"), (int, float)) else 0.0,
                    "pe_ratio": float(snap.get("pe_ratio") or 0.0) if isinstance(snap.get("pe_ratio"), (int, float)) else 0.0,
                    "roe_pct": float(snap.get("roe_pct") or 0.0) if isinstance(snap.get("roe_pct"), (int, float)) else 0.0,
                    "beta": float(snap.get("beta") or 0.0) if isinstance(snap.get("beta"), (int, float)) else 0.0,
                    "quality": float(snap.get("roe_pct") or 0.0) / 100.0 if isinstance(snap.get("roe_pct"), (int, float)) else 0.0,
                }
            )

        if total_value > 0:
            for row in holdings:
                row["weight"] = float(row["current_value"]) / total_value
        else:
            weight = 1.0 / len(holdings) if holdings else 0.0
            for row in holdings:
                row["weight"] = weight

        portfolio_return = sum(float(row["weight"]) * float(row["return"]) for row in holdings)
        return {
            "portfolio_id": portfolio_key,
            "portfolio_name": str(portfolio.name),
            "benchmark": requested_benchmark,
            "period": period_label,
            "holdings": holdings,
            "portfolio_return": portfolio_return,
            "benchmark_return": benchmark_return,
        }

    async def portfolio_attribution(
        self,
        db: Session,
        portfolio_id: str,
        period: str = "1M",
        benchmark: str = "NIFTY50",
    ) -> dict[str, Any]:
        context = await self._load_portfolio_attribution_context(db, portfolio_id, period, benchmark)
        holdings = list(context.get("holdings") or [])
        portfolio_total_return = float(context.get("portfolio_return") or 0.0)
        benchmark_total_return = float(context.get("benchmark_return") or 0.0)
        period_label = str(context.get("period") or _normalize_period(period))
        benchmark_label = str(context.get("benchmark") or benchmark or "NIFTY50")

        sector_rows: dict[str, dict[str, float]] = {}
        for row in holdings:
            sector = str(row.get("sector") or "Unknown").strip() or "Unknown"
            bucket = sector_rows.setdefault(sector, {"portfolio_value": 0.0, "return_numer": 0.0})
            value = max(0.0, float(row.get("current_value") or 0.0))
            bucket["portfolio_value"] += value
            bucket["return_numer"] += value * float(row.get("return") or 0.0)

        sector_names = sorted(sector_rows.keys())
        if not sector_names:
            return {
                "portfolio_id": context.get("portfolio_id") or portfolio_id,
                "portfolio_name": context.get("portfolio_name") or "Portfolio",
                "period": period_label,
                "benchmark": benchmark_label,
                "total_return": 0.0,
                "benchmark_return": 0.0,
                "active_return": 0.0,
                "brinson": {
                    "sectors": [],
                    "total_allocation": 0.0,
                    "total_selection": 0.0,
                    "total_interaction": 0.0,
                    "check_sum": 0.0,
                },
                "factors": {
                    "exposures": {factor: 0.0 for factor in FACTOR_NAMES},
                    "factor_returns": {factor: 0.0 for factor in FACTOR_NAMES},
                    "contributions": {factor: 0.0 for factor in FACTOR_NAMES},
                    "alpha": 0.0,
                    "check_sum": 0.0,
                },
            }

        portfolio_weights = {
            sector: (bucket["portfolio_value"] / sum(bucket["portfolio_value"] for bucket in sector_rows.values())) if sum(bucket["portfolio_value"] for bucket in sector_rows.values()) > 0 else 1.0 / len(sector_names)
            for sector, bucket in sector_rows.items()
        }
        portfolio_returns = {
            sector: (bucket["return_numer"] / bucket["portfolio_value"] if bucket["portfolio_value"] > 0 else 0.0)
            for sector, bucket in sector_rows.items()
        }
        benchmark_weights = {sector: 1.0 / len(sector_names) for sector in sector_names}
        raw_tilts = {sector: 0.35 * (portfolio_returns.get(sector, 0.0) - portfolio_total_return) for sector in sector_names}
        weighted_tilt = sum(benchmark_weights[sector] * raw_tilts[sector] for sector in sector_names)
        benchmark_returns = {
            sector: benchmark_total_return + raw_tilts[sector] - weighted_tilt
            for sector in sector_names
        }

        brinson = compute_brinson_attribution(
            portfolio_weights=portfolio_weights,
            benchmark_weights=benchmark_weights,
            portfolio_returns=portfolio_returns,
            benchmark_returns=benchmark_returns,
            sector_map={sector: sector for sector in sector_names},
        )

        factor_exposures: dict[str, dict[str, float]] = {}
        for row in holdings:
            symbol = str(row.get("symbol") or "").strip().upper()
            if not symbol:
                continue
            market_cap = max(0.0, float(row.get("market_cap") or 0.0))
            pe_ratio = max(0.0, float(row.get("pe_ratio") or 0.0))
            roe_pct = float(row.get("roe_pct") or 0.0)
            beta = float(row.get("beta") or 0.0)
            momentum = float(row.get("return") or 0.0)
            size_exposure = 0.0 if market_cap <= 0 else 1.0 / max(1.0, math.log10(market_cap))
            value_exposure = 0.0 if pe_ratio <= 0 else 1.0 / pe_ratio
            quality_exposure = roe_pct / 100.0
            volatility_exposure = beta if beta else abs(momentum)
            factor_exposures[symbol] = {
                "Market": 1.0,
                "Size": size_exposure,
                "Value": value_exposure,
                "Momentum": momentum,
                "Quality": quality_exposure,
                "Volatility": volatility_exposure,
            }

        factor_returns = {
            "Market": benchmark_total_return,
            "Size": 0.004,
            "Value": 0.003,
            "Momentum": 0.005,
            "Quality": 0.0025,
            "Volatility": -0.002,
        }
        factors = compute_factor_attribution(
            holdings=holdings,
            factor_exposures=factor_exposures,
            factor_returns=factor_returns,
            target_return=portfolio_total_return,
        )

        return {
            "portfolio_id": context.get("portfolio_id") or portfolio_id,
            "portfolio_name": context.get("portfolio_name") or "Portfolio",
            "period": period_label,
            "benchmark": benchmark_label,
            "total_return": portfolio_total_return,
            "benchmark_return": benchmark_total_return,
            "active_return": portfolio_total_return - benchmark_total_return,
            "brinson": brinson,
            "factors": factors,
        }

    def list_tax_lots(self, db: Session, ticker: str | None = None) -> list[TaxLot]:
        try:
            q = db.query(TaxLot)
            if ticker:
                q = q.filter(TaxLot.ticker == ticker.strip().upper())
            return q.order_by(TaxLot.buy_date.asc(), TaxLot.id.asc()).all()
        except OperationalError:
            init_db()
            q = db.query(TaxLot)
            if ticker:
                q = q.filter(TaxLot.ticker == ticker.strip().upper())
            return q.order_by(TaxLot.buy_date.asc(), TaxLot.id.asc()).all()

    def add_tax_lot(self, db: Session, ticker: str, quantity: float, buy_price: float, buy_date: str) -> TaxLot:
        row = TaxLot(
            ticker=ticker.strip().upper(),
            quantity=float(quantity),
            remaining_quantity=float(quantity),
            buy_price=float(buy_price),
            buy_date=buy_date,
        )
        db.add(row)
        try:
            db.commit()
        except OperationalError:
            db.rollback()
            init_db()
            db.add(row)
            db.commit()
        db.refresh(row)
        return row

    def _ordered_lots(self, lots: list[TaxLot], method: str, specific_lot_ids: list[int] | None = None) -> list[TaxLot]:
        active = [x for x in lots if float(x.remaining_quantity) > 0]
        m = method.upper()
        if m == "FIFO":
            return sorted(active, key=lambda x: (x.buy_date, x.id))
        if m == "LIFO":
            return sorted(active, key=lambda x: (x.buy_date, x.id), reverse=True)
        if m == "SPECIFIC":
            order = specific_lot_ids or []
            rank = {lot_id: idx for idx, lot_id in enumerate(order)}
            tagged = [x for x in active if x.id in rank]
            tagged.sort(key=lambda x: rank[x.id])
            return tagged
        return sorted(active, key=lambda x: (x.buy_date, x.id))

    def realize_tax_lots(
        self,
        db: Session,
        ticker: str,
        sell_quantity: float,
        sell_price: float,
        sell_date: str,
        method: str,
        specific_lot_ids: list[int] | None = None,
    ) -> dict[str, Any]:
        symbol = ticker.strip().upper()
        lots = self.list_tax_lots(db, symbol)
        ordered = self._ordered_lots(lots, method, specific_lot_ids)
        remaining = float(sell_quantity)
        sell_dt = datetime.fromisoformat(sell_date).date() if "T" in sell_date else date.fromisoformat(sell_date)
        lines: list[TaxRealizationLine] = []

        for lot in ordered:
            if remaining <= 0:
                break
            available = float(lot.remaining_quantity)
            if available <= 0:
                continue
            take = min(remaining, available)
            buy_dt = datetime.fromisoformat(lot.buy_date).date() if "T" in lot.buy_date else date.fromisoformat(lot.buy_date)
            holding_days = max(0, (sell_dt - buy_dt).days)
            period = "long_term" if holding_days > 365 else "short_term"
            gain = (float(sell_price) - float(lot.buy_price)) * take
            lines.append(
                TaxRealizationLine(
                    lot_id=int(lot.id),
                    ticker=symbol,
                    quantity=take,
                    buy_price=float(lot.buy_price),
                    sell_price=float(sell_price),
                    buy_date=lot.buy_date,
                    sell_date=sell_date,
                    holding_days=holding_days,
                    holding_period=period,
                    realized_gain=gain,
                )
            )
            lot.remaining_quantity = max(0.0, available - take)
            remaining -= take

        if remaining > 1e-9:
            raise ValueError("Insufficient lot quantity for requested sale")

        db.commit()

        stcg = sum(x.realized_gain for x in lines if x.holding_period == "short_term")
        ltcg = sum(x.realized_gain for x in lines if x.holding_period == "long_term")
        return {
            "symbol": symbol,
            "method": method.upper(),
            "sell_quantity": float(sell_quantity),
            "sell_price": float(sell_price),
            "sell_date": sell_date,
            "realizations": [x.__dict__ for x in lines],
            "realized_gain_total": stcg + ltcg,
            "short_term_gain": stcg,
            "long_term_gain": ltcg,
        }

    async def tax_lot_summary(self, db: Session, ticker: str | None = None) -> dict[str, Any]:
        lots = self.list_tax_lots(db, ticker)
        symbols = sorted({x.ticker for x in lots})
        current_prices: dict[str, float] = {}
        for s in symbols:
            snap = await fetch_stock_snapshot_coalesced(s)
            px = snap.get("current_price")
            if isinstance(px, (int, float)):
                current_prices[s] = float(px)

        unrealized = 0.0
        rows: list[dict[str, Any]] = []
        for lot in lots:
            remaining = float(lot.remaining_quantity)
            current = current_prices.get(lot.ticker)
            gain = ((current - float(lot.buy_price)) * remaining) if current is not None else None
            if gain is not None:
                unrealized += gain
            rows.append(
                {
                    "id": lot.id,
                    "ticker": lot.ticker,
                    "quantity": float(lot.quantity),
                    "remaining_quantity": remaining,
                    "buy_price": float(lot.buy_price),
                    "buy_date": lot.buy_date,
                    "current_price": current,
                    "unrealized_gain": gain,
                }
            )

        return {"lots": rows, "unrealized_gain_total": unrealized}


portfolio_analytics_service = PortfolioAnalyticsService()
