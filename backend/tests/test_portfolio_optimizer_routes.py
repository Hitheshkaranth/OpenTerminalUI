from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from backend.api.routes.portfolio_optimizer import router
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
        # Filter for requested tickers that are in our mock data
        valid_tickers = [t.replace(".NS", "") for t in tickers]
        # _download_close in backtester.py appends .NS and then strips it.
        # So we expect tickers to be passed as list of symbols.
        # Actually _download_close returns symbols without .NS.
        cols = [c for c in df.columns if c in valid_tickers]
        return df[cols]

    monkeypatch.setattr(backtester, "_download_close", mock_download)
    return df

def test_get_methods():
    response = client.get("/api/portfolio-optimizer/methods")
    assert response.status_code == 200
    data = response.json()
    assert "objectives" in data
    assert "risk_measures" in data
    assert "models" in data
    assert "covariance_methods" in data
    assert any(m["id"] == "RP" for m in data["models"])
    assert any(m["id"] == "NCO" for m in data["models"])
    assert len(data["covariance_methods"]) > 0

def test_optimize_classic_min_risk(mock_price_data):
    payload = {
        "tickers": ["AAPL", "MSFT", "GOOGL", "AMZN", "META"],
        "model": "Classic",
        "objective": "min_risk",
        "risk_measure": "MV"
    }
    response = client.post("/api/portfolio-optimizer/optimize", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "weights" in data
    assert sum(data["weights"].values()) == pytest.approx(1.0)
    assert "metrics" in data
    assert "volatility" in data["metrics"]
    assert "sharpe" in data["metrics"]
    assert "frontier" in data
    assert len(data["frontier"]) > 0
    assert "clusters" in data
    assert "groups" in data["clusters"]
    assert "leaf_order" in data["clusters"]
    assert "selected_point" in data
    assert "risk" in data["selected_point"]
    assert "return" in data["selected_point"]

def test_optimize_hrp(mock_price_data):
    payload = {
        "tickers": ["AAPL", "MSFT", "GOOGL", "AMZN", "META"],
        "model": "HRP"
    }
    response = client.post("/api/portfolio-optimizer/optimize", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "weights" in data
    assert sum(data["weights"].values()) == pytest.approx(1.0, abs=1e-5)
    assert "clusters" in data

def test_optimize_rp(mock_price_data):
    payload = {
        "tickers": ["AAPL", "MSFT", "GOOGL", "AMZN", "META"],
        "model": "RP"
    }
    response = client.post("/api/portfolio-optimizer/optimize", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "weights" in data
    assert sum(data["weights"].values()) == pytest.approx(1.0, abs=1e-5)
    assert "clusters" in data
    assert "groups" in data["clusters"]
    assert "leaf_order" in data["clusters"]

def test_optimize_classic_cov_method(mock_price_data):
    payload = {
        "tickers": ["AAPL", "MSFT", "GOOGL", "AMZN", "META"],
        "model": "Classic",
        "cov_method": "ledoit_wolf"
    }
    response = client.post("/api/portfolio-optimizer/optimize", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "weights" in data
    assert sum(data["weights"].values()) == pytest.approx(1.0, abs=1e-5)

def test_optimize_insufficient_data(mock_price_data):
    # Only 1 ticker triggers Pydantic min_length validation error (422)
    payload = {
        "tickers": ["AAPL"],
        "model": "Classic"
    }
    response = client.post("/api/portfolio-optimizer/optimize", json=payload)
    assert response.status_code == 422

def test_risk_report(mock_price_data):
    payload = {
        "tickers": ["AAPL", "MSFT", "GOOGL"],
        "weights": {"AAPL": 0.5, "MSFT": 0.5}
    }
    response = client.post("/api/portfolio-optimizer/risk-report", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "metrics" in data
    assert "drawdown_series" in data
    assert "contributions" in data
    assert "weights" in data
    assert data["weights"]["AAPL"] == 0.5
    assert data["weights"]["MSFT"] == 0.5
    assert data["weights"]["GOOGL"] == 0.0
