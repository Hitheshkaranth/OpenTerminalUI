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
