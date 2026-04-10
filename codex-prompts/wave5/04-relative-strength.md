# TASK: Build Relative Strength Analysis Dashboard

## Project Context

OpenTerminalUI — React 18 + TypeScript + Vite + Tailwind + Zustand + Recharts frontend, FastAPI + SQLAlchemy backend. Sector rotation page exists at `frontend/src/pages/SectorRotation.tsx` with RRG chart. Chart data fetched from `/api/chart/`. Terminal dark theme. Tests: pytest + Playwright.

## What to Build

### Backend Routes: `backend/api/routes/relative_strength.py`

```
GET /api/rs/rankings?universe=nifty200&benchmark=NIFTY50&period=6M&limit=50
  Returns: {
    benchmark,
    rankings: [{
      rank, symbol, name, sector,
      rs_score,        // current RS value (stock_return / benchmark_return * 100)
      rs_percentile,   // percentile rank within universe (0-100)
      rs_momentum,     // RS change over last 20 days (accelerating/decelerating)
      price_return,    // absolute return over period
      sparkline: [float]  // last 20 RS values for mini chart
    }]
  }

  RS calculation:
  - rs_score = (stock_cumulative_return / benchmark_cumulative_return) * 100
  - Normalize to 52-week range: 0 = 52w RS low, 100 = 52w RS high
  - rs_momentum = rs_score_today - rs_score_20d_ago

GET /api/rs/stock/{symbol}?benchmark=NIFTY50&period=1Y
  Returns: {
    symbol, benchmark,
    rs_series: [{date, rs_value}],
    current_rs, rs_percentile,
    rs_new_high: bool, rs_new_low: bool,
    zero_cross_dates: [{date, direction: "above"|"below"}]
  }

GET /api/rs/sectors?benchmark=NIFTY50&period=6M
  Returns: {
    sectors: [{
      sector, rs_score, rs_momentum, stock_count,
      top_stock: {symbol, rs_score},
      bottom_stock: {symbol, rs_score}
    }]
  }

GET /api/rs/new-highs?universe=nifty200&days=5
  Returns: {
    stocks: [{symbol, name, sector, rs_score, rs_new_high_date}]
  }
  // Stocks making new 52-week RS highs in last N days
```

Register in `backend/main.py`.

### Frontend Page: `frontend/src/pages/RelativeStrengthPage.tsx`

Route: `/equity/relative-strength`

**Controls Bar** (top):
- Universe: Nifty 50 | Nifty 100 | Nifty 200 | Nifty 500 (dropdown)
- Benchmark: NIFTY 50 | NIFTY BANK | NIFTY IT (dropdown)
- Period: 1M | 3M | 6M | 1Y (button group)

**Tabs**:

1. **"Rankings"** (default):
   - Sortable table:
     - Columns: Rank | Symbol | Name | Sector | RS Score | RS Percentile | RS Momentum | Return % | Sparkline
   - RS Score column: color gradient (top 20% bright green, bottom 20% bright red, middle gray)
   - RS Momentum: green up arrow if positive, red down arrow if negative
   - Sparkline: tiny 20-point line chart in the cell (use Recharts `<Sparklines>` or simple SVG)
   - Click row → navigate to RS Chart tab with that symbol
   - Filter: sector dropdown, min RS percentile

2. **"Sector RS"**:
   - Horizontal bar chart (Recharts): sectors sorted by RS score, strongest at top
   - Green bars for RS > 100 (outperforming benchmark), red for RS < 100
   - Each bar labeled with sector name and RS score
   - Click sector → filter Rankings tab to that sector

3. **"RS Chart"** (per-symbol):
   - Symbol input (or auto-populated from Rankings click)
   - Dual-axis Recharts chart:
     - Left axis: Price (line/area)
     - Right axis: Mansfield RS (line, different color)
   - Zero line on RS axis highlighted (dashed)
   - Shade RS above zero green, below zero red
   - Mark RS new highs with triangle markers
   - Mark zero-line crossovers with vertical dashed lines

4. **"New Highs"** (breakout list):
   - Stocks making new RS highs in last 5 trading days
   - Table: Symbol | Name | Sector | RS Score | New High Date
   - These are potentially strong momentum candidates
   - "Copy Symbols" button (for watchlist import)

### Sidebar & Routing

Add `{ label: "RS", path: "/equity/relative-strength", key: "RS", hint: "Momentum" }` after "Rotation".
Add route in App.tsx.

### Tests

**Backend** (`backend/tests/test_relative_strength.py`):
```python
# Test GET /api/rs/rankings returns ranked list
# Test RS scores are within valid range
# Test rankings are sorted by rs_score descending
# Test GET /api/rs/stock/RELIANCE returns RS series
# Test GET /api/rs/sectors returns sector-level RS
# Test GET /api/rs/new-highs returns stocks with new RS highs
# Test universe filter works (nifty50 returns <=50 stocks)
```

**E2E** (`frontend/tests/relative-strength.spec.ts`):
```typescript
// Navigate to /equity/relative-strength
// Verify rankings table loads with data
// Verify RS Score column has color coding
// Verify sparklines render in table cells
// Click "Sector RS" tab, verify horizontal bar chart renders
// Click "RS Chart" tab, enter symbol, verify dual-axis chart renders
// Click "New Highs" tab, verify table loads
// Change universe to "Nifty 50", verify table updates
```
