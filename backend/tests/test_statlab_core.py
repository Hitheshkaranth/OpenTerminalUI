import pytest
import pandas as pd
import numpy as np
from backend.core.statlab import (
    forecast_series,
    cointegration_analysis,
    stationarity_tests,
    decompose_series,
    list_methods
)

@pytest.fixture
def synthetic_data():
    np.random.seed(42)
    dates = pd.bdate_range(start="2020-01-01", periods=500)
    
    # Random walk
    rw = pd.Series(100 + np.cumsum(np.random.normal(0, 1, 500)), index=dates, name="RW")
    
    # Cointegrated pair
    # b is random walk, a = 2*b + noise
    b = pd.Series(50 + np.cumsum(np.random.normal(0, 0.5, 500)), index=dates, name="B")
    a = pd.Series(2 * b + np.random.normal(0, 1, 500), index=dates, name="A")
    
    # Mean-reverting AR(1)
    # x_t = 0.5 * x_{t-1} + e_t
    ar1 = [0]
    for _ in range(499):
        ar1.append(0.5 * ar1[-1] + np.random.normal(0, 1))
    ar1_series = pd.Series(10 + np.array(ar1), index=dates, name="AR1")
    
    return {
        "rw": rw,
        "a": a,
        "b": b,
        "ar1": ar1_series
    }

def test_forecast_series(synthetic_data):
    rw = synthetic_data["rw"]
    
    # ARIMA
    res_arima = forecast_series(rw, method="arima", horizon=10)
    assert res_arima["method"] == "arima"
    assert len(res_arima["history"]) > 0
    assert len(res_arima["forecast"]) == 10
    for f in res_arima["forecast"]:
        assert "mean" in f
        assert "lower" in f
        assert "upper" in f
        assert f["lower"] <= f["mean"] <= f["upper"]
    assert res_arima["model"]["order"] != "N/A"
    
    # ETS
    res_ets = forecast_series(rw, method="ets", horizon=10)
    assert res_ets["method"] == "ets"
    assert len(res_ets["forecast"]) == 10
    for f in res_ets["forecast"]:
        assert f["lower"] <= f["mean"] <= f["upper"]

def test_cointegration_analysis(synthetic_data):
    a = synthetic_data["a"]
    b = synthetic_data["b"]
    
    res = cointegration_analysis(a, b)
    assert res["ticker_a"] == "A"
    assert res["ticker_b"] == "B"
    assert res["is_cointegrated"] is True
    assert 1.5 < res["hedge_ratio"] < 2.5
    assert len(res["series"]) > 0
    assert "current_z" in res
    assert isinstance(res["current_z"], float)

def test_stationarity_tests(synthetic_data):
    ar1 = synthetic_data["ar1"]
    rw = synthetic_data["rw"]
    
    # AR(1) should be stationary
    res_ar1 = stationarity_tests(ar1)
    assert res_ar1["adf"]["is_stationary"] is True
    assert "hurst" in res_ar1
    assert "interpretation" in res_ar1
    
    # RW should NOT be stationary in levels
    res_rw = stationarity_tests(rw)
    assert res_rw["adf"]["is_stationary"] is False
    # But returns should be stationary
    assert res_rw["returns_adf"]["is_stationary"] is True

def test_decompose_series(synthetic_data):
    rw = synthetic_data["rw"]
    res = decompose_series(rw, period=21)
    assert res["period"] == 21
    assert len(res["series"]) > 0
    first_pt = res["series"][0]
    assert "observed" in first_pt
    assert "trend" in first_pt
    assert "seasonal" in first_pt
    assert "resid" in first_pt

def test_list_methods():
    res = list_methods()
    assert "forecast_methods" in res
    assert len(res["forecast_methods"]) >= 2

def test_degenerate_input():
    short_series = pd.Series(np.random.randn(10))
    with pytest.raises(ValueError):
        forecast_series(short_series)
    with pytest.raises(ValueError):
        stationarity_tests(short_series)
    with pytest.raises(ValueError):
        decompose_series(short_series)
    with pytest.raises(ValueError):
        cointegration_analysis(short_series, short_series)
