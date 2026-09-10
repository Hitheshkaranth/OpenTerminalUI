import os

import numpy as np
import pandas as pd
from fastapi.testclient import TestClient
from unittest.mock import patch

from backend.main import app
from backend.risk_engine.compute import (
    ewma_volatility,
    calculate_beta,
    build_correlation_matrix,
    calculate_pca_exposures,
)

client = TestClient(app)

def test_risk_ewma_volatility():
    returns = np.random.normal(0, 0.01, 100)
    vol = ewma_volatility(returns)
    assert vol > 0.0
    assert isinstance(vol, float)

def test_risk_beta():
    # asset and benchmark are perfectly correlated
    bm = np.random.normal(0, 0.01, 100)
    asset = bm * 1.5
    beta = calculate_beta(asset, bm)
    assert np.isclose(beta, 1.5)

def test_risk_correlation_bounds():
    df = pd.DataFrame({
        "A": np.random.normal(0, 0.01, 100),
        "B": np.random.normal(0, 0.01, 100)
    })
    res = build_correlation_matrix(df, window=60)
    mat = np.array(res["matrix"])
    # bounds
    assert np.all(mat >= -1.0)
    assert np.all(mat <= 1.0)
    # symmetry
    assert np.allclose(mat, mat.T)

def test_risk_pca_deterministic():
    df = pd.DataFrame({
        "A": np.random.normal(0, 0.01, 100),
        "B": np.random.normal(0, 0.01, 100),
        "C": np.random.normal(0, 0.01, 100),
    })
    res1 = calculate_pca_exposures(df, n_components=2)
    res2 = calculate_pca_exposures(df, n_components=2)

    # Check deterministic
    assert res1["pca_factors"] == res2["pca_factors"]
    assert res1["loadings"]["A"] == res2["loadings"]["A"]

def test_risk_endpoints():
    # The /api/risk auth fallback needs the middleware toggle off *and* a dev
    # environment. Patching os.environ.get wholesale also blanked the env name,
    # which made get_current_user treat the run as production and reject it.
    with patch.dict(os.environ, {"AUTH_MIDDLEWARE_ENABLED": "0", "OPENTERMINALUI_ENV": "test"}):
        r1 = client.get("/api/risk/summary")
        assert r1.status_code == 200
        assert "ewma_vol" in r1.json()

        r2 = client.get("/api/risk/exposures")
        assert r2.status_code == 200
        assert "pca_factors" in r2.json()

        r3 = client.get("/api/risk/correlation")
        assert r3.status_code == 200
        assert "matrix" in r3.json()
