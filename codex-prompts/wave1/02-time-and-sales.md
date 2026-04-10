# TASK: Build Time & Sales (Tape Reader) Component and Page

## Project Context

OpenTerminalUI is a full-stack financial terminal application.

- **Frontend**: React 18.3.1 + TypeScript + Vite 6 + Tailwind CSS 3.4 + Zustand (state) + TanStack React Query
- **Backend**: FastAPI (Python 3.11) + SQLAlchemy ORM + SQLite
- **Real-time**: WebSocket streaming exists in `frontend/src/realtime/`. Backend has `/api/stream/` routes.
- **UI Pattern**: Dark terminal aesthetic. Use `TerminalPanel` from `frontend/src/components/terminal/TerminalPanel.tsx`.
- **Stock context**: `frontend/src/store/stockStore.ts` exports `useStockStore` with `ticker`, `interval` state.
- **Routing**: React Router 6 in `frontend/src/App.tsx`. Equity routes are children of `<EquityLayout>`.
- **Sidebar**: `frontend/src/components/layout/Sidebar.tsx` — `nav` array of `{label, path, key, hint}`.
- **API client**: `frontend/src/api/client.ts` exports axios instance.
- **Backend routes**: `backend/api/routes/`. Data adapters in `backend/adapters/`.
- **SecurityHub**: `frontend/src/pages/SecurityHub.tsx` has a tabbed interface with tabs like Overview, Financials, Chart, News, Ownership, Estimates, Peers, ESG.
- **Tests**: Backend pytest in `backend/tests/`. E2E Playwright in `frontend/tests/`.

## What to Build

### Backend: `backend/api/routes/tape.py`

```python
# GET /api/tape/{symbol}/recent?limit=500
# Returns: { trades: [ {timestamp, price, quantity, value, side: "buy"|"sell"|"neutral"} ] }
#
# GET /api/tape/{symbol}/summary
# Returns: { total_volume, buy_volume, sell_volume, buy_pct, large_trade_count, avg_trade_size, trades_per_min }
```

- `side` inference: if price moved up from previous → "buy", if moved down → "sell", else "neutral"
- Large trade = quantity > 2x the average trade size in the window
- If live tick data isn't available from adapter, generate simulated trades from recent 1-minute OHLCV bars (split each bar into ~10 trades with random distribution within the OHLC range, total volume matching bar volume)
- Register router in `backend/main.py` with prefix `/api/tape`

### Frontend: `frontend/src/components/market/TimeAndSales.tsx`

Build a high-performance scrolling tape reader:

1. **Trade Table** (virtualized for performance — cap at 2000 rows in DOM):
   - Columns: `Time` (HH:MM:SS), `Price`, `Size`, `Value`
   - Row coloring:
     - Buy (side === "buy"): `text-green-400` background with subtle `bg-green-500/5`
     - Sell (side === "sell"): `text-red-400` with `bg-red-500/5`
     - Neutral: `text-terminal-muted`
   - Large trades: add a thick left border `border-l-2 border-yellow-400` and bold text
   - Auto-scroll to newest trade at top
   - Pause auto-scroll on hover (show "Paused" indicator)

2. **Summary Bar** at top:
   - Total Volume | Buy Vol % (green) | Sell Vol % (red) | Large Trades Count | Trades/Min
   - Buy/Sell shown as a horizontal stacked bar (green left, red right)

3. **Filters**:
   - Toggle buttons: `All` | `Buys Only` | `Sells Only` | `Large Only`
   - Minimum size input (filter out small trades)

4. **Auto-refresh**: Poll `/api/tape/{symbol}/recent` every 5 seconds. Prepend new trades to existing list.

5. Use `useStockStore` to get current ticker. Re-fetch when ticker changes.

### Page: `frontend/src/pages/TimeAndSalesPage.tsx`

- Route: `/equity/tape`
- Layout: Left 65% = TimeAndSales component, Right 35% = mini chart (reuse existing chart components or just show a simple price sparkline using Recharts)
- Top: symbol display with last price and change

### Integration

**App.tsx**: Add route `<Route path="tape" element={<TimeAndSalesPage />} />`

**Sidebar.tsx**: Add `{ label: "Tape", path: "/equity/tape", key: "T", hint: "Time & Sales" }` after the "Workstation" entry.

**SecurityHubPage**: Add "Tape" as a 9th tab in the SecurityHub tabbed interface. When on this tab, render the `TimeAndSales` component using the hub's current ticker.

### Tests

**Backend** (`backend/tests/test_tape.py`):
```python
# Test GET /api/tape/RELIANCE/recent returns 200 with trades array
# Test each trade has: timestamp, price, quantity, side
# Test side values are one of: buy, sell, neutral
# Test GET /api/tape/RELIANCE/summary returns summary fields
# Test limit parameter works (limit=10 returns <=10 trades)
```

**E2E** (`frontend/tests/time-and-sales.spec.ts`):
```typescript
// Navigate to /equity/tape
// Verify page renders with trade table
// Verify summary bar shows volume metrics
// Click "Buys Only" filter, verify only green rows visible
// Navigate to security hub, click "Tape" tab, verify trades render for that ticker
```

## Code Style
- Named exports: `export function TimeAndSales()`, `export function TimeAndSalesPage()`
- Tailwind only, use terminal tokens: `text-terminal-text`, `bg-terminal-panel`, `border-terminal-border`
- Monospace font for trade data: add `font-mono` class to the table
- TypeScript interfaces for all data types
- React Query with `refetchInterval: 5000` for auto-refresh
