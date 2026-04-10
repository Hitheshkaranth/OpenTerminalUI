# TASK: Build Market Cap Heatmap Treemap Page

## Project Context

OpenTerminalUI is a full-stack financial terminal application.

- **Frontend**: React 18.3.1 + TypeScript + Vite 6 + Tailwind CSS 3.4 + Zustand (state) + TanStack React Query
- **Backend**: FastAPI (Python 3.11) + SQLAlchemy ORM + SQLite
- **Charts**: Lightweight Charts, Recharts, @nivo/bar, @nivo/heatmap, d3-hierarchy, d3-scale-chromatic (all installed)
- **UI Pattern**: Dark terminal aesthetic — use `TerminalPanel` from `frontend/src/components/terminal/TerminalPanel.tsx` for page sections
- **Routing**: React Router 6 in `frontend/src/App.tsx`. Routes under `/equity/*` are children of `<EquityLayout>`. Pages lazy-loaded via `lazyWithRetry`.
- **Sidebar**: `frontend/src/components/layout/Sidebar.tsx` has a `nav` array of `{label, path, key, hint}` items rendered as NavLinks
- **API client**: `frontend/src/api/client.ts` exports an axios instance with base URL from `VITE_API_BASE_URL`
- **Backend routes**: registered in `backend/main.py` via `app.include_router()`. Route files in `backend/api/routes/`
- **Data adapters**: `backend/adapters/` with Yahoo, FMP, NSE clients. Use `backend/core/adapter_registry.py` to get adapters.
- **Tests**: Backend pytest in `backend/tests/`. Frontend Vitest. E2E Playwright in `frontend/tests/`.

## What to Build

### Backend: `backend/api/routes/heatmap.py`

Create a new route module:

```python
# GET /api/heatmap/treemap?market=IN&group=sector&period=1d&size_by=market_cap
# Returns: { data: [ {symbol, name, sector, industry, market_cap, change_pct, volume, turnover} ] }
```

- Accept query params: `market` (IN/US), `group` (sector/industry), `period` (1d/1w/1m/3m/ytd/1y), `size_by` (market_cap/volume/turnover)
- Fetch stock universe data from the appropriate adapter (NSE for IN, Yahoo for US)
- For IN market: Nifty 200 universe. For US: S&P 500 top 100 by market cap
- Include sector and industry classification
- Cache response for 5 minutes using a simple TTL dict cache
- Register the router in `backend/main.py` with prefix `/api/heatmap`

### Frontend: `frontend/src/pages/MarketHeatmapPage.tsx`

Build a full-page interactive treemap:

1. **Data fetching**: Use `useQuery` from TanStack React Query to fetch `/api/heatmap/treemap`
2. **Treemap rendering** using `d3-hierarchy` and `d3-treemap`:
   - Each rectangle = one stock
   - Size = market_cap (or selected `size_by` metric)
   - Color = `change_pct` mapped to a diverging color scale:
     - Deep red (`#dc2626`) for <= -5%
     - Red (`#ef4444`) for -3%
     - Orange (`#f97316`) for -1%
     - Gray (`#6b7280`) for ~0%
     - Light green (`#22c55e`) for +1%
     - Green (`#16a34a`) for +3%
     - Deep green (`#15803d`) for >= +5%
   - Use `d3-scale-chromatic` for `interpolateRdYlGn`
3. **Rectangle content**: Show ticker and change% text. For large rectangles also show company name.
4. **Hover tooltip**: Show symbol, name, sector, price, change%, volume, market cap (formatted with K/M/B/T suffixes)
5. **Click**: Navigate to `/equity/security/{ticker}` using React Router `useNavigate`
6. **Toolbar** at top:
   - Market toggle: `IN` / `US` (buttons)
   - Period selector: `1D | 1W | 1M | 3M | YTD | 1Y` (button group)
   - Group by: `Sector | Industry` (toggle)
   - Size by: `Market Cap | Volume | Turnover` (dropdown)
7. **Drill-down**: Click a sector label to zoom into that sector showing its stocks. Show breadcrumb: `All > {Sector}`. Click "All" to zoom out.
8. **Responsive**: On screens < 768px, show a colored list instead of treemap (each row: symbol, change%, colored bar)
9. Wrap entire page in `TerminalPanel` with title "Market Heatmap"

### Routing Integration

In `frontend/src/App.tsx`:
- Add lazy import: `const MarketHeatmapPage = lazyWithRetry(() => import("./pages/MarketHeatmapPage").then((m) => ({ default: m.MarketHeatmapPage })));`
- Add route under the `/equity` route group: `<Route path="heatmap" element={<MarketHeatmapPage />} />`

In `frontend/src/components/layout/Sidebar.tsx`:
- Add to the `nav` array: `{ label: "Heatmap", path: "/equity/heatmap", key: "HM", hint: "Market" }`
- Place it after the "Hotlists" entry

### Tests

**Backend** (`backend/tests/test_heatmap.py`):
```python
# Test GET /api/heatmap/treemap?market=IN returns 200 with array of objects
# Test each object has: symbol, name, sector, change_pct, market_cap
# Test invalid market param returns 422
# Test caching: two rapid calls return same data
```

**Frontend E2E** (`frontend/tests/market-heatmap.spec.ts`):
```typescript
// Navigate to /equity/heatmap
// Verify page title "Market Heatmap" is visible
// Verify SVG treemap renders (look for SVG rect elements)
// Click period "1W" button, verify it becomes active
// Hover over a rectangle, verify tooltip appears
// Click a rectangle, verify navigation to /equity/security/{ticker}
```

## Code Style Requirements
- Use `export function ComponentName()` (named exports)
- Tailwind classes for all styling — no inline styles, no CSS modules
- Use existing terminal color tokens: `text-terminal-text`, `text-terminal-muted`, `bg-terminal-panel`, `border-terminal-border`, `text-terminal-accent`, `bg-terminal-bg`
- TypeScript strict mode — define interfaces for all data shapes
- API responses typed with interfaces
- React Query with `staleTime: 300_000` for 5-minute cache
- Error and loading states using existing patterns from other pages
