from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core import backtester
from backend.core.statlab import (
    forecast_series,
    cointegration_analysis,
    stationarity_tests,
    decompose_series,
    factor_regression,
    autocorrelation_analysis,
    granger_causality,
    regime_detection,
    list_methods,
)

router = APIRouter(prefix="/api/statlab", tags=["statlab"])


class ForecastRequest(BaseModel):
    ticker: str
    method: str = "arima"
    horizon: int = Field(30, ge=1, le=120)
    lookback_days: int = 730


class CointegrationRequest(BaseModel):
    ticker_a: str
    ticker_b: str
    lookback_days: int = 730
    entry_z: float = 2.0
    exit_z: float = 0.5


class StationarityRequest(BaseModel):
    ticker: str
    lookback_days: int = 730


class DecompositionRequest(BaseModel):
    ticker: str
    period: int = Field(21, ge=2, le=120)
    lookback_days: int = 730


class RegressionRequest(BaseModel):
    ticker: str
    benchmark: str = "^NSEI"
    lookback_days: int = 730
    rolling_window: int = Field(63, ge=20, le=252)


class AutocorrRequest(BaseModel):
    ticker: str
    nlags: int = Field(30, ge=5, le=60)
    use_returns: bool = True
    lookback_days: int = 730


class CausalityRequest(BaseModel):
    ticker_a: str
    ticker_b: str
    max_lag: int = Field(5, ge=1, le=15)
    lookback_days: int = 730


class RegimeRequest(BaseModel):
    ticker: str
    lookback_days: int = 1095


async def _get_series(ticker: str, lookback_days: int) -> "pd.Series":
    end = datetime.now()
    start = end - timedelta(days=lookback_days)
    
    # Run download in thread to avoid blocking event loop
    df = await asyncio.to_thread(
        backtester._download_close, [ticker], start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")
    )
    
    if df.empty or len(df) < 30:
        raise HTTPException(status_code=400, detail=f"Insufficient price data for {ticker}")
    
    series = df.iloc[:, 0].dropna()
    if len(series) < 30:
        raise HTTPException(status_code=400, detail=f"Insufficient price data for {ticker} after dropping NAs")
    
    return series


async def _get_pair(ticker_a: str, ticker_b: str, lookback_days: int):
    end = datetime.now()
    start = end - timedelta(days=lookback_days)
    df = await asyncio.to_thread(
        backtester._download_close, [ticker_a, ticker_b], start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")
    )
    if df.empty or len(df.columns) < 2:
        raise HTTPException(400, "Insufficient data for one or both tickers")
    df_clean = df.dropna()
    if len(df_clean) < 60:
        raise HTTPException(400, "Insufficient overlapping price data (need at least 60 rows)")

    # yfinance returns columns in alphabetical order, NOT the requested order, so
    # select by name to keep ticker_a/ticker_b (asset/benchmark) correctly assigned.
    # The download helper strips ".NS" and names columns by the base symbol.
    def _pick(symbol: str, fallback_pos: int):
        base = symbol.replace(".NS", "").upper()
        for col in df_clean.columns:
            if str(col).replace(".NS", "").upper() == base:
                return df_clean[col]
        return df_clean.iloc[:, fallback_pos]

    return _pick(ticker_a, 0), _pick(ticker_b, 1)


@router.get("/methods")
def get_methods():
    return list_methods()


@router.post("/forecast")
async def post_forecast(req: ForecastRequest):
    series = await _get_series(req.ticker, req.lookback_days)
    try:
        result = await asyncio.to_thread(
            forecast_series, series, method=req.method, horizon=req.horizon
        )
        return {**result, "ticker": req.ticker}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Statlab failed: {e}")


@router.post("/cointegration")
async def post_cointegration(req: CointegrationRequest):
    end = datetime.now()
    start = end - timedelta(days=req.lookback_days)
    
    df = await asyncio.to_thread(
        backtester._download_close, 
        [req.ticker_a, req.ticker_b], 
        start.strftime("%Y-%m-%d"), 
        end.strftime("%Y-%m-%d")
    )
    
    if df.empty or len(df.columns) < 2:
        raise HTTPException(status_code=400, detail="Insufficient data for one or both tickers")
    
    df_clean = df.dropna()
    if len(df_clean) < 30:
        raise HTTPException(status_code=400, detail="Insufficient overlapping price data (need at least 30 rows)")
    
    sa = df_clean.iloc[:, 0]
    sb = df_clean.iloc[:, 1]
    
    try:
        result = await asyncio.to_thread(
            cointegration_analysis, sa, sb, entry_z=req.entry_z, exit_z=req.exit_z
        )
        return {**result, "ticker_a": req.ticker_a, "ticker_b": req.ticker_b}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Statlab failed: {e}")


@router.post("/stationarity")
async def post_stationarity(req: StationarityRequest):
    series = await _get_series(req.ticker, req.lookback_days)
    try:
        result = await asyncio.to_thread(stationarity_tests, series)
        return {**result, "ticker": req.ticker}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Statlab failed: {e}")


@router.post("/decomposition")
async def post_decomposition(req: DecompositionRequest):
    series = await _get_series(req.ticker, req.lookback_days)
    try:
        result = await asyncio.to_thread(decompose_series, series, period=req.period)
        return {**result, "ticker": req.ticker}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Statlab failed: {e}")


@router.post("/regression")
async def post_regression(req: RegressionRequest):
    asset, bench = await _get_pair(req.ticker, req.benchmark, req.lookback_days)
    try:
        result = await asyncio.to_thread(
            factor_regression, asset, bench, rolling_window=req.rolling_window
        )
        return {**result, "ticker": req.ticker, "benchmark_ticker": req.benchmark}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Statlab failed: {e}")


@router.post("/autocorrelation")
async def post_autocorrelation(req: AutocorrRequest):
    series = await _get_series(req.ticker, req.lookback_days)
    try:
        result = await asyncio.to_thread(
            autocorrelation_analysis, series, nlags=req.nlags, use_returns=req.use_returns
        )
        return {**result, "ticker": req.ticker}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Statlab failed: {e}")


@router.post("/causality")
async def post_causality(req: CausalityRequest):
    sa, sb = await _get_pair(req.ticker_a, req.ticker_b, req.lookback_days)
    try:
        result = await asyncio.to_thread(
            granger_causality, sa, sb, max_lag=req.max_lag
        )
        return {**result, "ticker_a": req.ticker_a, "ticker_b": req.ticker_b}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Statlab failed: {e}")


@router.post("/regimes")
async def post_regimes(req: RegimeRequest):
    series = await _get_series(req.ticker, req.lookback_days)
    try:
        result = await asyncio.to_thread(regime_detection, series)
        return {**result, "ticker": req.ticker}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Statlab failed: {e}")
