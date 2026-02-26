# Multi-Chart Workstation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a dynamic 1–6 simultaneous chart workstation at `/equity/chart-workstation` with ticker assignment, layout presets, crosshair sync, and real-time WebSocket quote streaming.

**Architecture:** Zustand store (`chartWorkstationStore`) manages an array of `ChartSlot` objects. A CSS-grid container (`ChartGridContainer`) renders 1–6 `ChartPanel` components, each wrapping the existing `TradingChart`. A backend `/api/charts/batch` endpoint fetches OHLCV for all active tickers in one request. Crosshair sync is handled via React Context with `requestAnimationFrame` throttling.

**Tech Stack:** React 18, TypeScript, Zustand (persist), lightweight-charts v5, Tailwind CSS, FastAPI (Python), pytest, Playwright

---

## Task 1: Backend — batch chart data endpoint

**Files:**
- Create: `backend/routers/chart_workstation.py`
- Modify: `backend/main.py` (register router)

**Step 1: Write failing backend test**

Create `backend/tests/test_chart_workstation.py`:
```python
import pytest
from httpx import AsyncClient
from backend.main import app

@pytest.mark.asyncio
async def test_batch_charts_returns_map():
    """POST /api/charts/batch returns ticker→data map."""
    async with AsyncClient(app=app, base_url="http://test") as client:
        resp = await client.post("/api/charts/batch", json={
            "tickers": [
                {"symbol": "RELIANCE", "timeframe": "1d", "market": "NSE"},
                {"symbol": "INFY",     "timeframe": "1d", "market": "NSE"},
            ]
        })
    assert resp.status_code == 200
    body = resp.json()
    assert "RELIANCE" in body
    assert "INFY" in body

@pytest.mark.asyncio
async def test_batch_charts_empty_returns_empty():
    async with AsyncClient(app=app, base_url="http://test") as client:
        resp = await client.post("/api/charts/batch", json={"tickers": []})
    assert resp.status_code == 200
    assert resp.json() == {}

@pytest.mark.asyncio
async def test_batch_charts_max_six():
    """More than 6 tickers returns 422."""
    async with AsyncClient(app=app, base_url="http://test") as client:
        resp = await client.post("/api/charts/batch", json={
            "tickers": [{"symbol": f"T{i}", "timeframe": "1d", "market": "NSE"} for i in range(7)]
        })
    assert resp.status_code == 422
```

**Step 2: Run to verify it fails**
```bash
cd /path/to/OpenTerminalUI
pytest backend/tests/test_chart_workstation.py -v
```
Expected: ImportError or 404.

**Step 3: Create the router**

Create `backend/routers/chart_workstation.py`:
```python
import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

router = APIRouter(prefix="/api/charts", tags=["chart-workstation"])


class BatchTickerItem(BaseModel):
    symbol: str
    timeframe: str = "1d"
    market: str = "NSE"


class BatchChartRequest(BaseModel):
    tickers: list[BatchTickerItem]

    @field_validator("tickers")
    @classmethod
    def max_six(cls, v: list) -> list:
        if len(v) > 6:
            raise ValueError("Maximum 6 tickers allowed per batch request")
        return v


@router.post("/batch")
async def batch_chart_data(request: BatchChartRequest) -> dict[str, Any]:
    """
    Fetch OHLCV data for up to 6 tickers in parallel.
    Returns a map of symbol → chart data (or error string on failure).
    """
    from backend.providers.chart_data import get_chart_data  # lazy import to avoid circular

    results: dict[str, Any] = {}

    async def fetch_one(item: BatchTickerItem) -> tuple[str, Any]:
        try:
            data = await asyncio.to_thread(
                get_chart_data,
                item.symbol,
                item.market,
                item.timeframe,
                "1y",
            )
            return item.symbol, data
        except Exception as exc:  # noqa: BLE001
            return item.symbol, {"error": str(exc)}

    tasks = [fetch_one(item) for item in request.tickers]
    pairs = await asyncio.gather(*tasks)
    for symbol, data in pairs:
        results[symbol] = data

    return results
```

**Step 4: Register in `backend/main.py`**

Find the section where other routers are registered and add:
```python
from backend.routers.chart_workstation import router as chart_workstation_router
# ...
app.include_router(chart_workstation_router)
```

**Step 5: Verify tests pass**
```bash
pytest backend/tests/test_chart_workstation.py -v
```
Expected: 3 passed (or 2 passed + 1 skipped if live provider unavailable — that's fine, integration test).

---

## Task 2: Frontend — Zustand store

**Files:**
- Create: `frontend/src/store/chartWorkstationStore.ts`
- Create: `frontend/src/__tests__/chartWorkstationStore.test.ts`

**Step 1: Write failing Vitest test**

Create `frontend/src/__tests__/chartWorkstationStore.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { useChartWorkstationStore } from "../store/chartWorkstationStore";

describe("chartWorkstationStore", () => {
  beforeEach(() => {
    // Reset store to initial state between tests
    useChartWorkstationStore.setState(useChartWorkstationStore.getInitialState());
  });

  it("starts with one empty slot", () => {
    const { slots } = useChartWorkstationStore.getState();
    expect(slots).toHaveLength(1);
    expect(slots[0].ticker).toBeNull();
  });

  it("addSlot appends a new empty slot (max 6)", () => {
    const { addSlot } = useChartWorkstationStore.getState();
    addSlot();
    expect(useChartWorkstationStore.getState().slots).toHaveLength(2);
    // Adding 5 more (total 7) should cap at 6
    for (let i = 0; i < 5; i++) addSlot();
    expect(useChartWorkstationStore.getState().slots).toHaveLength(6);
  });

  it("removeSlot removes a slot by id", () => {
    const { addSlot, removeSlot } = useChartWorkstationStore.getState();
    addSlot();
    const { slots } = useChartWorkstationStore.getState();
    const idToRemove = slots[1].id;
    removeSlot(idToRemove);
    expect(useChartWorkstationStore.getState().slots).toHaveLength(1);
  });

  it("updateSlotTicker changes ticker and market", () => {
    const { slots, updateSlotTicker } = useChartWorkstationStore.getState();
    updateSlotTicker(slots[0].id, "RELIANCE", "IN");
    const updated = useChartWorkstationStore.getState().slots[0];
    expect(updated.ticker).toBe("RELIANCE");
    expect(updated.market).toBe("IN");
  });

  it("setGridTemplate updates template", () => {
    const { setGridTemplate } = useChartWorkstationStore.getState();
    setGridTemplate({ cols: 3, rows: 2, arrangement: "grid" });
    expect(useChartWorkstationStore.getState().gridTemplate.cols).toBe(3);
  });
});
```

**Step 2: Run to verify it fails**
```bash
cd frontend && npm test -- --run src/__tests__/chartWorkstationStore.test.ts
```
Expected: FAIL — module not found.

**Step 3: Create the store**

Create `frontend/src/store/chartWorkstationStore.ts`:
```typescript
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { v4 as uuid } from "uuid";

export type ChartSlotTimeframe = "1m" | "5m" | "15m" | "1h" | "1D" | "1W" | "1M";
export type ChartSlotType = "candle" | "line" | "area";
export type SlotMarket = "IN" | "US";

export interface ChartSlot {
  id: string;
  ticker: string | null;
  market: SlotMarket;
  timeframe: ChartSlotTimeframe;
  chartType: ChartSlotType;
  indicators: string[];
}

export interface GridTemplate {
  cols: number; // 1–3
  rows: number; // 1–2
  arrangement: "grid" | "custom";
  customAreas?: string;
}

interface ChartWorkstationState {
  slots: ChartSlot[];
  activeSlotId: string | null;
  gridTemplate: GridTemplate;
  syncCrosshair: boolean;
  syncTimeframe: boolean;
  // actions
  addSlot: () => void;
  removeSlot: (id: string) => void;
  updateSlotTicker: (id: string, ticker: string, market: SlotMarket) => void;
  updateSlotTimeframe: (id: string, tf: ChartSlotTimeframe) => void;
  updateSlotType: (id: string, type: ChartSlotType) => void;
  setActiveSlot: (id: string | null) => void;
  setGridTemplate: (t: GridTemplate) => void;
  setSyncCrosshair: (v: boolean) => void;
  setSyncTimeframe: (v: boolean) => void;
  // for testing reset
  getInitialState: () => ChartWorkstationState;
}

function makeSlot(): ChartSlot {
  return {
    id: uuid(),
    ticker: null,
    market: "IN",
    timeframe: "1D",
    chartType: "candle",
    indicators: [],
  };
}

const INITIAL_SLOTS: ChartSlot[] = [makeSlot()];

export const useChartWorkstationStore = create<ChartWorkstationState>()(
  persist(
    (set, get) => ({
      slots: INITIAL_SLOTS,
      activeSlotId: INITIAL_SLOTS[0].id,
      gridTemplate: { cols: 1, rows: 1, arrangement: "grid" },
      syncCrosshair: true,
      syncTimeframe: false,

      addSlot: () =>
        set((s) => {
          if (s.slots.length >= 6) return s;
          const next = makeSlot();
          return { slots: [...s.slots, next] };
        }),

      removeSlot: (id) =>
        set((s) => {
          if (s.slots.length <= 1) return s; // keep at least one
          const slots = s.slots.filter((sl) => sl.id !== id);
          const activeSlotId =
            s.activeSlotId === id ? (slots[0]?.id ?? null) : s.activeSlotId;
          return { slots, activeSlotId };
        }),

      updateSlotTicker: (id, ticker, market) =>
        set((s) => ({
          slots: s.slots.map((sl) =>
            sl.id === id ? { ...sl, ticker, market } : sl,
          ),
        })),

      updateSlotTimeframe: (id, tf) =>
        set((s) => ({
          slots: s.slots.map((sl) =>
            sl.id === id ? { ...sl, timeframe: tf } : sl,
          ),
        })),

      updateSlotType: (id, type) =>
        set((s) => ({
          slots: s.slots.map((sl) =>
            sl.id === id ? { ...sl, chartType: type } : sl,
          ),
        })),

      setActiveSlot: (id) => set({ activeSlotId: id }),

      setGridTemplate: (t) => set({ gridTemplate: t }),

      setSyncCrosshair: (v) => set({ syncCrosshair: v }),

      setSyncTimeframe: (v) => set({ syncTimeframe: v }),

      getInitialState: () => ({
        ...get(),
        slots: [makeSlot()],
        activeSlotId: null,
      }),
    }),
    {
      name: "ot_chart_workstation",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        slots: s.slots,
        gridTemplate: s.gridTemplate,
        syncCrosshair: s.syncCrosshair,
        syncTimeframe: s.syncTimeframe,
      }),
    },
  ),
);
```

Note: You'll need `uuid` — check if it's already in package.json. If not, install with:
```bash
cd frontend && npm install uuid && npm install --save-dev @types/uuid
```

**Step 4: Run tests to verify pass**
```bash
cd frontend && npm test -- --run src/__tests__/chartWorkstationStore.test.ts
```
Expected: 5 passed.

---

## Task 3: Crosshair sync context

**Files:**
- Create: `frontend/src/contexts/CrosshairSyncContext.tsx`

No test required (it's a thin context wrapper). Create:

```typescript
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface CrosshairPos {
  time: number | null;
  sourceSlotId: string | null;
}

interface CrosshairSyncCtx {
  pos: CrosshairPos;
  broadcast: (slotId: string, time: number) => void;
  syncEnabled: boolean;
  toggleSync: () => void;
}

const CrosshairSyncContext = createContext<CrosshairSyncCtx | null>(null);

export function CrosshairSyncProvider({ children }: { children: ReactNode }) {
  const [pos, setPos] = useState<CrosshairPos>({ time: null, sourceSlotId: null });
  const [syncEnabled, setSyncEnabled] = useState(true);
  const rafRef = useRef<number | null>(null);

  const broadcast = useCallback((slotId: string, time: number) => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setPos({ time, sourceSlotId: slotId });
    });
  }, []);

  const toggleSync = useCallback(() => setSyncEnabled((v) => !v), []);

  return (
    <CrosshairSyncContext.Provider value={{ pos, broadcast, syncEnabled, toggleSync }}>
      {children}
    </CrosshairSyncContext.Provider>
  );
}

export function useCrosshairSync() {
  const ctx = useContext(CrosshairSyncContext);
  if (!ctx) throw new Error("useCrosshairSync must be inside CrosshairSyncProvider");
  return ctx;
}
```

---

## Task 4: CSS and chart workstation styles

**Files:**
- Create: `frontend/src/components/chart-workstation/ChartWorkstation.css`

```css
/* Chart Workstation — terminal-theme compatible */

.chart-workstation {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--ot-color-canvas);
  color: var(--ot-color-text-primary);
  min-height: 0;
}

.chart-grid {
  flex: 1;
  display: grid;
  gap: 2px;
  padding: 2px;
  background: var(--ot-color-border-default);
  transition: grid-template-columns 300ms ease,
              grid-template-rows 300ms ease;
  min-height: 0;
}

.chart-panel {
  background: var(--ot-color-surface-1);
  border: 1px solid transparent;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: border-color 200ms ease;
  min-height: 120px;
}

.chart-panel.active {
  border-color: var(--ot-color-accent-primary);
}

.chart-panel.drag-over {
  border-color: var(--ot-color-accent-primary);
  background: rgba(255, 149, 0, 0.05);
}

.chart-panel.fullscreen {
  position: fixed;
  inset: 0;
  z-index: 1000;
}

.chart-panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  background: var(--ot-color-surface-2);
  border-bottom: 1px solid var(--ot-color-border-default);
  font-size: 11px;
  min-height: 26px;
  flex-shrink: 0;
}

.chart-panel-body {
  flex: 1;
  min-height: 0;
  position: relative;
}

.chart-panel-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 2px 8px;
  border-top: 1px solid var(--ot-color-border-subtle);
  font-size: 10px;
  font-family: var(--ot-font-data);
  color: var(--ot-color-text-secondary);
  flex-shrink: 0;
}

.add-chart-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 2px dashed var(--ot-color-border-default);
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 200ms, border-color 200ms;
  color: var(--ot-color-text-muted);
  font-size: 11px;
  min-height: 120px;
}

.add-chart-placeholder:hover {
  opacity: 1;
  border-color: var(--ot-color-accent-primary);
  color: var(--ot-color-accent-primary);
}

.ticker-dropdown {
  position: relative;
}

.ticker-dropdown-results {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 200;
  min-width: 200px;
  background: var(--ot-color-surface-2);
  border: 1px solid var(--ot-color-border-strong);
  border-top: none;
  max-height: 200px;
  overflow-y: auto;
}

.ticker-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  font-size: 11px;
  cursor: pointer;
}

.ticker-dropdown-item:hover,
.ticker-dropdown-item.selected {
  background: var(--ot-color-accent-primary);
  color: var(--ot-color-canvas);
}

.layout-selector {
  display: flex;
  gap: 4px;
  align-items: center;
}

.layout-btn {
  display: grid;
  gap: 1px;
  padding: 3px;
  border: 1px solid var(--ot-color-border-default);
  border-radius: 2px;
  cursor: pointer;
  background: transparent;
  transition: border-color 150ms;
}

.layout-btn:hover,
.layout-btn.active {
  border-color: var(--ot-color-accent-primary);
}

.layout-btn-cell {
  width: 6px;
  height: 6px;
  background: var(--ot-color-border-strong);
  border-radius: 1px;
}

.layout-btn.active .layout-btn-cell {
  background: var(--ot-color-accent-primary);
}
```

---

## Task 5: TickerDropdown component

**Files:**
- Create: `frontend/src/components/chart-workstation/TickerDropdown.tsx`

```typescript
import { useEffect, useRef, useState } from "react";
import { searchSymbols, type SearchSymbolItem } from "../../api/client";
import "./ChartWorkstation.css";

interface Props {
  value: string | null;
  market: "IN" | "US";
  onChange: (ticker: string, market: "IN" | "US") => void;
  className?: string;
}

export function TickerDropdown({ value, market, onChange, className = "" }: Props) {
  const [query, setQuery] = useState(value ?? "");
  const [results, setResults] = useState<SearchSymbolItem[]>([]);
  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync external value changes
  useEffect(() => { setQuery(value ?? ""); }, [value]);

  const search = (q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!q.trim()) { setResults([]); return; }
      try {
        const apiMarket = market === "IN" ? "NSE" : "NASDAQ";
        const r = await searchSymbols(q, apiMarket);
        setResults(r.slice(0, 8));
        setSelectedIdx(0);
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, 250);
  };

  const pick = (item: SearchSymbolItem) => {
    const resolvedMarket: "IN" | "US" = item.country_code === "US" ? "US" : "IN";
    onChange(item.ticker, resolvedMarket);
    setQuery(item.ticker);
    setOpen(false);
    setResults([]);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && results[selectedIdx]) { pick(results[selectedIdx]); }
    if (e.key === "Escape") { setOpen(false); }
  };

  // Close on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <div ref={containerRef} className={`ticker-dropdown ${className}`}>
      <input
        className="w-24 rounded border border-terminal-border bg-terminal-bg px-1 py-0.5 text-[11px] text-terminal-text focus:border-terminal-accent focus:outline-none"
        value={query}
        placeholder="Search…"
        onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
        onFocus={() => query && setOpen(true)}
        onKeyDown={handleKey}
        spellCheck={false}
      />
      {open && results.length > 0 && (
        <div className="ticker-dropdown-results">
          {results.map((item, i) => (
            <div
              key={item.ticker}
              className={`ticker-dropdown-item ${i === selectedIdx ? "selected" : ""}`}
              onMouseDown={() => pick(item)}
            >
              <span>{item.ticker}</span>
              <span className="text-[10px] opacity-60">{item.name?.slice(0, 20)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## Task 6: LayoutSelector component

**Files:**
- Create: `frontend/src/components/chart-workstation/LayoutSelector.tsx`

```typescript
import type { GridTemplate } from "../../store/chartWorkstationStore";
import "./ChartWorkstation.css";

const LAYOUTS: Array<{ cols: number; rows: number; label: string }> = [
  { cols: 1, rows: 1, label: "1×1" },
  { cols: 2, rows: 1, label: "2×1" },
  { cols: 2, rows: 2, label: "2×2" },
  { cols: 3, rows: 1, label: "3×1" },
  { cols: 3, rows: 2, label: "3×2" },
];

interface Props {
  current: GridTemplate;
  onChange: (t: GridTemplate) => void;
}

export function LayoutSelector({ current, onChange }: Props) {
  return (
    <div className="layout-selector">
      {LAYOUTS.map((l) => {
        const isActive = current.cols === l.cols && current.rows === l.rows;
        return (
          <button
            key={l.label}
            title={l.label}
            className={`layout-btn ${isActive ? "active" : ""}`}
            style={{ gridTemplateColumns: `repeat(${l.cols}, 6px)`, gridTemplateRows: `repeat(${l.rows}, 6px)` }}
            onClick={() => onChange({ cols: l.cols, rows: l.rows, arrangement: "grid" })}
          >
            {Array.from({ length: l.cols * l.rows }).map((_, i) => (
              <div key={i} className="layout-btn-cell" />
            ))}
          </button>
        );
      })}
    </div>
  );
}
```

---

## Task 7: AddChartPlaceholder and ChartPanelFooter

**Files:**
- Create: `frontend/src/components/chart-workstation/AddChartPlaceholder.tsx`
- Create: `frontend/src/components/chart-workstation/ChartPanelFooter.tsx`

**AddChartPlaceholder.tsx:**
```typescript
import "./ChartWorkstation.css";

interface Props {
  onClick: () => void;
}

export function AddChartPlaceholder({ onClick }: Props) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="add-chart-placeholder"
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      data-testid="add-chart-placeholder"
    >
      <span className="text-2xl font-thin">+</span>
      <span>Add Chart</span>
    </div>
  );
}
```

**ChartPanelFooter.tsx:**
```typescript
import type { ChartPoint } from "../../types";
import "./ChartWorkstation.css";

interface Props {
  ticker: string | null;
  lastBar?: ChartPoint | null;
}

export function ChartPanelFooter({ ticker, lastBar }: Props) {
  if (!ticker || !lastBar) return null;
  const pct = lastBar.o > 0 ? (((lastBar.c - lastBar.o) / lastBar.o) * 100).toFixed(2) : null;
  const isUp = lastBar.c >= lastBar.o;
  return (
    <div className="chart-panel-footer" data-testid="chart-panel-footer">
      <span className="text-terminal-muted">O</span>
      <span>{lastBar.o.toFixed(2)}</span>
      <span className="text-terminal-muted">H</span>
      <span>{lastBar.h.toFixed(2)}</span>
      <span className="text-terminal-muted">L</span>
      <span>{lastBar.l.toFixed(2)}</span>
      <span className="text-terminal-muted">C</span>
      <span className={isUp ? "text-terminal-pos" : "text-terminal-neg"}>{lastBar.c.toFixed(2)}</span>
      {pct && (
        <span className={`ml-1 ${isUp ? "text-terminal-pos" : "text-terminal-neg"}`}>
          {isUp ? "+" : ""}{pct}%
        </span>
      )}
    </div>
  );
}
```

---

## Task 8: ChartPanelHeader

**Files:**
- Create: `frontend/src/components/chart-workstation/ChartPanelHeader.tsx`

```typescript
import { useState } from "react";
import { TickerDropdown } from "./TickerDropdown";
import type { ChartSlot, ChartSlotTimeframe, SlotMarket } from "../../store/chartWorkstationStore";
import "./ChartWorkstation.css";

const TIMEFRAMES: ChartSlotTimeframe[] = ["1m", "5m", "15m", "1h", "1D", "1W", "1M"];

interface Props {
  slot: ChartSlot;
  isFullscreen: boolean;
  onTickerChange: (ticker: string, market: SlotMarket) => void;
  onTimeframeChange: (tf: ChartSlotTimeframe) => void;
  onRemove: () => void;
  onToggleFullscreen: () => void;
}

export function ChartPanelHeader({
  slot,
  isFullscreen,
  onTickerChange,
  onTimeframeChange,
  onRemove,
  onToggleFullscreen,
}: Props) {
  const [showTf, setShowTf] = useState(false);

  return (
    <div className="chart-panel-header" data-testid={`chart-panel-header-${slot.id}`}>
      {/* Ticker search */}
      <TickerDropdown
        value={slot.ticker}
        market={slot.market}
        onChange={onTickerChange}
      />

      {/* Market badge */}
      <span className="rounded border border-terminal-border px-1 text-[9px] text-terminal-muted">
        {slot.market}
      </span>

      {/* Timeframe selector */}
      <div className="relative">
        <button
          className="rounded border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-muted hover:border-terminal-accent hover:text-terminal-text"
          onClick={() => setShowTf((v) => !v)}
          title="Change timeframe"
        >
          {slot.timeframe}
        </button>
        {showTf && (
          <div className="absolute left-0 top-full z-50 flex flex-col rounded border border-terminal-border bg-terminal-panel shadow-lg">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                className={`px-3 py-1 text-left text-[10px] hover:bg-terminal-accent/20 hover:text-terminal-accent ${
                  tf === slot.timeframe ? "text-terminal-accent" : "text-terminal-muted"
                }`}
                onClick={() => { onTimeframeChange(tf); setShowTf(false); }}
              >
                {tf}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        {/* Fullscreen toggle */}
        <button
          className="rounded border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-muted hover:border-terminal-accent"
          onClick={onToggleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen chart"}
        >
          {isFullscreen ? "⊡" : "⊞"}
        </button>

        {/* Close / remove chart */}
        <button
          className="rounded border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-neg hover:border-terminal-neg"
          onClick={onRemove}
          title="Remove chart"
          aria-label="Remove chart"
          data-testid={`remove-chart-${slot.id}`}
        >
          ×
        </button>
      </div>
    </div>
  );
}
```

---

## Task 9: ChartPanel

**Files:**
- Create: `frontend/src/components/chart-workstation/ChartPanel.tsx`

This wraps the existing `TradingChart` component. Key: `TradingChart` needs chart data in the format `ChartPoint[]`. We fetch per-slot via `fetchChart`.

```typescript
import { useEffect, useRef, useState } from "react";
import { fetchChart } from "../../api/client";
import type { ChartPoint, ChartResponse } from "../../types";
import type { ChartSlot, ChartSlotTimeframe, SlotMarket } from "../../store/chartWorkstationStore";
import { TradingChart } from "../chart/TradingChart";
import { ChartPanelHeader } from "./ChartPanelHeader";
import { ChartPanelFooter } from "./ChartPanelFooter";
import "./ChartWorkstation.css";

const TF_MAP: Record<ChartSlotTimeframe, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "60m",
  "1D": "1d",
  "1W": "1wk",
  "1M": "1mo",
};

interface Props {
  slot: ChartSlot;
  isActive: boolean;
  onActivate: () => void;
  onRemove: () => void;
  onTickerChange: (ticker: string, market: SlotMarket) => void;
  onTimeframeChange: (tf: ChartSlotTimeframe) => void;
}

export function ChartPanel({
  slot,
  isActive,
  onActivate,
  onRemove,
  onTickerChange,
  onTimeframeChange,
}: Props) {
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!slot.ticker) { setChartData([]); return; }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);

    const market = slot.market === "IN" ? "NSE" : "NASDAQ";
    const interval = TF_MAP[slot.timeframe];

    fetchChart(slot.ticker, interval, "1y", market)
      .then((res: ChartResponse) => {
        setChartData(res.data);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          setError(err.message || "Failed to load chart");
          setLoading(false);
        }
      });

    return () => abortRef.current?.abort();
  }, [slot.ticker, slot.timeframe, slot.market]);

  const lastBar = chartData.length > 0 ? chartData[chartData.length - 1] : null;

  return (
    <div
      className={`chart-panel ${isActive ? "active" : ""} ${fullscreen ? "fullscreen" : ""}`}
      onClick={onActivate}
      data-testid={`chart-panel-${slot.id}`}
    >
      <ChartPanelHeader
        slot={slot}
        isFullscreen={fullscreen}
        onTickerChange={onTickerChange}
        onTimeframeChange={onTimeframeChange}
        onRemove={onRemove}
        onToggleFullscreen={() => setFullscreen((v) => !v)}
      />

      <div className="chart-panel-body">
        {!slot.ticker && (
          <div className="flex h-full items-center justify-center text-xs text-terminal-muted">
            Search for a ticker above
          </div>
        )}
        {slot.ticker && loading && (
          <div className="flex h-full items-center justify-center text-xs text-terminal-muted">
            Loading {slot.ticker}…
          </div>
        )}
        {slot.ticker && error && (
          <div className="flex h-full items-center justify-center text-xs text-terminal-neg">
            {error}
          </div>
        )}
        {slot.ticker && !loading && !error && chartData.length > 0 && (
          <TradingChart
            data={chartData}
            mode="candles"
            indicators={[]}
            drawMode={null}
            drawings={[]}
            onDrawingAdd={() => {}}
            onDrawingRemove={() => {}}
          />
        )}
      </div>

      <ChartPanelFooter ticker={slot.ticker} lastBar={lastBar} />
    </div>
  );
}
```

**Note:** Check the actual props of `TradingChart` in `frontend/src/components/chart/TradingChart.tsx` before finalizing. The above uses what's visible from the file start — adjust prop names to match.

---

## Task 10: ChartGridContainer

**Files:**
- Create: `frontend/src/components/chart-workstation/ChartGridContainer.tsx`

```typescript
import type { CSSProperties } from "react";
import type { GridTemplate } from "../../store/chartWorkstationStore";
import "./ChartWorkstation.css";

interface Props {
  slotCount: number;
  template: GridTemplate;
  children: React.ReactNode;
}

function gridCSS(count: number, template: GridTemplate): CSSProperties {
  if (template.arrangement === "custom" && template.customAreas) {
    return {
      display: "grid",
      gridTemplateAreas: template.customAreas,
      gridTemplateColumns: `repeat(${template.cols}, 1fr)`,
      gridTemplateRows: `repeat(${template.rows}, 1fr)`,
    };
  }

  const cols = template.cols;
  const rows = template.rows;

  // If user set explicit template, use it
  if (template.cols > 0 && template.rows > 0) {
    return {
      display: "grid",
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gridTemplateRows: `repeat(${rows}, 1fr)`,
    };
  }

  // Auto-compute from slot count
  const auto: Record<number, { c: number; r: number }> = {
    1: { c: 1, r: 1 },
    2: { c: 2, r: 1 },
    3: { c: 2, r: 2 },
    4: { c: 2, r: 2 },
    5: { c: 3, r: 2 },
    6: { c: 3, r: 2 },
  };
  const { c, r } = auto[Math.min(count, 6)] ?? auto[6];
  return {
    display: "grid",
    gridTemplateColumns: `repeat(${c}, 1fr)`,
    gridTemplateRows: `repeat(${r}, 1fr)`,
  };
}

export function ChartGridContainer({ slotCount, template, children }: Props) {
  return (
    <div
      className="chart-grid"
      style={gridCSS(slotCount, template)}
      data-testid="chart-grid"
    >
      {children}
    </div>
  );
}
```

---

## Task 11: ChartWorkstationPage

**Files:**
- Create: `frontend/src/pages/ChartWorkstationPage.tsx`

```typescript
import { useCallback } from "react";
import { CrosshairSyncProvider } from "../contexts/CrosshairSyncContext";
import { useChartWorkstationStore } from "../store/chartWorkstationStore";
import { ChartGridContainer } from "../components/chart-workstation/ChartGridContainer";
import { ChartPanel } from "../components/chart-workstation/ChartPanel";
import { AddChartPlaceholder } from "../components/chart-workstation/AddChartPlaceholder";
import { LayoutSelector } from "../components/chart-workstation/LayoutSelector";
import type { ChartSlotTimeframe, SlotMarket } from "../store/chartWorkstationStore";
import "../components/chart-workstation/ChartWorkstation.css";

export function ChartWorkstationPage() {
  const {
    slots,
    activeSlotId,
    gridTemplate,
    addSlot,
    removeSlot,
    updateSlotTicker,
    updateSlotTimeframe,
    setActiveSlot,
    setGridTemplate,
  } = useChartWorkstationStore();

  const handleTickerChange = useCallback(
    (slotId: string) => (ticker: string, market: SlotMarket) => {
      updateSlotTicker(slotId, ticker, market);
    },
    [updateSlotTicker],
  );

  const handleTimeframeChange = useCallback(
    (slotId: string) => (tf: ChartSlotTimeframe) => {
      updateSlotTimeframe(slotId, tf);
    },
    [updateSlotTimeframe],
  );

  return (
    <CrosshairSyncProvider>
      <div className="chart-workstation" data-testid="chart-workstation">
        {/* Toolbar */}
        <div className="flex items-center gap-3 border-b border-terminal-border bg-terminal-panel px-3 py-1.5 text-xs">
          <span className="ot-type-label text-terminal-accent">Chart Workstation</span>
          <LayoutSelector current={gridTemplate} onChange={setGridTemplate} />
          {slots.length < 6 && (
            <button
              className="ml-auto rounded border border-terminal-border px-2 py-0.5 text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
              onClick={addSlot}
              data-testid="add-chart-btn"
            >
              + Add Chart
            </button>
          )}
          <span className="text-terminal-muted">{slots.length}/6</span>
        </div>

        {/* Grid */}
        <ChartGridContainer slotCount={slots.length} template={gridTemplate}>
          {slots.map((slot) => (
            <ChartPanel
              key={slot.id}
              slot={slot}
              isActive={slot.id === activeSlotId}
              onActivate={() => setActiveSlot(slot.id)}
              onRemove={() => removeSlot(slot.id)}
              onTickerChange={handleTickerChange(slot.id)}
              onTimeframeChange={handleTimeframeChange(slot.id)}
            />
          ))}
          {slots.length < 6 && (
            <AddChartPlaceholder onClick={addSlot} />
          )}
        </ChartGridContainer>
      </div>
    </CrosshairSyncProvider>
  );
}
```

---

## Task 12: Wire routes and sidebar

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`

**In App.tsx**, add the import and route inside the `/equity` block:

```typescript
// At top of file, add import:
import { ChartWorkstationPage } from "./pages/ChartWorkstationPage";

// Inside the /equity Route block, add:
<Route path="chart-workstation" element={<ChartWorkstationPage />} />
```

**In Sidebar.tsx**, add to the `nav` array:
```typescript
{ label: "Charts", path: "/equity/chart-workstation", key: "C" },
```
Insert after `"Screener"` or wherever logical.

**Step: Build verify**
```bash
cd frontend && npm run build
```
Expected: Builds clean, no TypeScript errors. Fix any type errors before moving on.

---

## Task 13: E2E tests for Chart Workstation

**Files:**
- Create: `frontend/tests/e2e/chart-workstation.spec.ts`

```typescript
import { expect, test } from "@playwright/test";

function makeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `x.${encoded}.y`;
}

const accessToken = makeJwt({
  sub: "e2e-user",
  email: "e2e@example.com",
  role: "trader",
  exp: Math.floor(Date.now() / 1000) + 3600,
});
const refreshToken = makeJwt({ exp: Math.floor(Date.now() / 1000) + 7200 });

function setupAuth(page: import("@playwright/test").Page) {
  return page.addInitScript(
    ([at, rt]) => {
      localStorage.setItem("ot-access-token", at);
      localStorage.setItem("ot-refresh-token", rt);
    },
    [accessToken, refreshToken],
  );
}

test.describe("chart workstation", () => {
  test.beforeEach(async ({ page }) => {
    // Mock chart API
    await page.route("**/api/v3/chart**", async (route) => {
      await route.fulfill({
        json: {
          ticker: "RELIANCE",
          interval: "1d",
          currency: "INR",
          data: Array.from({ length: 10 }, (_, i) => ({
            t: Math.floor(Date.now() / 1000) - (10 - i) * 86400,
            o: 2500 + i * 10,
            h: 2520 + i * 10,
            l: 2480 + i * 10,
            c: 2510 + i * 10,
            v: 1000000,
          })),
        },
      });
    });

    // Mock search API
    await page.route("**/api/search**", async (route) => {
      await route.fulfill({
        json: {
          results: [
            { ticker: "RELIANCE", name: "Reliance Industries", exchange: "NSE", country_code: "IN" },
            { ticker: "INFY", name: "Infosys Ltd", exchange: "NSE", country_code: "IN" },
          ],
        },
      });
    });

    // Mock batch chart API
    await page.route("**/api/charts/batch", async (route) => {
      await route.fulfill({ json: {} });
    });

    await setupAuth(page);
    await page.goto("/equity/chart-workstation");
  });

  test("page loads with chart workstation heading", async ({ page }) => {
    await expect(page.getByText("Chart Workstation")).toBeVisible();
    await expect(page.getByTestId("chart-workstation")).toBeVisible();
  });

  test("shows add chart button and placeholder", async ({ page }) => {
    await expect(page.getByTestId("add-chart-btn")).toBeVisible();
    await expect(page.getByTestId("add-chart-placeholder")).toBeVisible();
  });

  test("can add a second chart panel", async ({ page }) => {
    await page.getByTestId("add-chart-btn").click();
    const panels = page.getByTestId(/chart-panel-/);
    await expect(panels).toHaveCount(2);
  });

  test("layout selector buttons are visible", async ({ page }) => {
    // Layout selector renders grid buttons (1×1, 2×1, 2×2, 3×1, 3×2)
    const layoutBtns = page.locator(".layout-btn");
    await expect(layoutBtns).toHaveCount(5);
  });

  test("remove chart button reduces panel count", async ({ page }) => {
    // Add a second chart first
    await page.getByTestId("add-chart-btn").click();
    await expect(page.getByTestId(/chart-panel-/)).toHaveCount(2);

    // Remove the first panel
    const removeBtn = page.locator("[data-testid^='remove-chart-']").first();
    await removeBtn.scrollIntoViewIfNeeded();
    await removeBtn.click();
    await expect(page.getByTestId(/chart-panel-/)).toHaveCount(1);
  });

  test("sidebar shows Charts nav item", async ({ page }) => {
    // The equity layout sidebar should have a Charts link
    await expect(page.getByRole("link", { name: "Charts" })).toBeVisible();
  });
});
```

**Step: Run e2e test**
```bash
cd frontend && npm run test:e2e -- --grep "chart workstation"
```
Expected: 5 passed (both chromium and mobile-chromium).

---

## Task 14: Full test suite — final validation

Run everything together to confirm 0 regressions:

```bash
# Backend
cd /path/to/OpenTerminalUI
pytest backend/tests/ -x -q

# Frontend unit
cd frontend && npm test -- --run

# TypeScript + build
npm run build

# E2E (all)
npm run test:e2e
```

**Expected:**
- pytest: 0 failed
- Vitest: 0 failed (now includes chartWorkstationStore tests)
- Build: 0 errors (0 TypeScript errors)
- Playwright: 0 failed (all 20+ tests + new chart-workstation tests)

---

## Implementation Notes

### TradingChart props — verify before Task 9

Before Task 9, read the full `TradingChart.tsx` component signature:
```bash
grep -n "type.*Props\|interface.*Props\|function TradingChart" frontend/src/components/chart/TradingChart.tsx
```
The `ChartPanel` wrapper must match the actual prop names exactly.

### uuid package

Check if `uuid` is already in package.json:
```bash
grep "uuid" frontend/package.json
```
If missing: `cd frontend && npm install uuid @types/uuid`

### Tailwind class availability

The workstation uses CSS variables from `terminal-theme.css`. Pure CSS classes (`.chart-workstation`, `.chart-grid`, etc.) are used alongside Tailwind utility classes. No Tailwind config changes needed.

### Route nesting

`/equity/chart-workstation` is nested inside `EquityLayout`, which includes the sidebar. This means the sidebar with Charts nav item will always be visible — exactly what we want.

### TypeScript strict mode

If TypeScript complains about `uuid`, add `/// <reference types="uuid" />` at top of store file, or install `@types/uuid`.
