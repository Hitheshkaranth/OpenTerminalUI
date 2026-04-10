# TASK: Enhance Launchpad with Drag-and-Drop Panel Management

## Project Context

OpenTerminalUI — React 18 + TypeScript + Vite + Tailwind + Zustand frontend. Launchpad exists: page at `frontend/src/pages/Launchpad.tsx`, components at `frontend/src/components/layout/LaunchpadWorkspace.tsx`, `LaunchpadGrid.tsx`, `LaunchpadPanels.tsx`. Uses `react-grid-layout` (already installed). Chart workstation store at `frontend/src/store/chartWorkstationStore.ts`. Terminal dark theme. Tests: Playwright.

## What to Build

### Frontend: `frontend/src/components/layout/PanelPalette.tsx`

A sidebar panel showing available widget types that can be dragged onto the grid:

**Panel Types Registry** (`frontend/src/data/panelTypes.ts`):
```typescript
export const PANEL_TYPES = [
  { type: "chart", label: "Chart", icon: "ChartBarIcon", description: "Price chart with indicators", minW: 4, minH: 3 },
  { type: "watchlist", label: "Watchlist", icon: "ListBulletIcon", description: "Symbol watchlist with quotes", minW: 3, minH: 3 },
  { type: "news", label: "News Feed", icon: "NewspaperIcon", description: "Market news and sentiment", minW: 3, minH: 3 },
  { type: "screener", label: "Screener", icon: "FunnelIcon", description: "Stock screener results", minW: 4, minH: 3 },
  { type: "portfolio", label: "Portfolio", icon: "BriefcaseIcon", description: "Portfolio summary", minW: 4, minH: 3 },
  { type: "alerts", label: "Alerts", icon: "BellIcon", description: "Active alerts", minW: 3, minH: 2 },
  { type: "option-chain", label: "Option Chain", icon: "TableCellsIcon", description: "F&O option chain", minW: 6, minH: 4 },
  { type: "risk-metrics", label: "Risk Metrics", icon: "ShieldCheckIcon", description: "Portfolio risk", minW: 3, minH: 3 },
  { type: "market-heatmap", label: "Heatmap", icon: "Squares2X2Icon", description: "Market treemap", minW: 4, minH: 4 },
  { type: "economic-calendar", label: "Econ Calendar", icon: "CalendarIcon", description: "Economic events", minW: 3, minH: 3 },
  { type: "ticker-tape", label: "Ticker Tape", icon: "ArrowTrendingUpIcon", description: "Scrolling quotes", minW: 6, minH: 1 },
  { type: "trade-journal", label: "Journal", icon: "BookOpenIcon", description: "Recent trades", minW: 4, minH: 3 },
];
```

**PanelPalette Component**:
- Collapsible sidebar (left side of launchpad, 200px wide)
- Toggle button to show/hide
- Search input to filter panel types
- Each panel type as a draggable card:
  - Icon + Label + Description
  - Drag handle indicator
  - Use react-grid-layout's drag-from-outside feature or HTML5 drag API
- When dragged onto grid: creates new panel with default size (minW x minH)

### Frontend: Enhanced Panel Chrome

Enhance `frontend/src/components/layout/PanelChrome.tsx` (or create wrapper):

- **Panel header actions** (top-right of each panel):
  - Minimize button (collapse to just header bar)
  - Maximize button (expand to full grid)
  - Close button (X) with confirmation if panel has state
  - Settings gear (panel-specific settings)
- **Context menu** (right-click on panel header):
  - Duplicate Panel
  - Replace Panel Type → opens panel type picker
  - Remove Panel
  - Reset to Default

### Frontend: Layout Persistence

Enhance existing store (or create `frontend/src/store/launchpadStore.ts`):

```typescript
interface LaunchpadState {
  layouts: SavedLayout[];
  activeLayoutId: string | null;
  currentPanels: PanelInstance[];

  saveLayout: (name: string) => void;
  saveLayoutAs: (name: string) => void;
  loadLayout: (id: string) => void;
  deleteLayout: (id: string) => void;
  renameLayout: (id: string, name: string) => void;

  addPanel: (type: string, position?: { x: number; y: number }) => void;
  removePanel: (panelId: string) => void;
  duplicatePanel: (panelId: string) => void;
  updatePanelLayout: (panelId: string, grid: GridPosition) => void;
  minimizePanel: (panelId: string) => void;
  maximizePanel: (panelId: string) => void;
}
```

Persist to localStorage. Auto-save current layout on changes (debounced 2 seconds).

### Frontend: Layout Management UI

In LaunchpadPage toolbar:
- Layout dropdown: list of saved layouts + "Default"
- "Save" button (saves to current layout)
- "Save As" button → name input dialog
- "Delete" button (for custom layouts, not built-in)
- "Export" button → copies layout JSON to clipboard
- "Import" button → paste JSON dialog

### Integration into Launchpad.tsx

1. Add PanelPalette sidebar (toggleable)
2. Enhance existing grid to support:
   - Drop new panels from palette
   - Panel resize with minimum size enforcement
   - Panel reordering via drag
3. Add panel chrome actions (minimize/maximize/close) to each panel
4. Add layout management toolbar
5. Auto-save layout changes

### Tests

**E2E** (`frontend/tests/enhanced-launchpad.spec.ts`):
```typescript
// Navigate to /equity/launchpad
// Click palette toggle, verify panel palette sidebar opens
// Verify panel types listed (Chart, Watchlist, News, etc.)
// Drag "Chart" panel onto grid (or click to add), verify new chart panel appears
// Right-click panel header, verify context menu shows
// Click "Remove Panel" from context menu, verify panel removed
// Click "Save As", enter name "My Layout", save
// Verify layout appears in layout dropdown
// Delete custom layout, verify removed from dropdown
// Close and reopen launchpad, verify last layout auto-loaded
```
