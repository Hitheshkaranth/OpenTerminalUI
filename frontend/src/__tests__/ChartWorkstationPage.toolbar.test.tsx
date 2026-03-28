import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CHART_WORKSTATION_ACTION_EVENT } from "../components/layout/commanding";
import { ChartWorkstationPage } from "../pages/ChartWorkstationPage";
import { useChartWorkstationStore, type ChartSlot } from "../store/chartWorkstationStore";
import {
  buildWorkstationSnapshotPayload,
  encodeWorkstationSharePayload,
} from "../shared/chart/workstationPersistence";

const listChartTemplatesMock = vi.fn(async () => []);
const createChartTemplateMock = vi.fn(async () => ({ id: "tpl-1" }));
const replayCommandMock = vi.fn();
const chartPanelPropsBySlot = new Map<string, Record<string, unknown>>();

vi.mock("../contexts/CrosshairSyncContext", () => ({
  CrosshairSyncProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    listChartTemplates: (...args: unknown[]) => listChartTemplatesMock.apply(null, args),
    createChartTemplate: (...args: unknown[]) => createChartTemplateMock.apply(null, args),
  };
});

vi.mock("../hooks/useBatchChartData", () => ({
  useBatchChartData: () => ({ bySlotId: {}, loadingAny: false, source: "batch" as const }),
}));

vi.mock("../hooks/useWorkstationQuotes", () => ({
  useWorkstationQuotes: () => ({ connectionState: "connected" as const, quoteBySlotId: {} }),
}));

vi.mock("../components/chart-workstation/ChartGridContainer", () => ({
  ChartGridContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../components/chart-workstation/AddChartPlaceholder", () => ({
  AddChartPlaceholder: ({ onClick }: { onClick: () => void }) => <button type="button" onClick={onClick}>Add Placeholder</button>,
}));

vi.mock("../components/chart-workstation/ChartPanel", () => ({
  ChartPanel: (props: {
    slot: ChartSlot;
    isActive: boolean;
    onActivate: () => void;
    isFullscreen?: boolean;
    panelCommand?: { id: string; revision: number };
    replayCommand?: { type: string; revision: number; date?: string };
  }) => {
    chartPanelPropsBySlot.set(props.slot.id, props as unknown as Record<string, unknown>);
    useEffect(() => {
      if (!props.replayCommand?.revision) return;
      replayCommandMock(props.slot.id, props.replayCommand.type, props.replayCommand.date);
    }, [props.replayCommand, props.slot.id]);
    return (
      <div data-slot-id={props.slot.id} data-testid={`mock-pane-${props.slot.id}`} tabIndex={-1}>
        <button type="button" onClick={props.onActivate}>
          {props.isActive ? `ACTIVE ${props.slot.ticker}` : props.slot.ticker}
        </button>
        {props.isFullscreen ? <span data-testid={`fullscreen-${props.slot.id}`}>FS</span> : null}
      </div>
    );
  },
}));

function makeSlot(id: string, ticker: string): ChartSlot {
  return {
    id,
    ticker,
    companyName: ticker,
    market: "US",
    timeframe: "1D",
    chartType: "candle",
    indicators: [],
    extendedHours: {
      enabled: false,
      showPreMarket: true,
      showAfterHours: true,
      visualMode: "merged",
      colorScheme: "dimmed",
    },
    preMarketLevels: {
      showPMHigh: true,
      showPMLow: true,
      showPMOpen: false,
      showPMVWAP: false,
      extendIntoRTH: true,
      daysToShow: 1,
    },
  };
}

function renderPage(initialEntries = ["/equity/chart-workstation"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ChartWorkstationPage />
    </MemoryRouter>,
  );
}

describe("ChartWorkstationPage shell workflow", () => {
  beforeEach(() => {
    listChartTemplatesMock.mockClear();
    createChartTemplateMock.mockClear();
    replayCommandMock.mockClear();
    chartPanelPropsBySlot.clear();
    localStorage.clear();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => undefined),
      },
    });
    useChartWorkstationStore.setState({
      slots: [makeSlot("slot-1", "AAPL"), makeSlot("slot-2", "MSFT")],
      activeSlotId: "slot-1",
      gridTemplate: { cols: 2, rows: 1, arrangement: "grid" },
      syncCrosshair: true,
      syncTimeframe: false,
    });
  });

  it("drives timeframe changes from the shell against the active pane", async () => {
    renderPage();

    await waitFor(() => expect(listChartTemplatesMock).toHaveBeenCalled());
    expect(screen.getByTestId("chart-shell-active-pane")).toHaveTextContent("Pane 1: AAPL");

    fireEvent.click(screen.getByRole("button", { name: "MSFT" }));
    expect(screen.getByTestId("chart-shell-active-pane")).toHaveTextContent("Pane 2: MSFT");

    fireEvent.click(screen.getByRole("button", { name: "15m" }));

    const state = useChartWorkstationStore.getState();
    expect(state.slots.find((slot) => slot.id === "slot-1")?.timeframe).toBe("1D");
    expect(state.slots.find((slot) => slot.id === "slot-2")?.timeframe).toBe("15m");
    expect(state.activeSlotId).toBe("slot-2");
  }, 30000);

  it("keeps toolbar Tab navigation separate from pane-cycling and toggles replay on the active pane", async () => {
    renderPage();

    await waitFor(() => expect(listChartTemplatesMock).toHaveBeenCalled());

    const firstPane = screen.getByTestId("mock-pane-slot-1");
    firstPane.focus();
    fireEvent.keyDown(firstPane, { key: "Tab" });
    await waitFor(() => expect(useChartWorkstationStore.getState().activeSlotId).toBe("slot-2"));

    const replayButton = screen.getByTestId("chart-shell-replay-toggle");
    replayButton.focus();
    fireEvent.keyDown(replayButton, { key: "Tab" });
    expect(useChartWorkstationStore.getState().activeSlotId).toBe("slot-2");

    fireEvent.click(replayButton);
    await waitFor(() => expect(replayCommandMock).toHaveBeenCalledWith("slot-2", "toggle", undefined));
  });

  it("runs pane-local shortcuts only when a chart pane is focused and ignores editable fields and menus", async () => {
    renderPage();

    await waitFor(() => expect(listChartTemplatesMock).toHaveBeenCalled());

    fireEvent.keyDown(window, { key: "i" });
    expect(chartPanelPropsBySlot.get("slot-1")?.panelCommand).toBeUndefined();

    const compareInput = screen.getByTestId("chart-shell-compare-input-desktop");
    compareInput.focus();
    fireEvent.keyDown(compareInput, { key: "d" });
    expect(chartPanelPropsBySlot.get("slot-1")?.panelCommand).toBeUndefined();

    fireEvent.click(within(screen.getByTestId("chart-shell-link-menu")).getByRole("button", { name: "Change active pane link group" }));
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "v" });
    expect(chartPanelPropsBySlot.get("slot-1")?.panelCommand).toBeUndefined();

    const firstPane = screen.getByTestId("mock-pane-slot-1");
    firstPane.focus();

    fireEvent.keyDown(firstPane, { key: "i" });
    await waitFor(() => expect((chartPanelPropsBySlot.get("slot-1")?.panelCommand as { id: string } | undefined)?.id).toBe("toggleIndicators"));

    fireEvent.keyDown(firstPane, { key: "d" });
    await waitFor(() => expect((chartPanelPropsBySlot.get("slot-1")?.panelCommand as { id: string } | undefined)?.id).toBe("toggleDrawingTools"));

    fireEvent.keyDown(firstPane, { key: "v" });
    await waitFor(() => expect((chartPanelPropsBySlot.get("slot-1")?.panelCommand as { id: string } | undefined)?.id).toBe("toggleVolumeProfile"));

    fireEvent.keyDown(firstPane, { key: "r" });
    await waitFor(() => expect(replayCommandMock).toHaveBeenCalledWith("slot-1", "toggle", undefined));
  });

  it("reports chart-action failures explicitly when no active pane is selected", async () => {
    renderPage();

    await waitFor(() => expect(listChartTemplatesMock).toHaveBeenCalled());

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(useChartWorkstationStore.getState().activeSlotId).toBeNull());

    window.dispatchEvent(
      new CustomEvent(CHART_WORKSTATION_ACTION_EVENT, {
        detail: { id: "chart.toggleIndicators" },
      }),
    );

    await waitFor(() =>
      expect(
        screen.getByText("Indicator toggle requires an active chart pane. Click a pane or use 1-9 first."),
      ).toBeInTheDocument(),
    );
    expect(chartPanelPropsBySlot.get("slot-1")?.panelCommand).toBeUndefined();
  });

  it("fans out replay navigation to linked panes only when replay sync is enabled", async () => {
    localStorage.setItem(
      "ot:chart-workstation:tabs:v1",
      JSON.stringify({
        activeTabId: "ws-1",
        tabs: [
          {
            id: "ws-1",
            name: "Main",
            snapshot: {
              slots: [makeSlot("slot-1", "AAPL"), makeSlot("slot-2", "MSFT")],
              gridTemplate: { cols: 2, rows: 1, arrangement: "grid" },
              syncCrosshair: true,
            },
            linkGroups: { "slot-1": "A", "slot-2": "A" },
            linkSettings: { symbol: true, interval: true, crosshair: true, replay: true, dateRange: false },
            compareSymbols: [],
            compareConfig: { mode: "normalized", placement: "active" },
            rangePresets: { "slot-1": "6M", "slot-2": "6M" },
          },
        ],
      }),
    );

    renderPage();

    await waitFor(() => expect(listChartTemplatesMock).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("chart-shell-replay-step-forward"));
    await waitFor(() => {
      expect(replayCommandMock).toHaveBeenCalledWith("slot-1", "stepForward", undefined);
      expect(replayCommandMock).toHaveBeenCalledWith("slot-2", "stepForward", undefined);
    });

    fireEvent.change(screen.getByTestId("chart-shell-replay-date"), {
      target: { value: "2026-03-03" },
    });
    fireEvent.click(screen.getByTestId("chart-shell-replay-go-date"));

    await waitFor(() => {
      expect(replayCommandMock).toHaveBeenCalledWith("slot-1", "goToDate", "2026-03-03");
      expect(replayCommandMock).toHaveBeenCalledWith("slot-2", "goToDate", "2026-03-03");
    });
  });

  it("maximizes the active pane and restores saved workspace defaults", async () => {
    renderPage();

    await waitFor(() => expect(listChartTemplatesMock).toHaveBeenCalled());
    expect(chartPanelPropsBySlot.get("slot-1")?.isFullscreen).toBeFalsy();

    fireEvent.click(screen.getByRole("button", { name: "Maximize Active" }));
    await waitFor(() => expect(chartPanelPropsBySlot.get("slot-1")?.isFullscreen).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Save Default" }));
    fireEvent.click(screen.getByRole("button", { name: "15m" }));
    expect(useChartWorkstationStore.getState().slots.find((slot) => slot.id === "slot-1")?.timeframe).toBe("15m");

    fireEvent.click(screen.getAllByRole("button", { name: "Load Default" })[0]);
    await waitFor(() => expect(useChartWorkstationStore.getState().slots.find((slot) => slot.id === "slot-1")?.timeframe).toBe("1D"));
  });

  it("duplicates workspaces with fresh pane scopes and restores snapshots without reusing old slot ids", async () => {
    renderPage();

    await waitFor(() => expect(listChartTemplatesMock).toHaveBeenCalled());
    const originalIds = useChartWorkstationStore.getState().slots.map((slot) => slot.id);

    fireEvent.click(screen.getByRole("button", { name: "+ Tab" }));
    await waitFor(() => {
      const duplicatedIds = useChartWorkstationStore.getState().slots.map((slot) => slot.id);
      expect(duplicatedIds.every((id) => !originalIds.includes(id))).toBe(true);
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Save Snapshot" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "15m" }));
    expect(useChartWorkstationStore.getState().slots[0]?.timeframe).toBe("15m");

    const idsAfterEdit = useChartWorkstationStore.getState().slots.map((slot) => slot.id);
    await waitFor(() => expect((screen.getByTestId("chart-shell-snapshot-select") as HTMLSelectElement).value).not.toBe(""));
    fireEvent.click(screen.getByRole("button", { name: "Load Snapshot" }));

    await waitFor(() => {
      expect(useChartWorkstationStore.getState().slots[0]?.timeframe).toBe("1D");
      const restoredIds = useChartWorkstationStore.getState().slots.map((slot) => slot.id);
      expect(restoredIds.every((id) => !idsAfterEdit.includes(id))).toBe(true);
    });
  });

  it("imports a shared workspace payload from the url query", async () => {
    const shared = encodeWorkstationSharePayload(
      buildWorkstationSnapshotPayload("Shared Desk", {
        slots: [{ id: "share-1", ticker: "TSLA", market: "US", timeframe: "15m", chartType: "line", indicators: [] }],
        gridTemplate: { cols: 1, rows: 1, arrangement: "grid" },
        linkSettings: { symbol: true, interval: true, crosshair: true, replay: false, dateRange: false },
        compareSymbols: ["QQQ"],
      }),
    );

    renderPage([`/equity/chart-workstation?share=${shared}`]);

    await waitFor(() => expect(listChartTemplatesMock).toHaveBeenCalled());
    await waitFor(() => {
      const slot = useChartWorkstationStore.getState().slots[0];
      expect(slot?.ticker).toBe("TSLA");
      expect(slot?.timeframe).toBe("15m");
      expect(slot?.chartType).toBe("line");
      expect(slot?.id).not.toBe("share-1");
    });
  });

  it("defaults imported shared workspaces without market metadata to IN", async () => {
    const shared = encodeWorkstationSharePayload(
      buildWorkstationSnapshotPayload("Shared Desk", {
        slots: [{ id: "share-1", ticker: "INFY", timeframe: "1D", chartType: "candle", indicators: [] }],
        gridTemplate: { cols: 1, rows: 1, arrangement: "grid" },
      }),
    );

    renderPage([`/equity/chart-workstation?share=${shared}`]);

    await waitFor(() => expect(listChartTemplatesMock).toHaveBeenCalled());
    await waitFor(() => {
      const slot = useChartWorkstationStore.getState().slots[0];
      expect(slot?.ticker).toBe("INFY");
      expect(slot?.market).toBe("IN");
    });
  });
});
