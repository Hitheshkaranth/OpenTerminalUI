# TASK: Build Workspace Template System for Launchpad

## Project Context

OpenTerminalUI — React 18 + TypeScript + Vite + Tailwind + Zustand frontend. Launchpad at `frontend/src/pages/Launchpad.tsx` with components in `frontend/src/components/layout/LaunchpadWorkspace.tsx`, `LaunchpadGrid.tsx`, `LaunchpadPanels.tsx`. Uses `react-grid-layout` for grid. Chart workstation store at `frontend/src/store/chartWorkstationStore.ts`. Terminal dark theme. Tests: Playwright.

## What to Build

### Frontend: `frontend/src/data/workspaceTemplates.ts`

```typescript
export interface WorkspaceTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;          // Heroicon name or emoji
  category: "trading" | "research" | "portfolio" | "macro" | "custom";
  panels: PanelConfig[];
  gridCols: number;      // 2 or 3 columns
}

export interface PanelConfig {
  id: string;
  type: string;          // component type key
  title: string;
  props: Record<string, any>;  // props to pass to component
  grid: { x: number; y: number; w: number; h: number };
}

export const BUILTIN_TEMPLATES: WorkspaceTemplate[] = [
  {
    id: "day-trading",
    name: "Day Trading",
    description: "Intraday charts, depth, and tape for active trading",
    icon: "bolt",
    category: "trading",
    gridCols: 2,
    panels: [
      { id: "p1", type: "chart", title: "1-Min Chart", props: { interval: "1m" }, grid: { x: 0, y: 0, w: 6, h: 6 } },
      { id: "p2", type: "chart", title: "5-Min Chart", props: { interval: "5m" }, grid: { x: 6, y: 0, w: 6, h: 6 } },
      { id: "p3", type: "watchlist", title: "Watchlist", props: {}, grid: { x: 0, y: 6, w: 6, h: 4 } },
      { id: "p4", type: "news", title: "News Feed", props: {}, grid: { x: 6, y: 6, w: 6, h: 4 } },
    ],
  },
  {
    id: "swing-trading",
    name: "Swing Trading",
    description: "Daily/weekly charts with screener and fundamentals",
    icon: "chart-bar",
    category: "trading",
    gridCols: 3,
    panels: [
      { id: "p1", type: "chart", title: "Daily Chart", props: { interval: "1d" }, grid: { x: 0, y: 0, w: 8, h: 6 } },
      { id: "p2", type: "chart", title: "Weekly Chart", props: { interval: "1w" }, grid: { x: 8, y: 0, w: 4, h: 6 } },
      { id: "p3", type: "screener", title: "Screener", props: {}, grid: { x: 0, y: 6, w: 6, h: 4 } },
      { id: "p4", type: "news", title: "News", props: {}, grid: { x: 6, y: 6, w: 6, h: 4 } },
    ],
  },
  {
    id: "options-desk",
    name: "Options Desk",
    description: "Option chain, Greeks, IV analysis, and payoff diagrams",
    icon: "table-cells",
    category: "trading",
    gridCols: 2,
    panels: [
      { id: "p1", type: "chart", title: "Underlying Chart", props: { interval: "15m" }, grid: { x: 0, y: 0, w: 6, h: 5 } },
      { id: "p2", type: "option-chain", title: "Option Chain", props: {}, grid: { x: 6, y: 0, w: 6, h: 5 } },
      { id: "p3", type: "greeks", title: "Greeks Heatmap", props: {}, grid: { x: 0, y: 5, w: 6, h: 5 } },
      { id: "p4", type: "oi-chart", title: "OI Analysis", props: {}, grid: { x: 6, y: 5, w: 6, h: 5 } },
    ],
  },
  {
    id: "research",
    name: "Research",
    description: "Security analysis with financials, news, and peers",
    icon: "magnifying-glass",
    category: "research",
    gridCols: 2,
    panels: [
      { id: "p1", type: "overview", title: "Company Overview", props: {}, grid: { x: 0, y: 0, w: 6, h: 5 } },
      { id: "p2", type: "financials", title: "Financials", props: {}, grid: { x: 6, y: 0, w: 6, h: 5 } },
      { id: "p3", type: "news", title: "News & Sentiment", props: {}, grid: { x: 0, y: 5, w: 6, h: 5 } },
      { id: "p4", type: "peers", title: "Peer Comparison", props: {}, grid: { x: 6, y: 5, w: 6, h: 5 } },
    ],
  },
  {
    id: "portfolio-review",
    name: "Portfolio Review",
    description: "Holdings, allocation, performance, and risk at a glance",
    icon: "briefcase",
    category: "portfolio",
    gridCols: 2,
    panels: [
      { id: "p1", type: "portfolio-summary", title: "Holdings", props: {}, grid: { x: 0, y: 0, w: 6, h: 5 } },
      { id: "p2", type: "portfolio-allocation", title: "Allocation", props: {}, grid: { x: 6, y: 0, w: 6, h: 5 } },
      { id: "p3", type: "portfolio-performance", title: "Performance", props: {}, grid: { x: 0, y: 5, w: 6, h: 5 } },
      { id: "p4", type: "risk-metrics", title: "Risk Metrics", props: {}, grid: { x: 6, y: 5, w: 6, h: 5 } },
    ],
  },
  {
    id: "macro",
    name: "Macro Dashboard",
    description: "Yield curve, sector rotation, economics, and heatmap",
    icon: "globe-alt",
    category: "macro",
    gridCols: 2,
    panels: [
      { id: "p1", type: "yield-curve", title: "Yield Curve", props: {}, grid: { x: 0, y: 0, w: 6, h: 5 } },
      { id: "p2", type: "sector-rotation", title: "Sector Rotation", props: {}, grid: { x: 6, y: 0, w: 6, h: 5 } },
      { id: "p3", type: "economics", title: "Economic Calendar", props: {}, grid: { x: 0, y: 5, w: 6, h: 5 } },
      { id: "p4", type: "news", title: "Macro News", props: {}, grid: { x: 6, y: 5, w: 6, h: 5 } },
    ],
  },
];
```

### Frontend: `frontend/src/components/layout/TemplateGallery.tsx`

Modal or sidebar panel showing available templates:

- **Category tabs**: All | Trading | Research | Portfolio | Macro | My Templates
- **Template cards** (grid of cards):
  - Card: icon, name, description, panel count badge
  - "Apply" button: loads template into launchpad
  - "Preview" hover: show miniature grid layout preview
- **"Save Current Layout"** button at bottom:
  - Opens dialog: name input, description, category dropdown
  - Saves current launchpad layout as a custom template

### Frontend: Template Store

Create `frontend/src/store/workspaceTemplateStore.ts` (Zustand, persisted to localStorage):

```typescript
interface WorkspaceTemplateState {
  customTemplates: WorkspaceTemplate[];
  activeTemplateId: string | null;
  saveCustomTemplate: (template: Omit<WorkspaceTemplate, "id">) => void;
  deleteCustomTemplate: (id: string) => void;
  getAllTemplates: () => WorkspaceTemplate[];  // builtin + custom
}
```

### Launchpad Integration

In `frontend/src/pages/Launchpad.tsx`:
- Add "Templates" button in the toolbar (top of page)
- Click opens TemplateGallery modal
- On "Apply": clear current panels, load template panels into the grid
- On "Save Current": capture current grid state as a template

### Tests

**E2E** (`frontend/tests/workspace-templates.spec.ts`):
```typescript
// Navigate to /equity/launchpad
// Click "Templates" button
// Verify TemplateGallery modal opens
// Verify at least 6 builtin templates are shown
// Click "Day Trading" template → "Apply"
// Verify launchpad shows 4 panels
// Click "Save Current Layout", enter name "My Layout"
// Open templates again, verify "My Layout" appears under "My Templates"
// Delete custom template, verify it's removed
```
