from fastapi import APIRouter, HTTPException, Query, Depends
from typing import Any, Dict, List
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import get_db, get_unified_fetcher
from backend.auth.deps import get_current_user
from backend.models import Holding, User
from backend.services.sector_rotation import fetch_sector_rotation
from backend.risk_engine.scenario_engine import scenario_engine
from backend.api.routes.chart import _parse_yahoo_chart
import pandas as pd

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

class StressTestRequest(BaseModel):
    scenario_type: str = Field(..., description="Scenario type: parallel_shift, volatility_spike, flash_crash")
    portfolio_id: str = Field("current", description="Portfolio ID or 'current'")
    params: Dict[str, Any] = Field(default_factory=dict, description="Scenario specific parameters")

@router.get("/sector-rotation", response_model=Dict[str, Any])
async def get_sector_rotation(
    benchmark: str = Query("SPY", description="Benchmark symbol, e.g., SPY or ^NSEI"),
    period: str = Query("52w", description="Lookback period for trail")
):
    """Fetch Relative Rotation Graph (RRG) metrics for sector rotation analysis."""
    result = await fetch_sector_rotation(benchmark)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result

async def _load_returns(symbols: List[str], benchmark: str = "SPY") -> tuple[pd.DataFrame, pd.Series]:
    fetcher = await get_unified_fetcher()
    series_map: Dict[str, pd.Series] = {}
    all_symbols = list(set(symbols + [benchmark]))

    for symbol in all_symbols:
        raw = await fetcher.fetch_history(symbol, range_str="2y", interval="1d")
        frame = _parse_yahoo_chart(raw if isinstance(raw, dict) else {})
        if not frame.empty:
            series_map[symbol.upper()] = frame["Close"].pct_change().dropna()

    if not series_map:
        return pd.DataFrame(), pd.Series()

    df = pd.DataFrame(series_map).dropna()
    if benchmark.upper() not in df.columns:
        # If benchmark is missing, use average of others or a default
        market_returns = df.mean(axis=1)
    else:
        market_returns = df[benchmark.upper()]

    returns_df = df[[s.upper() for s in symbols if s.upper() in df.columns]]
    return returns_df, market_returns

@router.post("/stress-test")
async def run_stress_test(
    payload: StressTestRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """
    Execute stress testing and scenario analysis for a portfolio.
    Calculates impact on portfolio beta, VaR, and projected P&L.
    """
    # 1. Resolve Holdings
    holdings = db.query(Holding).all() # Simplified: get all for 'current'
    if not holdings:
        raise HTTPException(status_code=404, detail="No holdings found")

    symbols = [str(h.ticker).upper() for h in holdings]
    portfolio_value = sum(float(h.quantity) * float(h.avg_buy_price) for h in holdings)

    # 2. Load returns
    returns_df, market_returns = await _load_returns(symbols)
    if returns_df.empty:
        raise HTTPException(status_code=400, detail="Insufficient historical data for risk calculation")

    # 3. Run Scenario
    try:
        impact = scenario_engine.run_stress_test(
            holdings=holdings,
            scenario_type=payload.scenario_type,
            returns_df=returns_df,
            market_returns=market_returns,
            portfolio_value=portfolio_value,
            params=payload.params
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "scenario": impact.scenario_name,
        "metrics": {
            "projected_pnl": impact.projected_pnl,
            "projected_pnl_pct": impact.projected_pnl_pct,
            "base_beta": impact.base_beta,
            "stressed_beta": impact.stressed_beta,
            "base_var": impact.base_var,
            "stressed_var": impact.stressed_var,
        },
        "portfolio_value": portfolio_value,
        "timestamp": pd.Timestamp.now().isoformat()
    }
