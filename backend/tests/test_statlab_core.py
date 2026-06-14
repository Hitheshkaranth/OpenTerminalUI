import pytest
import pandas as pd
import numpy as np
from backend.core.statlab import (
    forecast_series,
    cointegration_analysis,
    stationarity_tests,
    decompose_series,
    factor_regression,
    autocorrelation_analysis,
    granger_causality,
    regime_detection,
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
    
    # Granger Causality synthetic
    # Lead is random walk, Follow depends on Lead's prior return
    lead_ret = np.random.normal(0.001, 0.01, 500)
    lead = pd.Series(100 * np.exp(np.cumsum(lead_ret)), index=dates, name="LEAD")
    follow_ret = np.zeros(500)
    follow_ret[0] = np.random.normal(0, 0.01)
    for i in range(1, 500):
        # Follow return = 0.8 * Lead return (lag 1) + noise
        follow_ret[i] = 0.8 * lead_ret[i-1] + np.random.normal(0, 0.005)
    follow = pd.Series(100 * np.exp(np.cumsum(follow_ret)), index=dates, name="FOLLOW")

    # Regime detection synthetic
    # Low vol (0.005) then High vol (0.03)
    regime_ret = np.concatenate([
        np.random.normal(0.0002, 0.005, 250),
        np.random.normal(-0.001, 0.03, 250)
    ])
    regime_series = pd.Series(100 * np.exp(np.cumsum(regime_ret)), index=dates, name="REGIME")

    return {
        "rw": rw,
        "a": a,
        "b": b,
        "ar1": ar1_series,
        "lead": lead,
        "follow": follow,
        "regime": regime_series
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

def test_factor_regression(synthetic_data):
    bench = synthetic_data["rw"]
    # asset with returns ≈ 0.0002 + 1.4*bench_ret + noise
    bench_ret = bench.pct_change().dropna()
    asset_ret = 0.0002 + 1.4 * bench_ret + np.random.normal(0, 0.005, len(bench_ret))
    asset = pd.Series(100 * np.exp(np.cumsum(asset_ret)), index=bench_ret.index, name="ASSET")
    
    res = factor_regression(asset, bench)
    assert 1.1 < res["beta"] < 1.7
    assert 0 <= res["r_squared"] <= 1
    assert len(res["rolling_beta"]) > 0
    assert len(res["scatter"]) > 0
    assert len(res["fit_line"]) == 2

def test_autocorrelation_analysis(synthetic_data):
    ar1 = synthetic_data["ar1"]
    res = autocorrelation_analysis(ar1)
    assert len(res["acf"]) > 0
    assert res["acf"][0]["lag"] == 0
    assert len(res["pacf"]) > 0
    assert len(res["ljung_box"]) > 0

def test_granger_causality(synthetic_data):
    lead = synthetic_data["lead"]
    follow = synthetic_data["follow"]
    
    # Test: Lead leads Follow? (granger_causality(target, source))
    # Wait, the tool granger_causality(a, b) does both A->B and B->A.
    res = granger_causality(follow, lead)
    # b_to_a means lead to follow (since a=follow, b=lead)
    # My implementation:
    # data_a_to_b = df.iloc[:, [1, 0]] => target=B(lead), source=A(follow)
    # data_b_to_a = df.iloc[:, [0, 1]] => target=A(follow), source=B(lead)
    assert res["b_to_a"]["significant"] is True
    assert res["b_to_a"]["min_pvalue"] < 0.05

def test_regime_detection(synthetic_data):
    regime = synthetic_data["regime"]
    res = regime_detection(regime)
    assert res["current_regime"] in {"HIGH-VOL", "LOW-VOL"}
    assert len(res["series"]) > 0
    assert res["high_vol_regime"]["ann_vol_pct"] >= res["low_vol_regime"]["ann_vol_pct"]

def test_list_methods():
    res = list_methods()
    assert "forecast_methods" in res
    assert len(res["forecast_methods"]) >= 2
    assert "regression_methods" in res
    assert "causality_methods" in res
    assert "regime_methods" in res

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
    with pytest.raises(ValueError):
        factor_regression(short_series, short_series)
    with pytest.raises(ValueError):
        autocorrelation_analysis(short_series)
    with pytest.raises(ValueError):
        granger_causality(short_series, short_series)
    with pytest.raises(ValueError):
        regime_detection(short_series)
