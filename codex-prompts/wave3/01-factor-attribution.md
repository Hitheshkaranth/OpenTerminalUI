# TASK: Build Factor-Based Risk Attribution Engine

## Project Context

OpenTerminalUI — React 18 + TypeScript + Vite + Tailwind + Zustand + Recharts frontend, FastAPI + SQLAlchemy backend. Risk engine at `backend/risk_engine/`. Risk dashboard at `frontend/src/pages/RiskDashboard.tsx` with components in `frontend/src/components/risk/`. Portfolio data at `backend/api/routes/portfolio.py`. Terminal dark theme. @nivo/heatmap available. Tests: pytest + Playwright.

## What to Build

### Backend: `backend/risk_engine/factor_attribution.py`

```python
import numpy as np
from typing import Optional

class FactorAttributionEngine:
    """Fama-French style factor-based portfolio decomposition."""

    FACTORS = ["market", "size", "value", "momentum", "quality", "low_vol"]

    def compute_factor_returns(self, universe_data: list[dict], period: str = "1Y") -> dict:
        """
        Compute factor return series from universe data.
        - Market: universe equal-weight return
        - Size: small_cap_return - large_cap_return (split at median market_cap)
        - Value: high_pb_quintile_return - low_pb_quintile_return
        - Momentum: top_12m_return_quintile - bottom_quintile
        - Quality: high_roe_quintile - low_roe_quintile
        - Low Vol: low_beta_quintile - high_beta_quintile
        Returns: {factor_name: [daily_returns]}
        """

    def compute_factor_exposures(self, holdings: list[dict], universe_data: list[dict]) -> dict:
        """
        For each holding, compute factor loadings using rolling 60-day regression.
        Portfolio exposure = weighted average of holding exposures.
        Returns: {factor_name: {exposure: float, t_stat: float, confidence: float}}
        """

    def attribute_returns(self, holdings: list[dict], factor_returns: dict, period: str) -> dict:
        """
        Decompose portfolio return into factor contributions.
        portfolio_return = sum(exposure_i * factor_return_i) + alpha
        Returns: {
            total_return: float,
            factor_contributions: {factor_name: float},
            alpha: float,
            r_squared: float
        }
        """

    def rolling_exposures(self, holdings: list[dict], universe_data: list[dict], window: int = 60) -> dict:
        """
        Compute factor exposures over rolling windows.
        Returns: {factor_name: [{date, exposure}]}
        """
```

Use numpy for regressions (OLS via `np.linalg.lstsq`). If numpy not available, use simple correlation-based approximation.

### Backend Routes: `backend/api/routes/factor_analysis.py`

```
GET /api/risk/factor-exposures?portfolio_id=X
  Returns: { exposures: {market: {exposure, t_stat}, size: {...}, ...} }

GET /api/risk/factor-attribution?portfolio_id=X&period=1Y
  Returns: {
    total_return, factor_contributions: {market: 0.12, size: -0.02, ...},
    alpha, r_squared
  }

GET /api/risk/factor-history?portfolio_id=X&period=1Y&window=60
  Returns: { series: {market: [{date, exposure}], size: [...], ...} }

GET /api/risk/factor-returns?period=1Y
  Returns: { factors: {market: [{date, return}], ...} }
```

Register in `backend/main.py`.

### Frontend: Add "Factors" tab to Risk Dashboard

In `frontend/src/pages/RiskDashboard.tsx`, add a "Factor Attribution" tab:

1. **Factor Exposure Bar Chart** (Recharts horizontal `BarChart`):
   - One bar per factor (Market, Size, Value, Momentum, Quality, Low Vol)
   - Bar color: blue for positive exposure, orange for negative
   - Show exposure value on bar
   - Error bars or confidence interval markers

2. **Return Attribution Waterfall** (Recharts `BarChart`):
   - Bars: Market + Size + Value + Momentum + Quality + Low Vol + Alpha = Total
   - Green bars for positive contributions, red for negative
   - Running total line connecting bar tops
   - Final bar (Total) distinguished with accent color

3. **Rolling Factor Exposures** (Recharts `LineChart`):
   - One line per factor, multi-colored
   - X-axis: date, Y-axis: exposure value
   - Zero line highlighted
   - Toggle individual factors on/off via legend clicks

4. **Style Box** (3x3 grid):
   - Rows: Small / Mid / Large (based on size factor)
   - Columns: Value / Blend / Growth (based on value factor)
   - Highlighted cell shows portfolio positioning
   - Use CSS grid with colored cell

5. **Period selector**: 3M | 6M | 1Y | 3Y

### Tests

**Backend** (`backend/tests/test_factor_attribution.py`):
```python
# Test factor return computation returns all 6 factors
# Test factor exposure computation returns exposures with t-stats
# Test return attribution: sum of contributions + alpha ≈ total return
# Test rolling exposures returns time series for each factor
# Test API routes return valid responses
```

**E2E** (`frontend/tests/factor-attribution.spec.ts`):
```typescript
// Navigate to /equity/risk
// Click "Factor Attribution" tab
// Verify factor exposure bar chart renders with 6 bars
// Verify waterfall chart renders
// Verify rolling exposure line chart renders
// Change period to "3M", verify data updates
```
