# TASK: Optimize Mobile Trading Experience

## Project Context

OpenTerminalUI — React 18 + TypeScript + Vite + Tailwind + Zustand frontend. Existing mobile components: `MobileBottomNav.tsx` at `frontend/src/components/layout/MobileBottomNav.tsx`. Mobile E2E tests at `frontend/tests/mobile-interactions.spec.ts`. Responsive breakpoints via Tailwind (sm: 640px, md: 768px, lg: 1024px). Stock store: `stockStore.ts`. Terminal dark theme. Tests: Playwright with Pixel 7 profile.

## What to Build

### Frontend: `frontend/src/components/mobile/MobileQuickView.tsx`

Swipeable watchlist card stack for mobile:

- Horizontal scrollable card row (CSS `overflow-x-auto snap-x`)
- Each card (snap point, ~280px wide):
  - Symbol (large, bold)
  - Current price + change % (green/red)
  - Sparkline mini chart (last 20 data points, Recharts `<Sparklines>` or simple SVG path)
  - Bid / Ask prices (small text)
  - Volume (formatted)
- Touch interactions:
  - Tap card: navigate to `/equity/security/{symbol}`
  - Long press: show quick action menu (Set Alert, Add to Watchlist, Paper Trade)
- Data source: current watchlist from watchlist store/API
- Auto-refresh quotes every 10 seconds

### Frontend: `frontend/src/components/mobile/MobileChartView.tsx`

Optimized chart experience for touch devices:

- Full-width chart container
- Touch gesture support:
  - Pinch to zoom (use CSS `touch-action: manipulation`)
  - Two-finger horizontal pan
  - Double-tap to reset zoom
  - Long press for crosshair mode (shows price/time at touch point)
- Simplified controls (bottom sheet pattern):
  - Swipe-up bottom sheet for:
    - Timeframe selector (horizontal pill row: 1m | 5m | 15m | 1H | D | W)
    - Chart type toggle (Candle | Line | Area)
    - Indicator quick-toggle (top 5: EMA20, EMA50, RSI, MACD, Volume)
  - Sheet has 3 states: collapsed (just timeframe pills visible), half-open, full-open
- Landscape mode:
  - Detect orientation change
  - In landscape: full-screen chart, hide all chrome except minimal controls
  - Show rotation hint icon on portrait chart

### Frontend: `frontend/src/components/mobile/MobileFAB.tsx`

Floating Action Button for quick actions:

- Circular button (56px), positioned bottom-right, above MobileBottomNav
- Accent color (`bg-terminal-accent`)
- Tap to expand into radial menu:
  - Search (magnifying glass) → opens symbol search modal
  - Alert (bell) → quick alert creation for current symbol
  - Paper Trade (chart) → quick paper trade order
  - Scan (radar) → run favorite screener preset
- Collapse on backdrop tap or button re-tap
- Subtle entrance animation (scale up)

### Frontend: Mobile-Optimized Data Views

Create responsive alternatives for data-heavy pages. Add these as conditional renders (show on `md:` breakpoint and below):

1. **MobileScreenerResults** (`frontend/src/components/mobile/MobileScreenerResults.tsx`):
   - Card layout instead of table
   - Each result card: symbol (large), name, key metrics (PE, ROE, Market Cap)
   - Infinite scroll instead of pagination
   - Swipe right to add to watchlist, left to dismiss

2. **MobilePortfolioView** (`frontend/src/components/mobile/MobilePortfolioView.tsx`):
   - Summary card: total value, daily P&L, total P&L
   - Holdings as collapsible cards (tap to expand details)
   - Pie chart (compact) for allocation
   - Pull-to-refresh gesture

3. **MobileNewsCards** (`frontend/src/components/mobile/MobileNewsCards.tsx`):
   - Card stack layout (not table)
   - Each card: headline, source, time, sentiment badge
   - Tap to read full article
   - Filter pills at top: All | Positive | Negative

### Integration

1. In `MobileBottomNav.tsx`:
   - Add the MobileFAB component
   - Ensure FAB doesn't overlap with bottom nav items

2. In pages that need mobile optimization (Screener, Portfolio, News):
   - Add responsive conditional rendering:
   ```tsx
   <div className="hidden md:block">{/* Desktop table view */}</div>
   <div className="md:hidden">{/* Mobile card view */}</div>
   ```

3. In chart-related pages:
   - Detect mobile viewport and render MobileChartView instead of desktop chart

4. Add MobileQuickView to the Home page (mobile only) as a watchlist overview section

### Tests

**E2E** (`frontend/tests/mobile-optimization.spec.ts`):
Use Playwright's Pixel 7 profile (already configured in `playwright.config.ts`):

```typescript
// Test MobileQuickView:
// Navigate to home page on mobile viewport
// Verify watchlist cards render horizontally
// Tap a card, verify navigation to security page

// Test MobileFAB:
// Verify FAB button visible on mobile
// Tap FAB, verify radial menu expands
// Tap backdrop, verify menu collapses

// Test MobileChartView:
// Navigate to stock page on mobile
// Verify chart renders full-width
// Verify bottom sheet with timeframe pills is visible
// Tap "1H" timeframe, verify chart updates

// Test MobileScreenerResults:
// Navigate to screener on mobile
// Verify results show as cards (not table)
// Scroll down, verify infinite scroll loads more

// Test MobilePortfolioView:
// Navigate to portfolio on mobile
// Verify summary card with total value
// Tap a holding card, verify it expands with details
```

## Important Notes
- All mobile components should use `touch-action` CSS properties appropriately
- Use `@media (pointer: coarse)` for touch-specific styles where needed
- Ensure minimum touch target sizes of 44x44px (Apple HIG)
- Test with both iOS Safari and Android Chrome viewports
- Do NOT break desktop layout — all changes are additive with responsive conditionals
