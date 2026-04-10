# TASK: Build Multi-Timeframe Analysis (MTA) Dashboard

## Project Context

OpenTerminalUI — React 18 + TypeScript + Vite + Tailwind + Zustand frontend, FastAPI backend. Chart workstation at `frontend/src/pages/ChartWorkstationPage.tsx` with chart components in `frontend/src/components/chart/`. ChartContainer is the primary chart wrapper. Lightweight Charts library (`lightweight-charts`) used for charting. Store: `chartWorkstationStore.ts`, `stockStore.ts`. Terminal dark theme. Tests: Playwright.

## What to Build

### Frontend Page: `frontend/src/pages/MultiTimeframePage.tsx`

Route: `/equity/mta`

This is a **focused, purpose-built** multi-timeframe view — NOT a general-purpose workstation.

**Top Bar**:
- Symbol input (text input with autocomplete, uses existing symbol search)
- Preset buttons: `Position` (M/W/D/4H) | `Swing` (W/D/4H/1H) | `Day Trade` (D/1H/15m/5m) | `Scalp` (1H/15m/5m/1m)
- Crosshair sync toggle (default: on)

**Chart Grid** (2x2 CSS Grid, equal quadrants):

| Top-Left: Long-term | Top-Right: Medium-term |
|---------------------|------------------------|
| Bottom-Left: Short-term | Bottom-Right: Execution |

Each quadrant:
- Reuse existing `ChartContainer` component (or the lightweight-charts wrapper used in stock detail)
- Pass appropriate interval: depends on selected preset
- Compact header showing: interval label + current price
- Minimal controls: chart type toggle (candle/line), one indicator toggle (EMA 20/50/200)
- Same symbol across all 4 panels

**Default Preset** (Swing): Weekly / Daily / 4H / 1H

**Crosshair Sync**:
- When hovering on any chart, show crosshair on all 4 charts at the corresponding timestamp
- Use a shared React state or context to broadcast crosshair position
- Convert timestamps between timeframes (e.g., hovering on a weekly bar shows the corresponding daily range)

**Trend Summary Bar** (below charts):
- For each timeframe, show:
  - Interval label (W / D / 4H / 1H)
  - Trend arrow: green up arrow if price > EMA20, red down arrow if price < EMA20, yellow sideways if within 0.5%
  - Current price relative to EMA20: "Above EMA20 by 2.3%"
- Alignment indicator: if all 4 trends same direction → "ALIGNED" badge in green; mixed → "MIXED" in amber

**Responsive**: On mobile (< 768px), stack charts vertically (1 column).

### API Usage

Use existing chart API: `GET /api/chart/{symbol}?interval={interval}&range={range}`
No new backend routes needed — this page composes existing endpoints.

### Sidebar & Routing

Add `{ label: "MTA", path: "/equity/mta", key: "MT", hint: "Multi-TF" }` to Sidebar after "Workstation".
Add route in App.tsx.

### Tests

**E2E** (`frontend/tests/multi-timeframe.spec.ts`):
```typescript
// Navigate to /equity/mta
// Verify 4 chart panels render in a grid
// Change symbol to "TCS", verify all 4 charts update
// Click "Day Trade" preset, verify intervals change (should see shorter timeframes)
// Verify trend summary bar shows arrows for each timeframe
// Verify crosshair sync toggle is present
// On mobile viewport, verify charts stack vertically
```
