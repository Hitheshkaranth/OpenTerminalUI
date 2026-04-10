# TASK: Build Options Flow / Unusual Activity Tracker

## Project Context

OpenTerminalUI — React 18 + TypeScript + Vite + Tailwind + Zustand frontend, FastAPI + SQLAlchemy backend. Complete F&O module exists at `/fno` with pages in `frontend/src/fno/pages/` and backend services in `backend/fno/services/`. F&O layout in `frontend/src/fno/FnoLayout.tsx`. F&O routes registered under `/fno` in App.tsx. Backend F&O routes in `backend/api/routes/options.py`, `backend/api/routes/futures.py`. Terminal dark theme components in `frontend/src/components/terminal/`. Recharts and @nivo/heatmap available. Tests: pytest + Playwright.

## What to Build

### Backend Service: `backend/fno/services/flow_service.py`

```python
class OptionsFlowService:
    """Detect unusual options activity and large trades."""

    async def detect_unusual_activity(self, symbol: str = None, min_premium: float = 0) -> list:
        """
        For each option contract, compare current volume to 20-day average.
        Flag as unusual if: current_volume > 2 * avg_volume OR oi_change > 2 * avg_oi_change

        Return: [{
            timestamp, symbol, expiry, strike, option_type (CE/PE),
            volume, avg_volume, volume_ratio,
            oi, oi_change, premium_value,
            implied_vol,
            sentiment: "bullish" | "bearish",  # CE buy/PE sell = bullish, CE sell/PE buy = bearish
            heat_score: float  # 0-100 composite score
        }]
        """

    async def get_flow_summary(self, period: str = "1d") -> dict:
        """
        Aggregate flow data:
        {
            total_premium, bullish_premium, bearish_premium,
            bullish_pct, bearish_pct,
            top_symbols: [{symbol, premium, flow_count}],
            premium_by_hour: [{hour, bullish, bearish}]
        }
        """

    def compute_heat_score(self, volume_ratio, oi_change_ratio, premium_value) -> float:
        """Composite score 0-100 based on volume + OI + premium size."""
```

Heat score formula: `min(100, (volume_ratio * 20) + (oi_change_ratio * 15) + (premium_value / 1000000 * 10))`

Sentiment logic:
- CE with volume > OI change (likely buying) → bullish
- PE with volume > OI change (likely buying) → bearish
- CE with OI increase + volume (writing) → could be bearish
- Simplify to: CE high volume = bullish, PE high volume = bearish (v1 approximation)

### Backend Routes: `backend/api/routes/fno_flow.py`

```
GET /api/fno/flow/unusual?symbol=&min_premium=100000&option_type=CE|PE&expiry=&limit=100
  Returns: { flows: [...unusual_activity], count: N }

GET /api/fno/flow/summary?period=1d
  Returns: { total_premium, bullish_premium, bearish_premium, bullish_pct, top_symbols, premium_by_hour }

GET /api/fno/flow/ticker/{symbol}
  Returns: { flows: [...], ticker_summary: {total_premium, bullish_pct, top_strikes} }
```

If real unusual activity data isn't available, generate from option chain data: for each strike with volume > 0, compute vs historical average (or use OI data to infer).

Register in `backend/main.py`.

### Frontend Page: `frontend/src/fno/pages/OptionsFlowPage.tsx`

Route: `/fno/flow`

**Summary Bar** (top):
- Total Premium Traded (formatted: 12.5 Cr or $12.5M)
- Bullish % (green) vs Bearish % (red) — horizontal stacked bar
- Most Active Symbol badge
- Flow Count

**Main Table**:
- Columns: Time | Symbol | Expiry | Strike | Type (CE/PE) | Volume | OI Chg | Premium | IV | Heat Score | Sentiment
- Row coloring:
  - Bullish rows: subtle `bg-green-500/5` with green left border
  - Bearish rows: subtle `bg-red-500/5` with red left border
- Heat Score column: show as colored bar (cool blue → hot red)
- Sortable by: time (default), heat score, premium
- New items: brief highlight animation (flash) when data refreshes

**Filters**:
- Symbol search input
- Type toggle: All | Calls | Puts
- Expiry dropdown
- Min Premium slider/input
- Sort by dropdown

**Premium Flow Chart** (below table):
- Recharts stacked area chart: bullish (green) vs bearish (red) premium over time (hourly)
- Toggle between: today, last 5 days

**Click Row** → expand inline to show:
- Full option chain context for that strike
- Link to `/fno?symbol={symbol}` to see full chain

**Auto-refresh**: poll every 60 seconds. Highlight new entries.

### FnoLayout Integration

In `frontend/src/fno/FnoLayout.tsx`: add navigation link for "Flow" pointing to `/fno/flow`.

In `frontend/src/App.tsx`: add route `<Route path="flow" element={<OptionsFlowPage />} />` under the `/fno` route group.

### Tests

**Backend** (`backend/tests/test_fno_flow.py`):
```python
# Test GET /api/fno/flow/unusual returns flows array
# Test each flow has: symbol, strike, option_type, volume, heat_score, sentiment
# Test heat_score is between 0 and 100
# Test sentiment is "bullish" or "bearish"
# Test GET /api/fno/flow/summary returns aggregated data
# Test symbol filter works
# Test min_premium filter works
```

**E2E** (`frontend/tests/options-flow.spec.ts`):
```typescript
// Navigate to /fno/flow
// Verify summary bar renders with premium data
// Verify flow table has rows
// Click "Calls" filter, verify only CE rows visible
// Verify heat score bars render with color
// Click a row, verify expansion shows details
```
