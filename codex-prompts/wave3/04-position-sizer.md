# TASK: Build Position Sizing Calculator

## Project Context

OpenTerminalUI — React 18 + TypeScript + Vite + Tailwind + Zustand + Recharts frontend. Terminal dark theme using `TerminalPanel`, `TerminalInput` from `frontend/src/components/terminal/`. Sidebar nav in `frontend/src/components/layout/Sidebar.tsx`. App routing in `frontend/src/App.tsx`. No backend needed — all calculations are client-side. Tests: Playwright E2E.

## What to Build

### Frontend Page: `frontend/src/pages/PositionSizerPage.tsx`

Route: `/equity/position-sizer`

This is a **client-side only** calculator — no backend routes needed.

**Layout**: Two-column on desktop (input left, output right), stacked on mobile.

**Input Panel** (left):
- Account Size: number input with currency formatting (use settingsStore for INR/USD)
- Risk Per Trade: toggle between `% of account` and `Fixed amount` + number input
- Entry Price: number input
- Stop Loss Price: number input
- Target Price: number input (optional)
- Current ATR value: number input (optional, for ATR-based method)

**Method Tabs**:

1. **Fixed Fractional** (default):
   - Formula: `shares = (account * risk_pct) / abs(entry - stop)`
   - Inputs: risk % (default 1%)

2. **Kelly Criterion**:
   - Formula: `kelly_pct = win_rate - (1 - win_rate) / (avg_win / avg_loss)`
   - Additional inputs: Win Rate % (default 55%), Average Win, Average Loss
   - Show full Kelly %, half Kelly %, quarter Kelly %
   - Warning: "Full Kelly is aggressive. Half Kelly is recommended."

3. **ATR-Based**:
   - Formula: `shares = (account * risk_pct) / (atr_multiplier * atr)`
   - Additional inputs: ATR Multiplier (default 2.0), ATR value
   - Stop loss auto-calculated: `entry - (atr_multiplier * atr)` for longs

4. **Volatility Target**:
   - Formula: `shares = (account * target_vol) / (stock_annual_vol * price)`
   - Additional inputs: Target Portfolio Volatility % (default 15%), Stock Annual Volatility %

**Output Panel** (right):

- **Primary output box** (large, prominent):
  - Shares to Buy/Sell (big number)
  - Total Position Value
  - Position Size as % of Account

- **Risk Metrics box**:
  - Dollar/Rupee Risk (max loss at stop)
  - Risk as % of Account
  - Risk:Reward Ratio (if target provided): displayed as "1 : X.XX"
  - Potential Profit at Target (if target provided)

- **Visual Risk/Reward Bar**:
  - Horizontal bar showing risk (red, left) and reward (green, right) proportionally
  - Entry price marked in center

- **Position Summary Table**:
  | Metric | Value |
  |--------|-------|
  | Shares | 42 |
  | Entry | 2,500.00 |
  | Stop Loss | 2,450.00 |
  | Target | 2,600.00 |
  | Position Value | 1,05,000.00 |
  | Max Risk | 2,100.00 |
  | Potential Profit | 4,200.00 |
  | R:R Ratio | 1:2.00 |

**All calculations update in real-time** as inputs change (no "Calculate" button needed). Use React state with `useMemo` for computed values.

**Number formatting**: Use locale-aware formatting (Indian: 1,05,000, US: 105,000) based on `settingsStore.country`.

**Edge cases**:
- Stop loss on wrong side of entry → show validation error
- Division by zero (stop = entry) → show "Stop loss must differ from entry"
- Negative values → show validation error
- Kelly criterion > 100% → cap at 100% and show warning

### Sidebar Integration

Add `{ label: "Position Sizer", path: "/equity/position-sizer", key: "PS", hint: "Trading" }` after the "Paper" entry.

Add route in App.tsx under equity routes.

### Tests

**E2E** (`frontend/tests/position-sizer.spec.ts`):
```typescript
// Navigate to /equity/position-sizer
// Enter account size: 1000000
// Enter risk: 1%
// Enter entry price: 2500
// Enter stop loss: 2450
// Verify shares calculated: 200 (1000000 * 0.01 / 50 = 200)
// Verify position value: 500000
// Verify max risk: 10000
// Enter target: 2600
// Verify R:R ratio shows 1:2.00
// Switch to Kelly tab, enter win rate 60%, avg win 100, avg loss 50
// Verify Kelly % calculated correctly: 0.60 - 0.40/2 = 0.40 = 40%
// Test validation: set stop = entry, verify error message
```

**Vitest unit test** (`frontend/src/pages/__tests__/PositionSizerPage.test.tsx`):
```typescript
// Test fixed fractional calculation
// Test Kelly criterion formula
// Test ATR-based calculation
// Test edge cases: stop = entry, negative values
```
