# TASK: Build Dividend Analysis Dashboard

## Project Context

OpenTerminalUI — React 18 + TypeScript + Vite + Tailwind + Zustand + Recharts frontend, FastAPI + SQLAlchemy backend. Existing `DividendTracker` component at `frontend/src/components/portfolio/DividendTracker.tsx` (basic). Portfolio routes at `backend/api/routes/portfolio.py`. Data adapters in `backend/adapters/`. Terminal dark theme. Sidebar nav in Sidebar.tsx. Tests: pytest + Playwright.

## What to Build

### Backend Routes: `backend/api/routes/dividends.py`

```
GET /api/dividends/{symbol}/history?years=10
  Returns: {
    symbol,
    dividends: [{ex_date, pay_date, amount, type: "interim"|"final"|"special"}],
    stats: {
      current_yield, trailing_12m_dividend,
      dividend_cagr_5y, dividend_cagr_10y,
      payout_ratio, avg_payout_ratio_5y,
      consecutive_years, years_of_growth
    }
  }

GET /api/dividends/calendar?month=2026-04&watchlist_id=X
  Returns: {
    events: [{symbol, name, ex_date, pay_date, amount, yield_pct, in_portfolio: bool, in_watchlist: bool}]
  }

GET /api/dividends/portfolio-income?portfolio_id=X
  Returns: {
    annual_income: float,
    monthly_breakdown: [{month, projected_income}],
    yield_on_cost: float,
    current_yield: float,
    income_growth_yoy: float,
    by_holding: [{symbol, annual_dividend, yield, weight_of_income}]
  }

GET /api/dividends/aristocrats?market=IN&min_years=10
  Returns: {
    stocks: [{symbol, name, consecutive_years, current_yield, cagr_5y, sector}]
  }
```

Fetch dividend data from adapters (Yahoo Finance has dividend history). If not available, provide sample data for demonstration. Register in `backend/main.py`.

### Frontend Page: `frontend/src/pages/DividendDashboardPage.tsx`

Route: `/equity/dividends`

**Tab 1: "Calendar"** (default):
- Monthly calendar grid (7 columns for days of week, ~5 rows)
- Each day cell shows dividend events:
  - Green dot: portfolio holdings going ex-dividend
  - Blue dot: watchlist items
  - Gray dot: other stocks
- Click day to see event details in a side panel
- Month navigation: < Prev | Current Month | Next >
- Legend: Portfolio (green), Watchlist (blue), Other (gray)
- Upcoming events list below calendar (next 30 days, sorted by date)

**Tab 2: "Income"** (portfolio dividend income):
- **Big number**: Annual Projected Income (formatted with currency)
- **Monthly bar chart** (Recharts): projected monthly income, 12 bars
- **Yield comparison**: Yield on Cost vs Current Yield (two gauge-like displays)
- **Income growth**: YoY income growth % (green/red arrow)
- **By holding table**: symbol, annual dividend, yield %, weight of total income, bar chart of contribution
- **Income trend**: if historical data available, show 3-year income trend line

**Tab 3: "Stock Analysis"** (per-symbol deep dive):
- Symbol input at top
- Dividend history bar chart (Recharts): last 10 years of annual dividends
  - Interim dividends stacked on final dividends
  - Special dividends highlighted differently
- Dividend growth rate: CAGR badges (1Y, 3Y, 5Y, 10Y)
- Payout ratio trend: line chart over time
- Ex-date countdown: days until next ex-date (big countdown number)
- Dividend safety score (computed):
  - Payout ratio < 60% = Safe (green)
  - 60-80% = Watch (amber)
  - > 80% = Risk (red)
  - Also consider FCF coverage and debt levels if available

**Tab 4: "Aristocrats"**:
- Table of stocks with 10+ years of consecutive dividend increases
- Columns: Symbol, Name, Consecutive Years, Current Yield, 5Y CAGR, Sector
- Sort by any column
- Quick filter: min years dropdown (10, 15, 20, 25)

### Sidebar & Routing

Add `{ label: "Dividends", path: "/equity/dividends", key: "DV", hint: "Income" }` after "Portfolio Lab".
Add route in App.tsx.

### Tests

**Backend** (`backend/tests/test_dividends.py`):
```python
# Test GET /api/dividends/RELIANCE/history returns history and stats
# Test GET /api/dividends/calendar returns events for month
# Test GET /api/dividends/portfolio-income returns income data
# Test GET /api/dividends/aristocrats returns stocks with min years filter
# Test dividend CAGR calculation is correct for known data
```

**E2E** (`frontend/tests/dividend-dashboard.spec.ts`):
```typescript
// Navigate to /equity/dividends
// Verify calendar tab shows monthly grid
// Click "Income" tab, verify annual income number shown
// Verify monthly bar chart renders
// Click "Stock Analysis" tab, enter symbol, verify history chart renders
// Click "Aristocrats" tab, verify table with consecutive years column
```
