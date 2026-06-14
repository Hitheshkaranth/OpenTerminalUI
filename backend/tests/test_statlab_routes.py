from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from backend.api.routes.statlab import router
from backend.core import backtester

app = FastAPI()
app.include_router(router)
client = TestClient(app)

@pytest.fixture
def mock_price_data(monkeypatch):
    dates = pd.bdate_range(start="2023-01-01", periods=400)
    symbols = ["AAPL", "MSFT", "GOOGL", "AMZN", "META"]
    np.random.seed(42)
    df = pd.DataFrame(
        np.random.randn(400, 5).cumsum(axis=0) + 100,
        index=dates,
        columns=symbols
    )
    
    def mock_download(tickers, start, end):
        valid_tickers = [t.replace(".NS", "") for t in tickers]
        cols = [c for c in df.columns if c in valid_tickers]
        return df[cols]

    monkeypatch.setattr(backtester, "_download_close", mock_download)
    return df

def test_get_methods():
    response = client.get("/api/statlab/methods")
    assert response.status_code == 200
    data = response.json()
    assert "forecast_methods" in data
    assert len(data["forecast_methods"]) > 0

def test_post_forecast(mock_price_data):
    payload = {
        "ticker": "AAPL",
        "method": "arima",
        "horizon": 30,
        "lookback_days": 730
    }
    response = client.post("/api/statlab/forecast", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["ticker"] == "AAPL"
    assert "history" in data
    assert "forecast" in data
    assert len(data["history"]) > 0
    assert len(data["forecast"]) > 0

def test_post_cointegration(mock_price_data):
    payload = {
        "ticker_a": "AAPL",
        "ticker_b": "MSFT",
        "lookback_days": 730,
        "entry_z": 2.0,
        "exit_z": 0.5
    }
    response = client.post("/api/statlab/cointegration", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["ticker_a"] == "AAPL"
    assert data["ticker_b"] == "MSFT"
    assert "coint_pvalue" in data
    assert "series" in data
    assert len(data["series"]) > 0

def test_post_stationarity(mock_price_data):
    payload = {
        "ticker": "AAPL",
        "lookback_days": 730
    }
    response = client.post("/api/statlab/stationarity", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["ticker"] == "AAPL"
    assert "adf" in data
    assert "hurst" in data

def test_post_decomposition(mock_price_data):
    payload = {
        "ticker": "AAPL",
        "period": 21,
        "lookback_days": 730
    }
    response = client.post("/api/statlab/decomposition", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["ticker"] == "AAPL"
    assert "series" in data
    assert len(data["series"]) > 0
    first = data["series"][0]
    assert "observed" in first
    assert "trend" in first
    assert "seasonal" in first
    assert "resid" in first

def test_insufficient_data(mock_price_data):
    # Mock download returning empty df
    with patch("backend.core.backtester._download_close", return_value=pd.DataFrame()):
        payload = {"ticker": "INVALID"}
        response = client.post("/api/statlab/forecast", json=payload)
        assert response.status_code == 400
        assert "Insufficient price data" in response.json()["detail"]


def test_post_regression(mock_price_data):
    payload = {
        "ticker": "AAPL",
        "benchmark": "MSFT",
        "lookback_days": 730,
        "rolling_window": 63
    }
    response = client.post("/api/statlab/regression", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["ticker"] == "AAPL"
    assert data["benchmark_ticker"] == "MSFT"
    assert "beta" in data
    assert "alpha_annual" in data
    assert "r_squared" in data
    assert "rolling_beta" in data


def test_post_autocorrelation(mock_price_data):
    payload = {
        "ticker": "AAPL",
        "nlags": 20,
        "use_returns": True,
        "lookback_days": 730
    }
    response = client.post("/api/statlab/autocorrelation", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["ticker"] == "AAPL"
    assert "acf" in data
    assert "pacf" in data
    assert "ljung_box" in data
    assert len(data["acf"]) > 0


def test_post_causality(mock_price_data):
    payload = {
        "ticker_a": "AAPL",
        "ticker_b": "MSFT",
        "max_lag": 5,
        "lookback_days": 730
    }
    response = client.post("/api/statlab/causality", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["ticker_a"] == "AAPL"
    assert data["ticker_b"] == "MSFT"
    assert "a_to_b" in data
    assert "b_to_a" in data
    assert "lead" in data


def test_pair_column_order_is_request_order(mock_price_data):
    # yfinance returns columns alphabetically, not in requested order. Request the
    # pair "reversed" relative to the mock's column order and confirm the series are
    # mapped back to the requested ticker_a/ticker_b (not positionally swapped).
    payload = {"ticker_a": "MSFT", "ticker_b": "AAPL", "max_lag": 3}
    response = client.post("/api/statlab/causality", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["name_a"] == "MSFT"
    assert data["name_b"] == "AAPL"


def test_post_regimes(mock_price_data):
    payload = {
        "ticker": "AAPL",
        "lookback_days": 1095
    }
    response = client.post("/api/statlab/regimes", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["ticker"] == "AAPL"
    assert "current_regime" in data
    assert "series" in data
    assert "high_vol_regime" in data
