# TASK: Build Insider Activity / Bulk-Block Deal Tracker

## Project Context

OpenTerminalUI — React 18 + TypeScript + Vite + Tailwind + Zustand frontend, FastAPI + SQLAlchemy + SQLite backend. Terminal dark theme using `TerminalPanel`, `TerminalTabs`, `TerminalBadge` from `frontend/src/components/terminal/`. Existing insider_trades table exists in `backend/models/`. SecurityHub at `frontend/src/pages/SecurityHub.tsx` has 8 tabs. Sidebar nav in `frontend/src/components/layout/Sidebar.tsx`. API client in `frontend/src/api/client.ts`. Routes registered in `backend/main.py`. Tests: pytest + Playwright.

## What to Build

### Backend Routes: `backend/api/routes/insider.py`

The file may already exist — check first and extend it. If it doesn't exist, create it.

```
GET /api/insider/recent?days=30&min_value=1000000&type=buy|sell&limit=100
  Returns: { trades: [{date, symbol, name, insider_name, designation, type, quantity, price, value, post_holding_pct}] }

GET /api/insider/stock/{symbol}?days=365
  Returns: { trades: [...same shape], summary: {total_buys, total_sells, net_value, insider_count} }

GET /api/insider/top-buyers?days=90&limit=20
  Returns: { buyers: [{symbol, name, total_value, trade_count, avg_price}] }

GET /api/insider/top-sellers?days=90&limit=20
  Returns: { sellers: [{symbol, name, total_value, trade_count, avg_price}] }

GET /api/insider/cluster-buys?days=30&min_insiders=3
  Returns: { clusters: [{symbol, name, insider_count, total_value, insiders: [{name, designation, value}]}] }
  // Stocks where 3+ different insiders bought within the period — strong bullish signal
```

For data: query the existing `insider_trades` table. If empty, seed with sample data for testing (at least 50 rows covering 10 stocks, mix of buys and sells, various insiders).

### Frontend Page: `frontend/src/pages/InsiderActivityPage.tsx`

Route: `/equity/insider`

**Summary Cards Row** (top):
- Total Buy Value (30d) — green
- Total Sell Value (30d) — red
- Net Insider Flow (30d) — green if positive, red if negative
- Cluster Buy Stocks — count with link to tab

**Tabs**:

1. **"Recent Trades"** (default):
   - Sortable table with columns: Date | Symbol | Insider Name | Designation | Type (Buy/Sell) | Qty | Price | Value | Post-Holding %
   - Type column: green badge for Buy, red badge for Sell (use `TerminalBadge`)
   - Value column: formatted with commas and currency symbol
   - Filter bar: date range, min value input, buy/sell toggle, symbol search
   - Click symbol → navigate to `/equity/security/{symbol}`

2. **"Top Buyers"**:
   - Ranked table: #, Symbol, Name, Total Buy Value, Trade Count, Latest Buy Date
   - Bar chart showing top 10 by value (Recharts horizontal bar chart)

3. **"Top Sellers"**:
   - Same layout as Top Buyers but for sells

4. **"Cluster Buys"**:
   - Card layout: each card = one stock
   - Card shows: symbol, name, insider count badge, total value
   - Expand card to see individual insiders: name, designation, date, value
   - This is the most actionable tab — highlight it with a subtle glow border

### SecurityHub Integration

In `frontend/src/pages/SecurityHub.tsx`, add "Insider" as a 9th tab:
- Shows `InsiderStockDetail` component
- Fetches `/api/insider/stock/{ticker}` using the hub's current ticker
- Layout: summary cards (total buys, total sells, net) + trade table for that stock
- Timeline: show insider buys/sells as markers on a price chart (green triangles for buys, red for sells)

### Sidebar

Add `{ label: "Insider", path: "/equity/insider", key: "IN", hint: "Research" }` after the "Hotlists" entry.

### Tests

**Backend** (`backend/tests/test_insider.py`):
```python
# Test GET /api/insider/recent returns trades array
# Test GET /api/insider/stock/RELIANCE returns trades and summary
# Test GET /api/insider/top-buyers returns ranked list
# Test GET /api/insider/cluster-buys returns stocks with 3+ insiders
# Test filters: min_value, type=buy, days parameter
```

**E2E** (`frontend/tests/insider-activity.spec.ts`):
```typescript
// Navigate to /equity/insider
// Verify summary cards render with values
// Verify "Recent Trades" table has rows
// Click "Cluster Buys" tab, verify cards render
// Click "Top Buyers" tab, verify ranked table
// Navigate to security hub, click "Insider" tab, verify trades for that ticker
```
