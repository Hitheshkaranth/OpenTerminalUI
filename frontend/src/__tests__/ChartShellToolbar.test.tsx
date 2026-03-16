import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChartShellToolbar } from "../components/chart-workstation/ChartShellToolbar";
import type { ChartSlot } from "../store/chartWorkstationStore";

function makeSlot(overrides: Partial<ChartSlot> = {}): ChartSlot {
  return {
    id: "slot-1",
    ticker: "AAPL",
    companyName: "Apple",
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
    ...overrides,
  };
}

function renderToolbar(dense = false) {
  const onLayoutChange = vi.fn();
  const onTimeframeChange = vi.fn();
  const onChartTypeChange = vi.fn();
  const onAddCompareSymbol = vi.fn();
  const onToggleReplay = vi.fn();
  const onReplayStepBack = vi.fn();
  const onReplayStepForward = vi.fn();
  const onReplayPrevSession = vi.fn();
  const onReplayNextSession = vi.fn();
  const onCommitReplayDate = vi.fn();
  const onOpenAlerts = vi.fn();
  const onSetLinkDimension = vi.fn();
  const onSetComparePlacement = vi.fn();
  const onSetRangePreset = vi.fn();
  const onToggleMaximize = vi.fn();
  const onSaveWorkspaceDefault = vi.fn();
  const onRestoreWorkspaceDefault = vi.fn();
  const onSaveWorkspaceSnapshot = vi.fn();
  const onApplySelectedSnapshot = vi.fn();
  const onOpenSnapshotInNewTab = vi.fn();
  const onCopyShareLink = vi.fn();
  const onExportWorkspaceJson = vi.fn();

  render(
    <ChartShellToolbar
      dense={dense}
      visiblePaneCount={2}
      totalPaneCount={2}
      hiddenPaneCount={0}
      activePaneIndex={2}
      activeSlot={makeSlot({ id: "slot-2", ticker: "MSFT", timeframe: "1h" })}
      activeLinkGroup="A"
      linkedSymbolCount={2}
      canAddVisibleSlot={true}
      compareInput="NVDA"
      compareMode="normalized"
      comparePlacement="linked"
      activeCompareSymbols={["QQQ"]}
      activeRangePreset="6M"
      replayDateDraft="2026-03-03"
      linkSettings={{ symbol: true, interval: true, crosshair: true, replay: false, dateRange: true }}
      isMaximized={false}
      hasSavedDefault={true}
      persistenceBoundaryNote="Autosave is tab scoped."
      workspaceTabs={[{ id: "ws-1", name: "Main" }]}
      activeWorkspaceTabId="ws-1"
      templates={[{ id: "tpl-1", name: "Momentum" }]}
      templatesLoading={false}
      selectedTemplateId="tpl-1"
      templateDraftName="Desk"
      snapshots={[{ id: "snap-1", label: "Main | 3/12/2026" }]}
      selectedSnapshotId="snap-1"
      quotesConnectionState="connected"
      chartBatchSource="batch"
      batchLoadingAny={false}
      gridTemplate={{ cols: 2, rows: 1, arrangement: "grid" }}
      onSwitchWorkspaceTab={vi.fn()}
      onAddWorkspaceTab={vi.fn()}
      onRemoveWorkspaceTab={vi.fn()}
      onLayoutChange={onLayoutChange}
      onAddPane={vi.fn()}
      onApplyMultiTimeframePreset={vi.fn()}
      onApplyCustomSplit={vi.fn()}
      onTickerChange={vi.fn()}
      onTimeframeChange={onTimeframeChange}
      onChartTypeChange={onChartTypeChange}
      onLinkGroupChange={vi.fn()}
      onSetLinkDimension={onSetLinkDimension}
      onSetCompareInput={vi.fn()}
      onSetCompareMode={vi.fn()}
      onSetComparePlacement={onSetComparePlacement}
      onAddCompareSymbol={onAddCompareSymbol}
      onRemoveCompareSymbol={vi.fn()}
      onOpenAlerts={onOpenAlerts}
      onToggleReplay={onToggleReplay}
      onReplayStepBack={onReplayStepBack}
      onReplayStepForward={onReplayStepForward}
      onReplayPrevSession={onReplayPrevSession}
      onReplayNextSession={onReplayNextSession}
      onSetReplayDateDraft={vi.fn()}
      onCommitReplayDate={onCommitReplayDate}
      onSetRangePreset={onSetRangePreset}
      onToggleMaximize={onToggleMaximize}
      onSaveWorkspaceDefault={onSaveWorkspaceDefault}
      onRestoreWorkspaceDefault={onRestoreWorkspaceDefault}
      onSaveWorkspaceSnapshot={onSaveWorkspaceSnapshot}
      onSetSelectedSnapshotId={vi.fn()}
      onApplySelectedSnapshot={onApplySelectedSnapshot}
      onOpenSnapshotInNewTab={onOpenSnapshotInNewTab}
      onCopyShareLink={onCopyShareLink}
      onExportWorkspaceJson={onExportWorkspaceJson}
      onSetSelectedTemplateId={vi.fn()}
      onApplySelectedTemplate={vi.fn()}
      onOpenTemplateInNewTab={vi.fn()}
      onSetTemplateDraftName={vi.fn()}
      onSaveCurrentTemplate={vi.fn()}
      onDrillInto={vi.fn()}
    />,
  );

  return {
    onLayoutChange,
    onTimeframeChange,
    onChartTypeChange,
    onAddCompareSymbol,
    onToggleReplay,
    onReplayStepBack,
    onReplayStepForward,
    onReplayPrevSession,
    onReplayNextSession,
    onCommitReplayDate,
    onOpenAlerts,
    onSetLinkDimension,
    onSetComparePlacement,
    onSetRangePreset,
    onToggleMaximize,
    onSaveWorkspaceDefault,
    onRestoreWorkspaceDefault,
    onSaveWorkspaceSnapshot,
    onApplySelectedSnapshot,
    onOpenSnapshotInNewTab,
    onCopyShareLink,
    onExportWorkspaceJson,
  };
}

describe("ChartShellToolbar", () => {
  it("renders the active pane summary and comfortable desktop controls", () => {
    const {
      onLayoutChange,
      onTimeframeChange,
      onChartTypeChange,
      onAddCompareSymbol,
      onToggleReplay,
      onReplayStepBack,
      onReplayStepForward,
      onReplayPrevSession,
      onReplayNextSession,
      onCommitReplayDate,
      onOpenAlerts,
      onSetLinkDimension,
      onSetComparePlacement,
      onSetRangePreset,
      onToggleMaximize,
      onSaveWorkspaceDefault,
      onRestoreWorkspaceDefault,
      onSaveWorkspaceSnapshot,
      onApplySelectedSnapshot,
      onOpenSnapshotInNewTab,
      onCopyShareLink,
      onExportWorkspaceJson,
    } = renderToolbar(false);

    expect(screen.getByTestId("chart-shell-toolbar")).toHaveAttribute("data-density", "comfortable");
    expect(screen.getByTestId("chart-shell-active-pane")).toHaveTextContent("Pane 2: MSFT");
    expect(screen.getByTestId("chart-shell-shortcuts")).toHaveTextContent("Focus a pane with `1-9` or click a chart");
    expect(screen.getByTestId("chart-shell-shortcuts")).toHaveTextContent("I");
    expect(screen.getByTestId("chart-shell-shortcuts")).toHaveTextContent("Indicators");
    expect(screen.getByTestId("chart-shell-timeframe-buttons")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-shell-dense-selects")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Layout /i })).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: "Layout 2x2" }));
    expect(onLayoutChange).toHaveBeenCalledWith({ cols: 2, rows: 2, arrangement: "grid" });

    fireEvent.click(within(screen.getByTestId("chart-shell-timeframe-buttons")).getByRole("button", { name: "15m" }));
    expect(onTimeframeChange).toHaveBeenCalledWith("15m");

    fireEvent.click(screen.getByRole("button", { name: "Line" }));
    expect(onChartTypeChange).toHaveBeenCalledWith("line");

    fireEvent.keyDown(screen.getByTestId("chart-shell-compare-input-desktop"), { key: "Enter" });
    expect(onAddCompareSymbol).toHaveBeenCalledTimes(1);

    fireEvent.click(within(screen.getAllByTestId("chart-shell-link-matrix")[1]).getByRole("button", { name: "SYM On" }));
    expect(onSetLinkDimension).toHaveBeenCalledWith("symbol", false);

    fireEvent.click(screen.getByRole("button", { name: "All Visible" }));
    expect(onSetComparePlacement).toHaveBeenCalledWith("all");

    fireEvent.change(screen.getByTestId("chart-shell-range-select"), { target: { value: "1Y" } });
    expect(onSetRangePreset).toHaveBeenCalledWith("1Y");

    fireEvent.click(screen.getByTestId("chart-shell-replay-toggle"));
    expect(onToggleReplay).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("chart-shell-replay-step-back"));
    expect(onReplayStepBack).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("chart-shell-replay-step-forward"));
    expect(onReplayStepForward).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("chart-shell-replay-prev-session"));
    expect(onReplayPrevSession).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("chart-shell-replay-next-session"));
    expect(onReplayNextSession).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("chart-shell-replay-go-date"));
    expect(onCommitReplayDate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Alert Center" }));
    expect(onOpenAlerts).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Maximize Active" }));
    expect(onToggleMaximize).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Save Default" }));
    expect(onSaveWorkspaceDefault).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole("button", { name: "Load Default" })[0]);
    expect(onRestoreWorkspaceDefault).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole("button", { name: "Save Snapshot" })[0]);
    expect(onSaveWorkspaceSnapshot).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Load Snapshot" }));
    expect(onApplySelectedSnapshot).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Snapshot Tab" }));
    expect(onOpenSnapshotInNewTab).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole("button", { name: "Copy Share Link" })[0]);
    expect(onCopyShareLink).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole("button", { name: "Export JSON" })[0]);
    expect(onExportWorkspaceJson).toHaveBeenCalledTimes(1);

    expect(screen.getByTestId("chart-shell-persistence-note")).toHaveTextContent("Autosave is tab scoped.");
  });

  it("switches dense desktop into compact menu-based controls", () => {
    renderToolbar(true);

    expect(screen.getByTestId("chart-shell-toolbar")).toHaveAttribute("data-density", "dense");
    expect(screen.getByTestId("chart-shell-dense-selects")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-shell-timeframe-buttons")).not.toBeInTheDocument();
  });
});
