# TASK: Build Correlation Analysis Dashboard

## Project Context

OpenTerminalUI — React 18 + TypeScript + Vite + Tailwind + Zustand + Recharts + @nivo/heatmap frontend, FastAPI + SQLAlchemy backend. Portfolio heatmap component exists at `frontend/src/components/portfolio/PortfolioHeatmap.tsx`. Risk engine at `backend/risk_engine/`. d3-hierarchy and d3-scale-chromatic available. Terminal dark theme. Tests: pytest + Playwright.

## What to Build

### Backend Routes: `backend/api/routes/correlation.py`

```
POST /api/correlation/matrix
  Body: {symbols: ["RELIANCE", "TCS", "HDFCBANK", ...], period: "1Y", frequency: "daily"}
  Returns: {
    symbols: ["RELIANCE", "TCS", ...],
    matrix: [[1.0, 0.45, ...], [0.45, 1.0, ...], ...],
    period_start, period_end
  }
  - Compute pairwise Pearson correlation from daily returns
  - Cache result for 1 hour

POST /api/correlation/rolling
  Body: {symbol1: "RELIANCE", symbol2: "TCS", window: 60, period: "3Y"}
  Returns: {
    series: [{date, correlation}],
    current: float,
    avg: float,
    min: float, max: float,
    regimes: [{start, end, avg_correlation, label: "high"|"medium"|"low"}]
  }
  - Rolling Pearson correlation with given window
  - Regime detection: split into segments where correlation is consistently high (>0.6), medium (0.3-0.6), or low (<0.3)

POST /api/correlation/clusters
  Body: {symbols: [...], period: "1Y", n_clusters: 4}
  Returns: {
    clusters: [{cluster_id, symbols: [...], avg_intra_correlation}],
    dendrogram: {children: [...], distance: float}  // hierarchical clustering tree
  }
  - Use hierarchical clustering (scipy or manual implementation)
  - Distance = 1 - correlation
```

Register in `backend/main.py`.

### Frontend Page: `frontend/src/pages/CorrelationDashboardPage.tsx`

Route: `/equity/correlation`

**Symbol Input Bar** (top):
- Multi-symbol input: type to search, click to add (chip/tag pattern)
- Quick-add buttons: "Nifty 50 Top 10", "My Portfolio", "Bank Stocks", "IT Stocks"
- Max 20 symbols
- Remove individual symbols (X on chip)

**Tabs**:

1. **"Matrix"** (default):
   - NxN heatmap using @nivo/heatmap
   - Color scale: red (-1) → white (0) → blue (+1)
   - Cell labels show correlation value (2 decimal places)
   - Diagonal always 1.00 (highlighted)
   - Click any cell → switch to Rolling tab with that pair selected
   - Period selector: 1M | 3M | 6M | 1Y | 3Y

2. **"Rolling"**:
   - Pair selector: two dropdowns (from selected symbols)
   - Recharts LineChart: rolling correlation over time
   - Zero line and ±0.5 reference lines (dashed)
   - Window size selector: 20 | 30 | 60 | 90 | 120 days
   - Regime highlighting: shade background green (high corr), yellow (medium), red (low)
   - Stats card: current, average, min, max correlation

3. **"Clusters"**:
   - Cluster cards: each cluster shows its symbols and average intra-cluster correlation
   - Color-coded cluster badges
   - "Decorrelated Pairs" section: pairs with lowest correlation (diversification opportunities)
   - Number of clusters slider: 2-8

### Sidebar Integration

Add `{ label: "Correlation", path: "/equity/correlation", key: "CR", hint: "Risk" }` after the "Risk" entry.

Add route in App.tsx: `<Route path="correlation" element={<CorrelationDashboardPage />} />`

### Tests

**Backend** (`backend/tests/test_correlation.py`):
```python
# Test POST /api/correlation/matrix returns NxN matrix with valid correlations (-1 to 1)
# Test diagonal values are 1.0
# Test matrix is symmetric
# Test POST /api/correlation/rolling returns time series
# Test regime detection produces valid labels
# Test POST /api/correlation/clusters returns cluster assignments
```

**E2E** (`frontend/tests/correlation-dashboard.spec.ts`):
```typescript
// Navigate to /equity/correlation
// Add 5 symbols via input
// Verify heatmap renders with colored cells
// Click a cell, verify switch to Rolling tab with pair selected
// Verify rolling line chart renders
// Click Clusters tab, verify cluster cards render
```
