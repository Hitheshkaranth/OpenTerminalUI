from __future__ import annotations

import asyncio
from datetime import datetime, date
from uuid import uuid4

import numpy as np
import pandas as pd
from fastapi import HTTPException

from backend.api.deps import get_db
from backend.core.historical_data_service import get_historical_data_service
from backend.model_lab.metrics import compute_run_metrics
from backend.models import (
    PortfolioDefinition,
    PortfolioRun,
    PortfolioRunMatrices,
    PortfolioRunMetrics,
    PortfolioRunTimeseries,
    StrategyBlend,
)
from backend.portfolio_lab.engine import run_portfolio_engine
from backend.portfolio_lab.schemas import PortfolioDefinitionCreate, StrategyBlendCreate
from backend.services.backtest_jobs import BacktestJobRequest, get_backtest_job_service
from backend.shared.cache import cache


class PortfolioLabService:
    def __init__(self) -> None:
        self.max_assets = 200
        self.max_strategies = 10
        self.max_days = 3653

    @staticmethod
    def _summary(row: PortfolioDefinition) -> dict:
        return {
            "id": row.id,
            "name": row.name,
            "description": row.description,
            "tags": list(row.tags or []),
            "benchmark_symbol": row.benchmark_symbol,
            "start_date": row.start_date,
            "end_date": row.end_date,
            "rebalance_frequency": row.rebalance_frequency,
            "weighting_method": row.weighting_method,
            "created_at": row.created_at,
        }

    @staticmethod
    def _run_summary(row: PortfolioRun) -> dict:
        return {
            "run_id": row.id,
            "portfolio_id": row.portfolio_id,
            "blend_id": row.blend_id,
            "status": row.status,
            "started_at": row.started_at,
            "finished_at": row.finished_at,
            "error": row.error,
        }

    @staticmethod
    def _report_cache_key(run_id: str) -> str:
        return f"portfolio-lab:report:{run_id}"

    @staticmethod
    def _parse_date(value: str) -> date:
        return datetime.strptime(value, "%Y-%m-%d").date()

    async def create_portfolio(self, payload: PortfolioDefinitionCreate) -> dict:
        db = next(get_db())
        try:
            row = PortfolioDefinition(
                id=str(uuid4()),
                name=payload.name,
                description=payload.description,
                tags=payload.tags,
                universe_json=payload.universe_json,
                benchmark_symbol=payload.benchmark_symbol,
                start_date=payload.start_date,
                end_date=payload.end_date,
                rebalance_frequency=payload.rebalance_frequency,
                weighting_method=payload.weighting_method,
                constraints_json=payload.constraints_json,
                created_at=datetime.utcnow().isoformat(),
            )
            db.add(row)
            db.commit()
            return self._summary(row)
        finally:
            db.close()

    async def list_portfolios(self, tag: str | None = None, weighting_method: str | None = None) -> list[dict]:
        db = next(get_db())
        try:
            query = db.query(PortfolioDefinition)
            if weighting_method:
                query = query.filter(PortfolioDefinition.weighting_method == weighting_method)
            rows = query.order_by(PortfolioDefinition.created_at.desc()).all()
            out: list[dict] = []
            for row in rows:
                tags = [str(item) for item in (row.tags or [])]
                if tag and tag not in tags:
                    continue
                out.append(self._summary(row))
            return out
        finally:
            db.close()

    async def get_portfolio(self, portfolio_id: str) -> dict:
        db = next(get_db())
        try:
            row = db.query(PortfolioDefinition).filter(PortfolioDefinition.id == portfolio_id).first()
            if row is None:
                raise HTTPException(status_code=404, detail="Portfolio not found")
            runs = db.query(PortfolioRun).filter(PortfolioRun.portfolio_id == portfolio_id).order_by(PortfolioRun.started_at.desc()).all()
            return {
                **self._summary(row),
                "universe_json": row.universe_json or {},
                "constraints_json": row.constraints_json or {},
                "runs": [self._run_summary(run) for run in runs],
            }
        finally:
            db.close()

    async def create_blend(self, payload: StrategyBlendCreate) -> dict:
        if len(payload.strategies_json) > self.max_strategies:
            raise HTTPException(status_code=400, detail=f"Blend strategy count exceeds limit {self.max_strategies}")
        db = next(get_db())
        try:
            row = StrategyBlend(
                id=str(uuid4()),
                name=payload.name,
                strategies_json=payload.strategies_json,
                blend_method=payload.blend_method,
                created_at=datetime.utcnow().isoformat(),
            )
            db.add(row)
            db.commit()
            return {
                "id": row.id,
                "name": row.name,
                "strategies_json": row.strategies_json or [],
                "blend_method": row.blend_method,
                "created_at": row.created_at,
            }
        finally:
            db.close()

    async def list_blends(self) -> list[dict]:
        db = next(get_db())
        try:
            rows = db.query(StrategyBlend).order_by(StrategyBlend.created_at.desc()).all()
            return [
                {
                    "id": row.id,
                    "name": row.name,
                    "strategies_json": row.strategies_json or [],
                    "blend_method": row.blend_method,
                    "created_at": row.created_at,
                }
                for row in rows
            ]
        finally:
            db.close()

    async def _wait_for_backtest(self, backtest_run_id: str, timeout_seconds: float = 180.0) -> dict:
        deadline = asyncio.get_event_loop().time() + timeout_seconds
        while asyncio.get_event_loop().time() < deadline:
            result = await get_backtest_job_service().get_result(backtest_run_id)
            status = str(result.get("status", ""))
            if status in {"done", "failed", "not_found"}:
                return result
            await asyncio.sleep(0.4)
        raise HTTPException(status_code=504, detail="Backtest timed out")

    @staticmethod
    def _daily_returns_from_backtest(payload: dict) -> pd.DataFrame:
        equity_curve = payload.get("equity_curve") or []
        if not equity_curve:
            return pd.DataFrame(columns=["date", "ret"])
        frame = pd.DataFrame(equity_curve)
        if "date" not in frame.columns or "equity" not in frame.columns:
            return pd.DataFrame(columns=["date", "ret"])
        frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
        frame["equity"] = pd.to_numeric(frame["equity"], errors="coerce")
        frame = frame.dropna(subset=["date", "equity"]).sort_values("date")
        frame["ret"] = frame["equity"].pct_change().fillna(0.0)
        return frame[["date", "ret"]]

    async def _asset_strategy_returns(
        self,
        asset: str,
        strategies: list[dict],
        *,
        start: str,
        end: str,
    ) -> pd.Series:
        weighted_frames: list[pd.DataFrame] = []
        weights = np.array([float(item.get("weight", 1.0) or 1.0) for item in strategies], dtype=float)
        if weights.size == 0:
            weights = np.array([1.0], dtype=float)
        weights = np.clip(weights, 0.0, None)
        if np.sum(weights) <= 0:
            weights = np.ones_like(weights)
        weights = weights / np.sum(weights)

        for idx, strategy in enumerate(strategies):
            model_key = str(strategy.get("model_key", "sma_crossover")).strip()
            strat = model_key if ":" in model_key else f"example:{model_key}"
            context = strategy.get("params_json") if isinstance(strategy.get("params_json"), dict) else {}

            backtest_run_id = await get_backtest_job_service().submit(
                BacktestJobRequest(
                    symbol=asset,
                    asset=asset,
                    market="NSE",
                    start=start,
                    end=end,
                    strategy=strat,
                    context=context,
                    config={"initial_cash": 100000.0, "position_fraction": 1.0},
                )
            )
            result = await self._wait_for_backtest(backtest_run_id)
            if str(result.get("status")) != "done":
                continue
            payload = result.get("result") or {}
            frame = self._daily_returns_from_backtest(payload)
            if frame.empty:
                continue
            frame = frame.rename(columns={"ret": f"ret_{idx}"})
            weighted_frames.append(frame)

        if not weighted_frames:
            return pd.Series(dtype=float)

        merged = weighted_frames[0]
        for frame in weighted_frames[1:]:
            merged = merged.merge(frame, on="date", how="inner")
        if merged.empty:
            return pd.Series(dtype=float)

        cols = [column for column in merged.columns if column.startswith("ret_")]
        active_weights = weights[: len(cols)]
        if np.sum(active_weights) <= 0:
            active_weights = np.ones(len(cols), dtype=float)
        active_weights = active_weights / np.sum(active_weights)

        merged["blend_ret"] = np.sum(merged[cols].to_numpy(dtype=float) * active_weights, axis=1)
        series = pd.Series(merged["blend_ret"].to_numpy(dtype=float), index=pd.to_datetime(merged["date"], errors="coerce"))
        return series.sort_index()

    @staticmethod
    def _compute_worst_drawdowns(equity: pd.Series) -> list[dict]:
        if equity.empty:
            return []
        peaks = equity.cummax()
        dd = (equity - peaks) / peaks.replace(0.0, np.nan)
        dd = dd.fillna(0.0)
        rows = [{"date": idx.date().isoformat(), "drawdown": float(val)} for idx, val in dd.items()]
        rows.sort(key=lambda item: item["drawdown"])
        return rows[:10]

    @staticmethod
    def _monthly_heatmap(portfolio_returns: pd.Series) -> list[dict]:
        if portfolio_returns.empty:
            return []
        frame = portfolio_returns.to_frame("ret")
        monthly = (1.0 + frame["ret"]).resample("ME").prod() - 1.0
        out = []
        for idx, value in monthly.items():
            out.append({"year": int(idx.year), "month": int(idx.month), "return_pct": float(value * 100.0)})
        return out

    @staticmethod
    def _rolling(values: pd.Series, window: int) -> list[dict]:
        if values.empty:
            return []
        roll_mean = values.rolling(window).mean() * 252.0
        roll_vol = values.rolling(window).std(ddof=0) * np.sqrt(252.0)
        roll_sharpe = (roll_mean / roll_vol.replace(0.0, np.nan)).fillna(0.0)
        return [{"date": idx.date().isoformat(), "value": float(val)} for idx, val in roll_sharpe.dropna().items()]

    async def _benchmark_series(self, benchmark_symbol: str | None, start: str, end: str) -> pd.Series:
        if not benchmark_symbol:
            return pd.Series(dtype=float)
        try:
            symbol, bars = get_historical_data_service().fetch_daily_ohlcv(
                raw_symbol=benchmark_symbol,
                market="NSE",
                start=start,
                end=end,
                limit=4000,
            )
            del symbol
            if not bars:
                return pd.Series(dtype=float)
            frame = pd.DataFrame([{"date": b.date, "close": b.close} for b in bars])
            frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
            frame["close"] = pd.to_numeric(frame["close"], errors="coerce")
            frame = frame.dropna().sort_values("date")
            frame["ret"] = frame["close"].pct_change().fillna(0.0)
            return pd.Series(frame["ret"].to_numpy(dtype=float), index=frame["date"])
        except Exception:
            return pd.Series(dtype=float)

    async def _compute_report(self, portfolio: PortfolioDefinition, blend: StrategyBlend | None) -> tuple[dict, dict, dict, dict]:
        universe = portfolio.universe_json or {}
        tickers = [str(item).strip().upper() for item in (universe.get("tickers") or []) if str(item).strip()]
        tickers = list(dict.fromkeys(tickers))
        if not tickers:
            raise HTTPException(status_code=400, detail="Portfolio universe is empty")
        if len(tickers) > self.max_assets:
            raise HTTPException(status_code=400, detail=f"Universe exceeds max assets ({self.max_assets})")

        start = str(portfolio.start_date)
        end = str(portfolio.end_date)
        delta_days = (self._parse_date(end) - self._parse_date(start)).days
        if delta_days > self.max_days:
            raise HTTPException(status_code=400, detail="Lookback exceeds max window (10y)")

        strategies = [{"model_key": "sma_crossover", "params_json": {}, "weight": 1.0}]
        blend_id = None
        if blend is not None:
            strategies = list(blend.strategies_json or [])
            if not strategies:
                raise HTTPException(status_code=400, detail="Blend has no strategies")
            if len(strategies) > self.max_strategies:
                raise HTTPException(status_code=400, detail=f"Blend exceeds max strategies ({self.max_strategies})")
            blend_id = blend.id

        returns_frames: list[pd.Series] = []
        for asset in tickers:
            series = await self._asset_strategy_returns(asset, strategies, start=start, end=end)
            if series.empty:
                continue
            series.name = asset
            returns_frames.append(series)

        if not returns_frames:
            raise HTTPException(status_code=400, detail="No asset returns produced for portfolio")

        returns_df = pd.concat(returns_frames, axis=1, join="inner").dropna(how="any")
        if returns_df.empty:
            raise HTTPException(status_code=400, detail="No aligned returns available")

        constraints = portfolio.constraints_json or {}
        max_weight = float(constraints.get("max_weight", 0.25) or 0.25)
        cash_buffer = float(constraints.get("cash_buffer", 0.0) or 0.0)

        engine_out = run_portfolio_engine(
            returns_df,
            rebalance_frequency=portfolio.rebalance_frequency,
            weighting_method=portfolio.weighting_method,
            max_weight=max_weight,
            cash_buffer=cash_buffer,
            vol_window=int(constraints.get("vol_window", 20) or 20),
        )

        pr = pd.Series([float(item["return"]) for item in engine_out.returns_series], index=pd.to_datetime([item["date"] for item in engine_out.returns_series]))
        equity = (1.0 + pr).cumprod() * 100000.0

        benchmark_returns = await self._benchmark_series(portfolio.benchmark_symbol, start, end)
        benchmark_equity = pd.Series(dtype=float)
        if not benchmark_returns.empty:
            benchmark_returns = benchmark_returns.reindex(pr.index).fillna(0.0)
            benchmark_equity = (1.0 + benchmark_returns).cumprod() * 100000.0

        metrics = compute_run_metrics(
            equity_curve=[{"date": idx.date().isoformat(), "equity": float(val)} for idx, val in equity.items()],
            trades=[],
            benchmark_returns=benchmark_returns.to_list() if not benchmark_returns.empty else None,
        )
        metrics["turnover"] = float(np.mean([float(item.get("turnover", 0.0)) for item in engine_out.turnover_series])) if engine_out.turnover_series else 0.0

        peaks = equity.cummax()
        drawdown = (equity - peaks) / peaks.replace(0.0, np.nan)
        drawdown = drawdown.fillna(0.0)
        rolling_vol = pr.rolling(30).std(ddof=0).fillna(0.0) * np.sqrt(252.0)

        series = {
            "portfolio_equity": [{"date": idx.date().isoformat(), "value": float(val)} for idx, val in equity.items()],
            "benchmark_equity": [{"date": idx.date().isoformat(), "value": float(val)} for idx, val in benchmark_equity.items()] if not benchmark_equity.empty else [],
            "drawdown": [{"date": idx.date().isoformat(), "value": float(val)} for idx, val in drawdown.items()],
            "underwater": [{"date": idx.date().isoformat(), "value": float(val)} for idx, val in drawdown.items()],
            "exposure": [
                {
                    "date": row["date"],
                    "value": float(sum(abs(float(v)) for v in (row.get("weights") or {}).values())),
                }
                for row in engine_out.weights_over_time
            ],
            "leverage": [
                {
                    "date": row["date"],
                    "value": float(sum(abs(float(v)) for v in (row.get("weights") or {}).values())),
                }
                for row in engine_out.weights_over_time
            ],
            "returns": engine_out.returns_series,
            "weights_over_time": engine_out.weights_over_time,
            "turnover_series": engine_out.turnover_series,
            "contribution_series": engine_out.contribution_series,
            "rolling_sharpe_30": self._rolling(pr, 30),
            "rolling_sharpe_90": self._rolling(pr, 90),
            "rolling_volatility": [{"date": idx.date().isoformat(), "value": float(val)} for idx, val in rolling_vol.items()],
            "monthly_returns": self._monthly_heatmap(pr),
        }

        contrib_df = pd.DataFrame(engine_out.contribution_series)
        top_contrib: list[dict] = []
        detractors: list[dict] = []
        if not contrib_df.empty:
            cols = [column for column in contrib_df.columns if column != "date"]
            sums = {col: float(contrib_df[col].sum()) for col in cols}
            top = sorted(sums.items(), key=lambda item: item[1], reverse=True)[:10]
            low = sorted(sums.items(), key=lambda item: item[1])[:10]
            top_contrib = [{"asset": key, "contribution": value} for key, value in top]
            detractors = [{"asset": key, "contribution": value} for key, value in low]

        latest_weights = engine_out.weights_over_time[-1]["weights"] if engine_out.weights_over_time else {}

        tables = {
            "top_contributors": top_contrib,
            "top_detractors": detractors,
            "worst_drawdowns": self._compute_worst_drawdowns(equity),
            "rebalance_log": engine_out.turnover_series,
            "latest_weights": [{"asset": key, "weight": float(value)} for key, value in latest_weights.items()],
        }

        matrices = {
            "correlation": engine_out.correlation_matrix,
            "labels": engine_out.correlation_matrix.get("labels", []),
            "cluster_order": engine_out.correlation_matrix.get("cluster_order", []),
        }

        meta = {"blend_id": blend_id}
        return metrics, series, tables, matrices | meta

    async def run_portfolio(self, portfolio_id: str, blend_id: str | None, force_refresh: bool = False) -> dict:
        db = next(get_db())
        try:
            portfolio = db.query(PortfolioDefinition).filter(PortfolioDefinition.id == portfolio_id).first()
            if portfolio is None:
                raise HTTPException(status_code=404, detail="Portfolio not found")

            blend = None
            if blend_id:
                blend = db.query(StrategyBlend).filter(StrategyBlend.id == blend_id).first()
                if blend is None:
                    raise HTTPException(status_code=404, detail="Blend not found")

            run = PortfolioRun(
                id=str(uuid4()),
                portfolio_id=portfolio_id,
                blend_id=blend_id,
                status="running",
                started_at=datetime.utcnow().isoformat(),
            )
            db.add(run)
            db.commit()

            try:
                metrics, series, tables, matrices_with_meta = await self._compute_report(portfolio, blend)
                matrices = {
                    "correlation": matrices_with_meta.get("correlation", {}),
                    "labels": matrices_with_meta.get("labels", []),
                    "cluster_order": matrices_with_meta.get("cluster_order", []),
                }

                db.add(PortfolioRunMetrics(run_id=run.id, metrics_json=metrics))
                db.add(PortfolioRunTimeseries(run_id=run.id, series_json={**series, "tables": tables}))
                db.add(PortfolioRunMatrices(run_id=run.id, matrices_json=matrices))
                run.status = "succeeded"
                run.finished_at = datetime.utcnow().isoformat()
                run.error = None
                db.commit()
            except Exception as exc:
                run.status = "failed"
                run.finished_at = datetime.utcnow().isoformat()
                run.error = str(exc)
                db.commit()

            if force_refresh:
                await cache.set(self._report_cache_key(run.id), None, ttl=1)

            return self._run_summary(run)
        finally:
            db.close()

    async def get_run(self, run_id: str) -> dict:
        db = next(get_db())
        try:
            row = db.query(PortfolioRun).filter(PortfolioRun.id == run_id).first()
            if row is None:
                raise HTTPException(status_code=404, detail="Portfolio run not found")
            return self._run_summary(row)
        finally:
            db.close()

    async def get_report(self, run_id: str, force_refresh: bool = False) -> dict:
        cache_key = self._report_cache_key(run_id)
        if not force_refresh:
            cached = await cache.get(cache_key)
            if isinstance(cached, dict):
                return cached

        db = next(get_db())
        try:
            run = db.query(PortfolioRun).filter(PortfolioRun.id == run_id).first()
            if run is None:
                raise HTTPException(status_code=404, detail="Portfolio run not found")
            metrics_row = db.query(PortfolioRunMetrics).filter(PortfolioRunMetrics.run_id == run_id).first()
            series_row = db.query(PortfolioRunTimeseries).filter(PortfolioRunTimeseries.run_id == run_id).first()
            matrices_row = db.query(PortfolioRunMatrices).filter(PortfolioRunMatrices.run_id == run_id).first()

            metrics = metrics_row.metrics_json if metrics_row else {}
            series = series_row.series_json if series_row else {}
            tables = series.get("tables", {}) if isinstance(series, dict) else {}
            if isinstance(series, dict) and "tables" in series:
                series = {k: v for k, v in series.items() if k != "tables"}
            matrices = matrices_row.matrices_json if matrices_row else {}

            payload = {
                "run_id": run.id,
                "portfolio_id": run.portfolio_id,
                "blend_id": run.blend_id,
                "status": run.status,
                "metrics": metrics,
                "series": series,
                "tables": tables,
                "matrices": matrices,
            }
            await cache.set(cache_key, payload, ttl=300)
            return payload
        finally:
            db.close()


portfolio_lab_service = PortfolioLabService()


def get_portfolio_lab_service() -> PortfolioLabService:
    return portfolio_lab_service
