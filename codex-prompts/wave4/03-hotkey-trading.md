# TASK: Build Hot Key Trading Panel for Paper Trading

## Project Context

OpenTerminalUI — React 18 + TypeScript + Vite + Tailwind + Zustand frontend, FastAPI backend. Paper trading exists: page at `frontend/src/pages/PaperTrading.tsx`, backend at `backend/paper_trading/`, routes at `backend/api/routes/paper.py`. Stock store: `stockStore.ts` with `ticker`. Terminal dark theme. Tests: Playwright.

## What to Build

### Frontend: `frontend/src/components/trading/HotKeyPanel.tsx`

A compact, keyboard-driven order entry widget for paper trading:

**Header**:
- Symbol display (from stockStore.ticker): bold, large
- Last price, change %, bid/ask (from existing quote data)
- "PAPER" badge in amber — always visible, non-removable

**Position Display** (if position exists):
- Current position: +100 LONG or -50 SHORT
- Avg entry price
- Unrealized P&L (green/red)
- Market value

**Order Entry**:
- Quantity input: number field with +/- buttons
- Quick quantity buttons: `1x | 5x | 10x | 25x | Max`
- Order type toggle: `Market` | `Limit`
- Limit price input (visible only when Limit selected, auto-fills with last price)
- BUY button (green, full width) + SELL button (red, full width)

**Keyboard Shortcuts** (active when panel is focused):
- `B`: Submit buy at market
- `S`: Submit sell at market
- `Shift+B`: Submit buy at limit
- `Shift+S`: Submit sell at limit
- `F`: Flatten (close entire position)
- `R`: Reverse (flip long to short or vice versa)
- `+` / `=`: Increase quantity by 1x
- `-`: Decrease quantity by 1x
- `Esc`: Cancel all pending orders

Show shortcut hints on buttons: "BUY (B)" "SELL (S)"

**Recent Orders** (bottom):
- Last 5 orders: time, side, qty, price, status
- Compact table, no pagination

**Visual Feedback**:
- On order execution: brief flash (green for buy, red for sell) on entire panel border
- Order confirmation: brief toast "Bought 10 RELIANCE @ 2500"

**Keyboard Focus**:
- Panel captures keyboard when clicked/focused
- Visual indicator when focused: accent border glow
- Tab to move focus in/out

### Integration Points

1. **Floating Widget** (Ctrl+T to toggle):
   - Create `frontend/src/components/trading/HotKeyPanelFloat.tsx`
   - Fixed position, bottom-right corner, 320px wide
   - Draggable (use simple mousedown/mousemove drag)
   - Minimize/close buttons

2. **Add as Launchpad panel type**: In the launchpad panel registry, register HotKeyPanel as an available panel.

3. **Connect to Paper Trading API**:
   - Use existing paper trading routes: POST `/api/paper/orders` to place orders
   - Fetch position from existing paper positions endpoint
   - Invalidate React Query cache after order placement

### Page: No dedicated page needed. Available via:
- Ctrl+T floating widget (globally accessible)
- Embedded in PaperTradingPage as an additional component
- Launchpad panel

### Tests

**E2E** (`frontend/tests/hotkey-trading.spec.ts`):
```typescript
// Press Ctrl+T, verify HotKeyPanel float appears
// Verify "PAPER" badge is visible
// Verify symbol shows current ticker
// Enter quantity 10
// Click BUY button, verify order placed (check paper orders API)
// Verify recent orders shows the new order
// Press Ctrl+T again, verify panel closes
// Verify keyboard shortcuts hint text on buttons
```

## Important Notes
- This is PAPER TRADING ONLY. The "PAPER" badge must always be visible.
- Never call any real brokerage API.
- Use existing paper trading backend — don't create new order routes.
