import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.api.deps import get_db, get_unified_fetcher
from backend.api.routes.chart import _parse_yahoo_chart
from backend.auth.deps import get_current_user
from backend.models import Holding, User
from backend.shared.market_classifier import market_classifier
from backend.risk_engine.schemas import RiskSummary, ExposureAnalytics, CorrelationMatrix
from backend.risk_engine.compute import (
    ewma_volatility,
    calculate_beta,
    build_correlation_matrix,
    calculate_pca_exposures,
    marginal_risk_contribution
)

from typing import List, Optional
from fastapi import Query

router = APIRouter(prefix="/risk", tags=["risk"])

async def _load_symbols_returns(symbols: List[str]) -> pd.DataFrame:
    if not symbols:
        return pd.DataFrame()

    fetcher = await get_unified_fetcher()
    series_map: dict[str, pd.Series] = {}
    for symbol in symbols:
        try:
            raw = await fetcher.fetch_history(symbol, range_str="1y", interval="1d")
            frame = _parse_yahoo_chart(raw if isinstance(raw, dict) else {})
            if frame.empty: continue
            ret = frame["Close"].pct_change().dropna()
            if ret.empty: continue
            series_map[symbol] = ret
        except Exception:
            continue

    if not series_map:
        return pd.DataFrame()

    df = pd.DataFrame(series_map).dropna()
    return df

async def _get_target_symbols(db: Session, ticker: Optional[str] = None) -> List[str]:
    if ticker:
        # PeerResponse carries peer metrics, not peer symbols, and no peer-symbol source
        # is wired up, so single-ticker risk runs on the ticker alone.
        return [ticker.strip().upper()]

    rows = db.query(Holding).all()
    return sorted({str(row.ticker).strip().upper() for row in rows if str(row.ticker).strip()})

@router.get("/summary", response_model=RiskSummary)
async def get_risk_summary(
    ticker: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    symbols = await _get_target_symbols(db, ticker)
    df = await _load_symbols_returns(symbols)

    if df.empty:
        return RiskSummary(ewma_vol=0, beta=0, marginal_contribution={})

    # Single ticker mode: the ticker's own returns (not a peer basket).
    # Portfolio mode: the equal-weighted mean.
    focus = ticker.strip().upper() if ticker else None
    port_series = df[focus] if focus and focus in df.columns else df.mean(axis=1)

    # Use first symbol or benchmark for beta (simplification)
    # Beta must be against a market index; using `ticker` compared the basket to one of its own members.
    bm_symbol = "^NSEI"
    if ticker:
        try:
            if (await market_classifier.classify(ticker)).country_code == "US":
                bm_symbol = "^GSPC"
        except Exception:
            pass
    bm_df = await _load_symbols_returns([bm_symbol])
    bm_series = bm_df.iloc[:, 0] if not bm_df.empty else port_series

    # Align on trading date. Trailing-length alignment paired returns from
    # different days whenever the two calendars differed (e.g. 251 vs 245 bars),
    # which drove beta to ~0.
    def _by_date(series: pd.Series) -> pd.Series:
        idx = pd.DatetimeIndex(series.index)
        out = series.copy()
        out.index = idx.normalize() if isinstance(idx, pd.DatetimeIndex) else idx
        return out[~out.index.duplicated(keep="last")]

    aligned = pd.concat([_by_date(port_series), _by_date(bm_series)], axis=1, join="inner").dropna()
    port_returns = aligned.iloc[:, 0].values
    bm_returns = aligned.iloc[:, 1].values

    vol = ewma_volatility(port_series.values)
    beta = calculate_beta(port_returns, bm_returns)

    cov = df.cov().values
    n = len(df.columns)
    weights = np.ones(n) / float(n)
    marginals = marginal_risk_contribution(weights, cov)

    mc_dict = {col: float(m) for col, m in zip(df.columns, marginals)}

    return RiskSummary(
        ewma_vol=vol,
        beta=beta,
        marginal_contribution=mc_dict
    )

@router.get("/exposures", response_model=ExposureAnalytics)
async def get_risk_exposures(
    ticker: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    symbols = await _get_target_symbols(db, ticker)
    df = await _load_symbols_returns(symbols)
    if df.empty:
        return ExposureAnalytics(pca_factors=[], loadings={})

    res = calculate_pca_exposures(df, n_components=min(2, len(df.columns)))
    return ExposureAnalytics(
        pca_factors=res["pca_factors"],
        loadings=res["loadings"]
    )

@router.get("/correlation", response_model=CorrelationMatrix)
async def get_risk_correlation(
    ticker: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    symbols = await _get_target_symbols(db, ticker)
    df = await _load_symbols_returns(symbols)
    if df.empty:
        return CorrelationMatrix(matrix=[], assets=[])

    res = build_correlation_matrix(df, window=min(60, len(df)))
    return CorrelationMatrix(
        matrix=res["matrix"],
        assets=res["assets"]
    )

@router.get("/sector-concentration")
async def get_sector_concentration(
    ticker: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    if ticker:
        # For a single ticker, we show industry/sector context compared to its peers
        symbols = await _get_target_symbols(db, ticker)
    else:
        rows = db.query(Holding).all()
        symbols = [row.ticker for row in rows]

    if not symbols:
        return {"sectors": {}, "industries": {}}

    sector_map = {}
    industry_map = {}

    for sym in symbols:
        try:
            cls = await market_classifier.classify(sym)
            sector = cls.country_name # Simplified: using country or other meta
            industry = cls.display_name

            # Fetch actual metadata if available
            sector_map[sector] = sector_map.get(sector, 0) + 1
            industry_map[industry] = industry_map.get(industry, 0) + 1
        except Exception:
            continue

    total = len(symbols)
    if total == 0: return {"sectors": {}, "industries": {}}

    return {
        "sectors": {k: (v/total) * 100 for k, v in sector_map.items()},
        "industries": {k: (v/total) * 100 for k, v in industry_map.items()}
    }
