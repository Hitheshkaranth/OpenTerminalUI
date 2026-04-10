# TASK: Build Level 2 DOM (Depth of Market) Ladder

## Project Context

OpenTerminalUI — React 18 + TypeScript + Vite + Tailwind + Zustand frontend, FastAPI + SQLAlchemy backend. Existing `OrderBookPanel` at `frontend/src/components/market/OrderBookPanel.tsx`. Depth route at `backend/api/routes/depth.py`. Stock store: `frontend/src/store/stockStore.ts`. Terminal dark theme. Tests: pytest + Playwright.

## What to Build

### Backend: Enhance `backend/api/routes/depth.py`

Ensure the depth endpoint returns structured L2 data:

```
GET /api/depth/{symbol}
Returns: {
  bids: [{price, quantity, orders, cumulative_qty}],   // sorted price desc (best bid first)
  asks: [{price, quantity, orders, cumulative_qty}],   // sorted price asc (best ask first)
  spread: float,
  spread_pct: float,
  last_price: float,
  last_qty: float,
  total_bid_qty: float,
  total_ask_qty: float,
  imbalance: float  // (total_bid - total_ask) / (total_bid + total_ask) -- range -1 to 1
}
```

If the endpoint already exists, extend it to include cumulative quantities and imbalance. If data isn't available from adapters, generate 20 levels of simulated depth around the last price.

### Frontend: `frontend/src/components/market/DOMLadder.tsx`

Professional DOM ladder visualization:

**Layout** (vertical ladder, CSS Grid):
- 3 columns: Bid Size | Price | Ask Size
- ~40 price rows visible (scrollable)
- Each row = one price tick increment

**Price Column** (center):
- All price levels from (last_price - 20 ticks) to (last_price + 20 ticks)
- Last traded price row: highlighted with `bg-terminal-accent/20` and bold text
- Spread rows (between best bid and best ask): dim `bg-terminal-bg/50`

**Bid Column** (left):
- Horizontal bar extending LEFT from center, width proportional to quantity (relative to max qty)
- Bar color: `bg-blue-500/30`
- Text: quantity number, right-aligned
- Best bid row: brighter bar `bg-blue-500/50`

**Ask Column** (right):
- Horizontal bar extending RIGHT from center, width proportional to quantity
- Bar color: `bg-red-500/30`
- Text: quantity number, left-aligned
- Best ask row: brighter bar `bg-red-500/50`

**Imbalance Highlighting**:
- If bid qty > 2x ask qty at a level: blue glow on that row
- If ask qty > 2x bid qty at a level: red glow on that row

**Features**:
- Auto-center on last price (toggle button)
- Cumulative depth toggle: show running total instead of level quantity
- Spread display: show spread value and bps between best bid/ask
- Imbalance meter: horizontal bar showing overall bid vs ask imbalance
- Volume at price overlay: subtle background bars showing session volume traded at each price level

**Controls** (top bar):
- Symbol display with last price, change
- Auto-center toggle
- Cumulative toggle
- Depth levels selector: 10 | 20 | 40 levels
- Refresh rate: 1s | 2s | 5s

**Real-time**: Poll `/api/depth/{symbol}` at selected refresh rate. Animate quantity changes (flash green when bid increases, red when decreases).

### Page: `frontend/src/pages/DOMPage.tsx`

Route: `/equity/dom`

Layout:
- Left (60%): DOM Ladder component
- Right (40%): Simple trade log / time and sales (if TimeAndSales from Wave 1 exists, reuse it; otherwise show a simple last-trades list)
- Top: symbol input, last price, change, spread

### Sidebar & Routing

Add `{ label: "DOM", path: "/equity/dom", key: "D", hint: "Depth" }` to Sidebar.tsx after "Workstation".
Add route in App.tsx.

### Tests

**Backend** (`backend/tests/test_dom.py`):
```python
# Test GET /api/depth/RELIANCE returns bids and asks arrays
# Test bids are sorted by price descending
# Test asks are sorted by price ascending
# Test cumulative quantities are monotonically increasing
# Test spread = best_ask - best_bid
# Test imbalance is between -1 and 1
```

**E2E** (`frontend/tests/dom-ladder.spec.ts`):
```typescript
// Navigate to /equity/dom
// Verify DOM ladder renders with price rows
// Verify bid bars appear on left side
// Verify ask bars appear on right side
// Verify spread is displayed between best bid and best ask
// Toggle cumulative mode, verify quantities change to running totals
// Verify auto-center keeps last price in view
```

## Code Style
- Use CSS Grid for the ladder layout (`grid-template-columns: 1fr auto 1fr`)
- Monospace font (`font-mono`) for all numbers
- Bar widths via inline `style={{ width: `${pct}%` }}` — this is the one exception to "no inline styles"
- All other styling via Tailwind terminal tokens
- Smooth transitions on bar width changes: `transition-all duration-200`
