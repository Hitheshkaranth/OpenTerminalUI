# TASK: Build Advanced Scenario Analysis & Stress Testing

## Project Context

OpenTerminalUI — React 18 + TypeScript + Vite + Tailwind + Zustand + Recharts frontend, FastAPI + SQLAlchemy backend. Risk engine at `backend/risk_engine/`. Risk dashboard at `frontend/src/pages/RiskDashboard.tsx`. Portfolio routes at `backend/api/routes/portfolio.py`. Terminal dark theme. Tests: pytest + Playwright.

## What to Build

### Backend: `backend/risk_engine/scenario_engine.py`

```python
PREDEFINED_SCENARIOS = {
    "gfc_2008": {
        "name": "2008 Global Financial Crisis",
        "description": "Lehman collapse, credit freeze, equity meltdown",
        "shocks": {"equity": -0.40, "rates": -0.02, "volatility": 1.5, "credit_spread": 0.04, "gold": 0.15, "fx_inr": -0.12}
    },
    "covid_2020": {
        "name": "2020 COVID Crash",
        "description": "Pandemic selloff, March 2020",
        "shocks": {"equity": -0.35, "rates": -0.015, "volatility": 2.0, "gold": 0.10, "fx_inr": -0.06}
    },
    "rate_shock_200bps": {
        "name": "Rate Shock +200bps",
        "description": "Sudden rate hike cycle, duration impact",
        "shocks": {"equity": -0.10, "rates": 0.02, "volatility": 0.3, "credit_spread": 0.01}
    },
    "inr_depreciation": {
        "name": "INR Depreciation 10%",
        "description": "Currency stress, capital outflows",
        "shocks": {"equity": -0.08, "fx_inr": -0.10, "volatility": 0.2}
    },
    "tech_rotation": {
        "name": "Tech Sector Rotation",
        "description": "Growth to value rotation, tech selloff",
        "shocks": {"equity": -0.05, "sector_tech": -0.25, "sector_value": 0.15}
    },
    "commodity_spike": {
        "name": "Commodity Price Spike",
        "description": "Oil +50%, inflation surge",
        "shocks": {"equity": -0.12, "rates": 0.01, "gold": 0.20, "crude_oil": 0.50}
    }
}

class ScenarioEngine:
    def apply_scenario(self, holdings: list[dict], shocks: dict) -> dict:
        """
        Apply factor shocks to portfolio holdings.
        For each holding: estimate_impact = sum(beta_to_factor * shock_amount)
        Consider sector exposure for sector-specific shocks.

        Returns: {
            total_impact_pct: float,
            total_impact_value: float,
            by_holding: [{symbol, weight, impact_pct, impact_value, new_value}],
            by_sector: [{sector, weight, impact_pct}],
            worst_holdings: [{symbol, impact_pct}]  # top 5 worst
        }
        """

    def run_monte_carlo_stress(self, holdings: list[dict], n_simulations: int = 1000) -> dict:
        """
        Generate random scenarios from historical factor distributions.
        Returns: {
            percentiles: {p5: float, p25: float, p50: float, p75: float, p95: float},
            worst_case: float,
            best_case: float,
            paths: [[float]]  # sample of 100 paths for fan chart
        }
        """

    def historical_replay(self, holdings: list[dict], event_start: str, event_end: str) -> dict:
        """
        Replay actual historical returns over a crisis period.
        Returns: {daily_pnl: [{date, pnl, cumulative}], max_drawdown, recovery_days}
        """
```

### Backend Routes: `backend/api/routes/stress_test.py`

```
GET  /api/risk/scenarios/predefined
  Returns: [{id, name, description, severity: "high"|"medium"|"extreme", shocks}]

POST /api/risk/scenarios/run
  Body: {portfolio_id, scenario_id}  OR  {portfolio_id, custom_shocks: {equity: -0.20, ...}}
  Returns: {total_impact_pct, total_impact_value, by_holding, by_sector, worst_holdings}

POST /api/risk/scenarios/monte-carlo
  Body: {portfolio_id, n_simulations: 1000}
  Returns: {percentiles, worst_case, best_case, paths}

GET  /api/risk/scenarios/history
  Returns: [{id, scenario_name, run_date, total_impact_pct}]
```

Register in `backend/main.py`.

### Frontend: Add "Stress Test" tab to Risk Dashboard

In `frontend/src/pages/RiskDashboard.tsx`:

1. **Scenario Library** (card grid):
   - Each predefined scenario as a card: name, description, severity badge (red/amber/yellow)
   - "Run" button per card
   - "Custom Scenario" card with a + icon

2. **Custom Scenario Builder** (shown when "Custom" selected):
   - Sliders for each factor: Equity (%), Interest Rates (bps), Volatility (%), FX (%), Gold (%), Crude (%)
   - Range: -50% to +50% for each
   - "Run Custom Scenario" button

3. **Results Panel** (shown after running):
   - **Big number**: Total Portfolio Impact (red/green with %)
   - **Impact by Holding** (Recharts horizontal bar chart): sorted worst to best
   - **Impact by Sector** (Recharts pie or donut chart): sector contribution to loss
   - **Worst 5 Holdings** table: symbol, current value, impact %, impact value
   - **Monte Carlo Fan Chart** (Recharts area chart): show 5th-95th percentile bands
     - Dark area: 25th-75th, lighter area: 5th-95th, line: median

4. **Run History**: table of past scenario runs with date, scenario name, impact %

### Tests

**Backend** (`backend/tests/test_stress_test.py`):
```python
# Test predefined scenarios list returns all 6 scenarios
# Test running GFC scenario returns negative total_impact
# Test custom scenario with all-zero shocks returns ~0 impact
# Test Monte Carlo returns valid percentiles (p5 < p50 < p95)
# Test by_holding results sum approximately to total_impact
# Test worst_holdings are sorted by impact (worst first)
```

**E2E** (`frontend/tests/stress-test.spec.ts`):
```typescript
// Navigate to /equity/risk
// Click "Stress Test" tab
// Verify scenario cards render (at least 6)
// Click "Run" on "2008 GFC" scenario
// Verify results panel shows with impact number
// Verify impact by holding chart renders
// Click "Custom Scenario", adjust equity slider, run
// Verify custom results display
```
