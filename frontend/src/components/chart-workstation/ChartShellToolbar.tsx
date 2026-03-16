import type { KeyboardEvent } from "react";
import { LayoutSelector } from "./LayoutSelector";
import { TickerDropdown } from "./TickerDropdown";
import { TerminalBadge } from "../terminal/TerminalBadge";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalDropdown } from "../terminal/TerminalDropdown";
import { TerminalInput } from "../terminal/TerminalInput";
import type { ChartSlot, ChartSlotTimeframe, ChartSlotType, GridTemplate, SlotMarket } from "../../store/chartWorkstationStore";

const TIMEFRAMES: ChartSlotTimeframe[] = ["1m", "5m", "15m", "1h", "1D", "1W", "1M"];
const CHART_TYPES: ChartSlotType[] = ["candle", "line", "area"];
const RANGE_PRESETS = [
  { id: "1D", label: "1D" },
  { id: "5D", label: "5D" },
  { id: "1W", label: "1W" },
  { id: "1M", label: "1M" },
  { id: "3M", label: "3M" },
  { id: "6M", label: "6M" },
  { id: "1Y", label: "1Y" },
  { id: "MAX", label: "MAX" },
] as const;
const LINK_DIMENSIONS = [
  { id: "symbol", short: "SYM" },
  { id: "interval", short: "INT" },
  { id: "crosshair", short: "XHAIR" },
  { id: "replay", short: "RPLY" },
  { id: "dateRange", short: "RNG" },
] as const;
const SHORTCUT_HINTS = [
  { combo: "Tab", label: "Next pane" },
  { combo: "Shift+Tab", label: "Previous pane" },
  { combo: "1-9", label: "Focus pane" },
  { combo: "Alt+1..7", label: "Set timeframe" },
  { combo: "I", label: "Indicators" },
  { combo: "D", label: "Draw" },
  { combo: "V", label: "Volume profile" },
  { combo: "R", label: "Replay" },
  { combo: "A", label: "Alerts" },
  { combo: "Ctrl/Cmd+/", label: "Full shortcut help" },
] as const;

type WorkspaceLinkGroup = "off" | "A" | "B" | "C";
type WorkspaceLinkDimension = (typeof LINK_DIMENSIONS)[number]["id"];
type WorkspaceLinkSettings = Record<WorkspaceLinkDimension, boolean>;
type CompareMode = "normalized" | "price";
type ComparePlacement = "active" | "linked" | "all";
type RangePresetId = (typeof RANGE_PRESETS)[number]["id"];
type QuotesConnectionState = string;
type BatchSource = "idle" | "batch" | "fallback";
type DrillRoute = "security" | "news" | "screener" | "compare" | "portfolio";

type WorkspaceTabSummary = {
  id: string;
  name: string;
};

type WorkspaceTemplateSummary = {
  id: string;
  name: string;
};

type WorkspaceSnapshotSummary = {
  id: string;
  label: string;
};

type Props = {
  dense: boolean;
  visiblePaneCount: number;
  totalPaneCount: number;
  hiddenPaneCount: number;
  activePaneIndex: number;
  activeSlot: ChartSlot | null;
  activeLinkGroup: WorkspaceLinkGroup;
  linkedSymbolCount: number;
  canAddVisibleSlot: boolean;
  compareInput: string;
  compareMode: CompareMode;
  comparePlacement: ComparePlacement;
  activeCompareSymbols: string[];
  activeRangePreset: RangePresetId;
  replayDateDraft: string;
  linkSettings: WorkspaceLinkSettings;
  isMaximized: boolean;
  hasSavedDefault: boolean;
  persistenceBoundaryNote: string;
  workspaceTabs: WorkspaceTabSummary[];
  activeWorkspaceTabId: string | null;
  templates: WorkspaceTemplateSummary[];
  templatesLoading: boolean;
  selectedTemplateId: string;
  templateDraftName: string;
  snapshots: WorkspaceSnapshotSummary[];
  selectedSnapshotId: string;
  quotesConnectionState: QuotesConnectionState;
  chartBatchSource: BatchSource;
  batchLoadingAny: boolean;
  gridTemplate: GridTemplate;
  onSwitchWorkspaceTab: (tabId: string) => void;
  onAddWorkspaceTab: () => void;
  onRemoveWorkspaceTab: (tabId: string) => void;
  onLayoutChange: (template: GridTemplate) => void;
  onAddPane: () => void;
  onApplyMultiTimeframePreset: () => void;
  onApplyCustomSplit: () => void;
  onTickerChange: (ticker: string, market: SlotMarket, companyName?: string | null) => void;
  onTimeframeChange: (timeframe: ChartSlotTimeframe) => void;
  onChartTypeChange: (chartType: ChartSlotType) => void;
  onLinkGroupChange: (group: WorkspaceLinkGroup) => void;
  onSetLinkDimension: (dimension: WorkspaceLinkDimension, enabled: boolean) => void;
  onSetCompareInput: (value: string) => void;
  onSetCompareMode: (mode: CompareMode) => void;
  onSetComparePlacement: (placement: ComparePlacement) => void;
  onAddCompareSymbol: () => void;
  onRemoveCompareSymbol: (symbol: string) => void;
  onOpenAlerts: () => void;
  onToggleReplay: () => void;
  onReplayStepBack: () => void;
  onReplayStepForward: () => void;
  onReplayPrevSession: () => void;
  onReplayNextSession: () => void;
  onSetReplayDateDraft: (value: string) => void;
  onCommitReplayDate: () => void;
  onSetRangePreset: (presetId: RangePresetId) => void;
  onToggleMaximize: () => void;
  onSaveWorkspaceDefault: () => void;
  onRestoreWorkspaceDefault: () => void;
  onSaveWorkspaceSnapshot: () => void;
  onSetSelectedSnapshotId: (value: string) => void;
  onApplySelectedSnapshot: () => void;
  onOpenSnapshotInNewTab: () => void;
  onCopyShareLink: () => void;
  onExportWorkspaceJson: () => void;
  onSetSelectedTemplateId: (value: string) => void;
  onApplySelectedTemplate: () => void;
  onOpenTemplateInNewTab: () => void;
  onSetTemplateDraftName: (value: string) => void;
  onSaveCurrentTemplate: () => void | Promise<void>;
  onDrillInto: (route: DrillRoute) => void;
};

function connectionBadgeVariant(state: QuotesConnectionState): "success" | "info" | "danger" {
  if (state === "connected") return "success";
  if (state === "connecting") return "info";
  return "danger";
}

function sourceBadgeVariant(source: BatchSource): "success" | "warn" {
  return source === "batch" ? "success" : "warn";
}

function actionVariant(active: boolean): "accent" | "ghost" {
  return active ? "accent" : "ghost";
}

function chartTypeLabel(chartType: ChartSlotType) {
  return chartType === "candle" ? "Candles" : chartType === "line" ? "Line" : "Area";
}

function comparePlacementLabel(placement: ComparePlacement) {
  if (placement === "linked") return "Linked Panes";
  if (placement === "all") return "All Visible";
  return "Active Pane";
}

function handleEnter(event: KeyboardEvent<HTMLInputElement>, onCommit: () => void) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  onCommit();
}

function LinkMatrix({
  linkSettings,
  onSetLinkDimension,
}: {
  linkSettings: WorkspaceLinkSettings;
  onSetLinkDimension: Props["onSetLinkDimension"];
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-5" data-testid="chart-shell-link-matrix">
      {LINK_DIMENSIONS.map((dimension) => (
        <TerminalButton
          key={dimension.id}
          type="button"
          size="sm"
          variant={actionVariant(linkSettings[dimension.id])}
          className="justify-start px-2"
          onClick={() => onSetLinkDimension(dimension.id, !linkSettings[dimension.id])}
        >
          {dimension.short} {linkSettings[dimension.id] ? "On" : "Local"}
        </TerminalButton>
      ))}
    </div>
  );
}

function ReplayNavControls({
  replayScopeLabel,
  replayDateDraft,
  testIdPrefix,
  onToggleReplay,
  onReplayStepBack,
  onReplayStepForward,
  onReplayPrevSession,
  onReplayNextSession,
  onSetReplayDateDraft,
  onCommitReplayDate,
}: {
  replayScopeLabel: string;
  replayDateDraft: string;
  testIdPrefix?: string;
  onToggleReplay: Props["onToggleReplay"];
  onReplayStepBack: Props["onReplayStepBack"];
  onReplayStepForward: Props["onReplayStepForward"];
  onReplayPrevSession: Props["onReplayPrevSession"];
  onReplayNextSession: Props["onReplayNextSession"];
  onSetReplayDateDraft: Props["onSetReplayDateDraft"];
  onCommitReplayDate: Props["onCommitReplayDate"];
}) {
  return (
    <div className="grid gap-2" data-testid="chart-shell-replay-controls">
      <div className="flex flex-wrap gap-1">
        <TerminalButton
          type="button"
          size="sm"
          variant="ghost"
          className="px-2"
          onClick={onToggleReplay}
          data-testid={testIdPrefix ? `${testIdPrefix}-replay-toggle` : undefined}
        >
          {replayScopeLabel}
        </TerminalButton>
        <TerminalButton
          type="button"
          size="sm"
          variant="ghost"
          className="px-2"
          onClick={onReplayStepBack}
          data-testid={testIdPrefix ? `${testIdPrefix}-replay-step-back` : undefined}
        >
          Step -
        </TerminalButton>
        <TerminalButton
          type="button"
          size="sm"
          variant="ghost"
          className="px-2"
          onClick={onReplayStepForward}
          data-testid={testIdPrefix ? `${testIdPrefix}-replay-step-forward` : undefined}
        >
          Step +
        </TerminalButton>
        <TerminalButton
          type="button"
          size="sm"
          variant="ghost"
          className="px-2"
          onClick={onReplayPrevSession}
          data-testid={testIdPrefix ? `${testIdPrefix}-replay-prev-session` : undefined}
        >
          Prev Session
        </TerminalButton>
        <TerminalButton
          type="button"
          size="sm"
          variant="ghost"
          className="px-2"
          onClick={onReplayNextSession}
          data-testid={testIdPrefix ? `${testIdPrefix}-replay-next-session` : undefined}
        >
          Next Session
        </TerminalButton>
      </div>
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
        <TerminalInput
          type="date"
          size="sm"
          value={replayDateDraft}
          onChange={(event) => onSetReplayDateDraft(event.target.value)}
          onKeyDown={(event) => handleEnter(event, onCommitReplayDate)}
          aria-label="Replay go to date"
          data-testid={testIdPrefix ? `${testIdPrefix}-replay-date` : undefined}
        />
        <TerminalButton
          type="button"
          size="sm"
          variant="default"
          disabled={!replayDateDraft}
          onClick={onCommitReplayDate}
          data-testid={testIdPrefix ? `${testIdPrefix}-replay-go-date` : undefined}
        >
          Go To Date
        </TerminalButton>
      </div>
    </div>
  );
}

export function ChartShellToolbar({
  dense,
  visiblePaneCount,
  totalPaneCount,
  hiddenPaneCount,
  activePaneIndex,
  activeSlot,
  activeLinkGroup,
  linkedSymbolCount,
  canAddVisibleSlot,
  compareInput,
  compareMode,
  comparePlacement,
  activeCompareSymbols,
  activeRangePreset,
  replayDateDraft,
  linkSettings,
  isMaximized,
  hasSavedDefault,
  persistenceBoundaryNote,
  workspaceTabs,
  activeWorkspaceTabId,
  templates,
  templatesLoading,
  selectedTemplateId,
  templateDraftName,
  snapshots,
  selectedSnapshotId,
  quotesConnectionState,
  chartBatchSource,
  batchLoadingAny,
  gridTemplate,
  onSwitchWorkspaceTab,
  onAddWorkspaceTab,
  onRemoveWorkspaceTab,
  onLayoutChange,
  onAddPane,
  onApplyMultiTimeframePreset,
  onApplyCustomSplit,
  onTickerChange,
  onTimeframeChange,
  onChartTypeChange,
  onLinkGroupChange,
  onSetLinkDimension,
  onSetCompareInput,
  onSetCompareMode,
  onSetComparePlacement,
  onAddCompareSymbol,
  onRemoveCompareSymbol,
  onOpenAlerts,
  onToggleReplay,
  onReplayStepBack,
  onReplayStepForward,
  onReplayPrevSession,
  onReplayNextSession,
  onSetReplayDateDraft,
  onCommitReplayDate,
  onSetRangePreset,
  onToggleMaximize,
  onSaveWorkspaceDefault,
  onRestoreWorkspaceDefault,
  onSaveWorkspaceSnapshot,
  onSetSelectedSnapshotId,
  onApplySelectedSnapshot,
  onOpenSnapshotInNewTab,
  onCopyShareLink,
  onExportWorkspaceJson,
  onSetSelectedTemplateId,
  onApplySelectedTemplate,
  onOpenTemplateInNewTab,
  onSetTemplateDraftName,
  onSaveCurrentTemplate,
  onDrillInto,
}: Props) {
  const activeTicker = activeSlot?.ticker?.toUpperCase() ?? null;
  const paneLabel = activePaneIndex > 0 ? `Pane ${activePaneIndex}` : "No active pane";
  const focusSummary = activeSlot
    ? `${activeSlot.timeframe} ${chartTypeLabel(activeSlot.chartType)}`
    : "Select a pane to drive shell actions";
  const replayScopeLabel = linkSettings.replay && activeLinkGroup !== "off" ? `Replay Link ${activeLinkGroup}` : "Replay Active";
  const rangeScopeLabel = linkSettings.dateRange && activeLinkGroup !== "off" ? `Range Link ${activeLinkGroup}` : "Range Active";

  return (
    <div
      className="rounded border border-terminal-border bg-terminal-bg/40 p-3"
      data-density={dense ? "dense" : "comfortable"}
      data-testid="chart-shell-toolbar"
    >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.22em] text-terminal-muted">Chart Shell</span>
              <TerminalBadge variant="accent">{paneLabel}</TerminalBadge>
              <TerminalBadge variant="info">{focusSummary}</TerminalBadge>
              <TerminalBadge variant={dense ? "warn" : "neutral"}>{dense ? "Dense Desktop" : "Comfort Layout"}</TerminalBadge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1" data-testid="chart-shell-workspace-tabs">
              {workspaceTabs.map((tab) => (
                <div key={tab.id} className="inline-flex items-center rounded border border-terminal-border bg-terminal-bg/50">
                  <button
                    type="button"
                    className={`px-2 py-1 text-[10px] uppercase ${
                      tab.id === activeWorkspaceTabId
                        ? "bg-terminal-accent/15 text-terminal-accent"
                        : "text-terminal-muted hover:text-terminal-text"
                    }`}
                    onClick={() => onSwitchWorkspaceTab(tab.id)}
                    aria-pressed={tab.id === activeWorkspaceTabId}
                  >
                    {tab.name}
                  </button>
                  {workspaceTabs.length > 1 ? (
                    <button
                      type="button"
                      className="px-1 text-terminal-muted hover:text-terminal-neg"
                      onClick={() => onRemoveWorkspaceTab(tab.id)}
                      aria-label={`Close ${tab.name}`}
                    >
                      x
                    </button>
                  ) : null}
                </div>
              ))}
              <TerminalButton type="button" size="sm" variant="ghost" className="px-2" onClick={onAddWorkspaceTab}>
                + Tab
              </TerminalButton>
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <TerminalBadge variant={connectionBadgeVariant(quotesConnectionState)} size="sm" dot className="font-bold">
              DATA: {quotesConnectionState.toUpperCase()}
            </TerminalBadge>
            {batchLoadingAny ? (
              <TerminalBadge variant="live" size="sm" dot className="animate-pulse font-bold">
                LOADING CHARTS
              </TerminalBadge>
            ) : null}
            {!batchLoadingAny && chartBatchSource !== "idle" ? (
              <TerminalBadge variant={sourceBadgeVariant(chartBatchSource)} size="sm" className="font-bold">
                SOURCE: {chartBatchSource.toUpperCase()}
              </TerminalBadge>
            ) : null}
            <span className="text-[10px] font-bold uppercase text-terminal-muted">
              {visiblePaneCount}/{totalPaneCount} panes
            </span>
            {hiddenPaneCount > 0 ? (
              <TerminalBadge variant="info" size="sm" dot className="font-bold">
                {hiddenPaneCount} hidden
              </TerminalBadge>
            ) : null}
            <span data-testid="chart-shell-active-pane">
              <TerminalBadge variant={activeTicker ? "accent" : "neutral"} size="sm">
                {activeTicker ? `${paneLabel}: ${activeTicker}` : paneLabel}
              </TerminalBadge>
            </span>
          </div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-bg/50 p-2 text-[11px]">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <LayoutSelector current={gridTemplate} onChange={onLayoutChange} />
              {canAddVisibleSlot ? (
                <TerminalButton type="button" size="sm" variant="ghost" className="px-2" onClick={onAddPane}>
                  + Add Pane
                </TerminalButton>
              ) : null}
              <TerminalButton type="button" size="sm" variant="ghost" className="px-2" onClick={onApplyMultiTimeframePreset}>
                4-TF Preset
              </TerminalButton>
              <TerminalButton type="button" size="sm" variant="ghost" className="px-2" onClick={onApplyCustomSplit}>
                Custom Split
              </TerminalButton>
              <TerminalButton type="button" size="sm" variant={isMaximized ? "accent" : "ghost"} className="px-2" disabled={!activeTicker} onClick={onToggleMaximize}>
                {isMaximized ? "Restore Grid" : "Maximize Active"}
              </TerminalButton>
            </div>
            <div className="text-[10px] leading-4 text-terminal-muted">
              Layout stays available on mobile and desktop so pane-count changes don&apos;t depend on hidden controls.
            </div>
          </div>
        </div>
        <section className="rounded border border-terminal-border bg-terminal-bg/50 p-2 text-[11px]" data-testid="chart-shell-shortcuts">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="ot-type-label text-terminal-muted">Keyboard Workflows</div>
            <span className="text-[10px] text-terminal-muted">
              Focus a pane with `1-9` or click a chart before using pane-local shortcuts.
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SHORTCUT_HINTS.map((shortcut) => (
              <span
                key={shortcut.combo}
                className="inline-flex items-center gap-1 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-[10px]"
              >
                <span className="text-terminal-accent">{shortcut.combo}</span>
                <span className="text-terminal-text">{shortcut.label}</span>
              </span>
            ))}
          </div>
        </section>
        <div className="grid gap-2 md:hidden" data-testid="chart-shell-mobile-layout">
          <section className="rounded border border-terminal-border bg-terminal-bg/50 p-2 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <div className="ot-type-label text-terminal-muted">Mobile Focus</div>
              <TerminalBadge variant={activeTicker ? "accent" : "neutral"} size="sm">
                {activeTicker || "No focus"}
              </TerminalBadge>
            </div>
            <div className="mt-2 grid gap-2">
              <TickerDropdown
                value={activeSlot?.ticker ?? null}
                market={activeSlot?.market ?? "US"}
                onChange={onTickerChange}
                className="min-w-0"
                inputClassName="w-full"
                placeholder={activeTicker ? `Rotate ${activeTicker}` : "Search active pane symbol"}
                inputTestId="chart-shell-symbol-input-mobile"
              />
              <div className="grid grid-cols-2 gap-2">
                <TerminalInput
                  as="select"
                  size="sm"
                  value={activeSlot?.timeframe ?? "1D"}
                  onChange={(event) => onTimeframeChange(event.target.value as ChartSlotTimeframe)}
                  aria-label="Mobile chart timeframe"
                >
                  {TIMEFRAMES.map((timeframe) => (
                    <option key={timeframe} value={timeframe}>
                      {timeframe}
                    </option>
                  ))}
                </TerminalInput>
                <TerminalInput
                  as="select"
                  size="sm"
                  value={activeSlot?.chartType ?? "candle"}
                  onChange={(event) => onChartTypeChange(event.target.value as ChartSlotType)}
                  aria-label="Mobile chart type"
                >
                  {CHART_TYPES.map((chartType) => (
                    <option key={chartType} value={chartType}>
                      {chartTypeLabel(chartType)}
                    </option>
                  ))}
                </TerminalInput>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <TerminalInput
                  as="select"
                  size="sm"
                  value={activeLinkGroup}
                  onChange={(event) => onLinkGroupChange(event.target.value as WorkspaceLinkGroup)}
                  aria-label="Mobile link group"
                >
                  <option value="off">Link Off</option>
                  <option value="A">Link A</option>
                  <option value="B">Link B</option>
                  <option value="C">Link C</option>
                </TerminalInput>
                <TerminalInput
                  as="select"
                  size="sm"
                  value={activeRangePreset}
                  onChange={(event) => onSetRangePreset(event.target.value as RangePresetId)}
                  aria-label="Mobile date range preset"
                >
                  {RANGE_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </TerminalInput>
              </div>
              <LinkMatrix linkSettings={linkSettings} onSetLinkDimension={onSetLinkDimension} />
              <div className="text-[10px] text-terminal-muted">
                {replayScopeLabel}. {rangeScopeLabel}.
              </div>
            </div>
          </section>

          <section className="rounded border border-terminal-border bg-terminal-bg/50 p-2 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <div className="ot-type-label text-terminal-muted">Compare + Layout</div>
              <TerminalBadge variant="neutral" size="sm">{linkedSymbolCount} linked</TerminalBadge>
            </div>
            <div className="mt-2 grid gap-2">
              <div className="flex flex-wrap items-center gap-1">
                <TerminalButton type="button" size="sm" variant={actionVariant(compareMode === "normalized")} className="px-2" onClick={() => onSetCompareMode("normalized")}>
                  Perf %
                </TerminalButton>
                <TerminalButton type="button" size="sm" variant={actionVariant(compareMode === "price")} className="px-2" onClick={() => onSetCompareMode("price")}>
                  Price
                </TerminalButton>
                <TerminalInput
                  as="select"
                  size="sm"
                  value={comparePlacement}
                  onChange={(event) => onSetComparePlacement(event.target.value as ComparePlacement)}
                  aria-label="Mobile compare placement"
                >
                  <option value="active">Active Pane</option>
                  <option value="linked">Linked Panes</option>
                  <option value="all">All Visible</option>
                </TerminalInput>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <TerminalInput
                  size="sm"
                  value={compareInput}
                  data-testid="chart-shell-compare-input-mobile"
                  placeholder={activeTicker ? `Add compare for ${activeTicker}` : "Select a pane first"}
                  disabled={!activeTicker}
                  onChange={(event) => onSetCompareInput(event.target.value)}
                  onKeyDown={(event) => handleEnter(event, onAddCompareSymbol)}
                />
                <TerminalButton type="button" size="sm" variant="default" disabled={!compareInput.trim() || !activeTicker} onClick={onAddCompareSymbol}>
                  Add
                </TerminalButton>
              </div>
              <ReplayNavControls
                replayScopeLabel={replayScopeLabel}
                replayDateDraft={replayDateDraft}
                onToggleReplay={onToggleReplay}
                onReplayStepBack={onReplayStepBack}
                onReplayStepForward={onReplayStepForward}
                onReplayPrevSession={onReplayPrevSession}
                onReplayNextSession={onReplayNextSession}
                onSetReplayDateDraft={onSetReplayDateDraft}
                onCommitReplayDate={onCommitReplayDate}
              />
              <div className="grid grid-cols-2 gap-2">
                <TerminalButton type="button" size="sm" variant="default" disabled={!activeTicker} onClick={onOpenAlerts}>
                  Alerts
                </TerminalButton>
                <TerminalButton type="button" size="sm" variant={isMaximized ? "accent" : "ghost"} disabled={!activeTicker} onClick={onToggleMaximize}>
                  {isMaximized ? "Restore Grid" : "Maximize"}
                </TerminalButton>
                <TerminalButton type="button" size="sm" variant="ghost" disabled={!hasSavedDefault} onClick={onRestoreWorkspaceDefault}>
                  Load Default
                </TerminalButton>
                <TerminalButton type="button" size="sm" variant="ghost" onClick={onSaveWorkspaceSnapshot}>
                  Snapshot
                </TerminalButton>
                <TerminalButton type="button" size="sm" variant="ghost" onClick={onCopyShareLink}>
                  Share Link
                </TerminalButton>
                <TerminalButton type="button" size="sm" variant="ghost" onClick={onExportWorkspaceJson}>
                  Export JSON
                </TerminalButton>
              </div>
            </div>
          </section>
        </div>
        <div className="hidden gap-2 md:grid xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.05fr)_minmax(0,1.1fr)]">
          <section className="rounded border border-terminal-border bg-terminal-bg/50 p-2 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <div className="ot-type-label text-terminal-muted">Focus</div>
              <TerminalBadge variant={activeTicker ? "accent" : "neutral"} size="sm">
                {activeTicker || "No focus"}
              </TerminalBadge>
            </div>
            <div className="mt-2 grid gap-2">
              <TickerDropdown
                value={activeSlot?.ticker ?? null}
                market={activeSlot?.market ?? "US"}
                onChange={onTickerChange}
                className="min-w-0"
                inputClassName="w-full min-h-8"
                placeholder={activeTicker ? `Rotate ${activeTicker}` : "Search active pane symbol"}
                inputTestId="chart-shell-symbol-input-desktop"
              />
              <div className="flex flex-wrap items-center gap-2">
                <TerminalBadge variant="neutral" size="sm">{paneLabel}</TerminalBadge>
                {activeSlot ? <TerminalBadge variant="neutral" size="sm">{activeSlot.market}</TerminalBadge> : null}
                <TerminalBadge variant={activeLinkGroup === "off" ? "neutral" : "accent"} size="sm">
                  {activeLinkGroup === "off" ? "Unlinked" : `Link ${activeLinkGroup}`}
                </TerminalBadge>
              </div>
              <div className="grid gap-2 lg:grid-cols-[auto_minmax(0,1fr)]">
                <div data-testid="chart-shell-link-menu">
                  <TerminalDropdown
                    label={`Link ${activeLinkGroup === "off" ? "OFF" : activeLinkGroup}`}
                    aria-label="Change active pane link group"
                    size="sm"
                    variant="ghost"
                    items={[
                      { id: "off", label: "OFF", badge: activeLinkGroup === "off" ? "ACTIVE" : undefined },
                      { id: "A", label: "A", badge: activeLinkGroup === "A" ? "ACTIVE" : undefined },
                      { id: "B", label: "B", badge: activeLinkGroup === "B" ? "ACTIVE" : undefined },
                      { id: "C", label: "C", badge: activeLinkGroup === "C" ? "ACTIVE" : undefined },
                    ]}
                    onSelect={(id) => {
                      if (id === "off" || id === "A" || id === "B" || id === "C") {
                        onLinkGroupChange(id);
                      }
                    }}
                  />
                </div>
                <div className="text-[10px] leading-4 text-terminal-muted">
                  Active-pane context stays locked while you tab across the shell. Link policies make symbol, interval, crosshair, replay, and range behavior explicit instead of hidden behind one toggle.
                </div>
              </div>
              <LinkMatrix linkSettings={linkSettings} onSetLinkDimension={onSetLinkDimension} />
            </div>
          </section>

          <section className="rounded border border-terminal-border bg-terminal-bg/50 p-2 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <div className="ot-type-label text-terminal-muted">Chart</div>
              <span className="text-[10px] text-terminal-muted">{focusSummary}</span>
            </div>
            <div className="mt-2 grid gap-2">
              {dense ? (
                <div className="grid gap-2 md:grid-cols-2" data-testid="chart-shell-dense-selects">
                  <TerminalDropdown
                    label={activeSlot?.timeframe ?? "1D"}
                    aria-label="Change active pane timeframe"
                    size="sm"
                    variant="ghost"
                    items={TIMEFRAMES.map((timeframe) => ({
                      id: timeframe,
                      label: timeframe,
                      badge: timeframe === activeSlot?.timeframe ? "ACTIVE" : undefined,
                    }))}
                    onSelect={(id) => onTimeframeChange(id as ChartSlotTimeframe)}
                  />
                  <TerminalDropdown
                    label={chartTypeLabel(activeSlot?.chartType ?? "candle")}
                    aria-label="Change active pane chart type"
                    size="sm"
                    variant="ghost"
                    items={CHART_TYPES.map((chartType) => ({
                      id: chartType,
                      label: chartTypeLabel(chartType),
                      badge: chartType === activeSlot?.chartType ? "ACTIVE" : undefined,
                    }))}
                    onSelect={(id) => onChartTypeChange(id as ChartSlotType)}
                  />
                </div>
              ) : (
                <div className="grid gap-2" data-testid="chart-shell-timeframe-buttons">
                  <div className="flex flex-wrap gap-1">
                    {TIMEFRAMES.map((timeframe) => (
                      <TerminalButton
                        key={timeframe}
                        type="button"
                        size="sm"
                        variant={actionVariant(activeSlot?.timeframe === timeframe)}
                        className="px-2"
                        onClick={() => onTimeframeChange(timeframe)}
                      >
                        {timeframe}
                      </TerminalButton>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {CHART_TYPES.map((chartType) => (
                      <TerminalButton
                        key={chartType}
                        type="button"
                        size="sm"
                        variant={actionVariant(activeSlot?.chartType === chartType)}
                        className="px-2"
                        onClick={() => onChartTypeChange(chartType)}
                      >
                        {chartTypeLabel(chartType)}
                      </TerminalButton>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
                <TerminalInput
                  as="select"
                  size="sm"
                  value={activeRangePreset}
                  onChange={(event) => onSetRangePreset(event.target.value as RangePresetId)}
                  aria-label="Active pane date range preset"
                  data-testid="chart-shell-range-select"
                >
                  {RANGE_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </TerminalInput>
                <TerminalBadge variant={linkSettings.dateRange ? "accent" : "neutral"} size="sm">
                  {rangeScopeLabel}
                </TerminalBadge>
              </div>
              <div className="text-[10px] text-terminal-muted">
                Range presets stay local until `RNG` is on. Interval sync is separately controlled through `INT`.
              </div>
            </div>
          </section>
          <section className="rounded border border-terminal-border bg-terminal-bg/50 p-2 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <div className="ot-type-label text-terminal-muted">Compare + Actions</div>
              <div className="inline-flex items-center gap-1">
                <TerminalButton type="button" size="sm" variant={actionVariant(compareMode === "normalized")} className="px-2" onClick={() => onSetCompareMode("normalized")}>
                  Perf %
                </TerminalButton>
                <TerminalButton type="button" size="sm" variant={actionVariant(compareMode === "price")} className="px-2" onClick={() => onSetCompareMode("price")}>
                  Price
                </TerminalButton>
              </div>
            </div>
            <div className="mt-2 grid gap-2">
              <div className="flex flex-wrap gap-1" data-testid="chart-shell-compare-placement">
                <TerminalButton type="button" size="sm" variant={actionVariant(comparePlacement === "active")} className="px-2" onClick={() => onSetComparePlacement("active")}>
                  Active Pane
                </TerminalButton>
                <TerminalButton type="button" size="sm" variant={actionVariant(comparePlacement === "linked")} className="px-2" onClick={() => onSetComparePlacement("linked")}>
                  Linked Panes
                </TerminalButton>
                <TerminalButton type="button" size="sm" variant={actionVariant(comparePlacement === "all")} className="px-2" onClick={() => onSetComparePlacement("all")}>
                  All Visible
                </TerminalButton>
              </div>
              <div className="text-[10px] text-terminal-muted">
                {comparePlacementLabel(comparePlacement)} using {compareMode === "normalized" ? "performance normalization" : "absolute price"}.
              </div>
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <TerminalInput
                  size="sm"
                  value={compareInput}
                  data-testid="chart-shell-compare-input-desktop"
                  placeholder={activeTicker ? `Add compare symbol for ${activeTicker}` : "Select an active chart first"}
                  disabled={!activeTicker}
                  onChange={(event) => onSetCompareInput(event.target.value)}
                  onKeyDown={(event) => handleEnter(event, onAddCompareSymbol)}
                />
                <TerminalButton type="button" size="sm" variant="default" disabled={!compareInput.trim() || !activeTicker} onClick={onAddCompareSymbol}>
                  Add
                </TerminalButton>
              </div>
              <div className="flex min-h-8 flex-wrap gap-1">
                {activeCompareSymbols.length ? activeCompareSymbols.map((symbol) => (
                  <button
                    key={symbol}
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-terminal-border px-2 py-1 text-[10px] text-terminal-text"
                    onClick={() => onRemoveCompareSymbol(symbol)}
                  >
                    {symbol}
                    <span className="text-terminal-muted">x</span>
                  </button>
                )) : (
                  <div className="text-[10px] text-terminal-muted">Overlay up to three peers and choose which panes participate.</div>
                )}
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <TerminalButton type="button" size="sm" variant="default" disabled={!activeTicker} onClick={onOpenAlerts}>
                  Alert Center
                </TerminalButton>
                <div className="text-[10px] text-terminal-muted">
                  Replay controls stay local unless `RPLY` is on for the active link group.
                </div>
              </div>
              <ReplayNavControls
                replayScopeLabel={replayScopeLabel}
                replayDateDraft={replayDateDraft}
                testIdPrefix="chart-shell"
                onToggleReplay={onToggleReplay}
                onReplayStepBack={onReplayStepBack}
                onReplayStepForward={onReplayStepForward}
                onReplayPrevSession={onReplayPrevSession}
                onReplayNextSession={onReplayNextSession}
                onSetReplayDateDraft={onSetReplayDateDraft}
                onCommitReplayDate={onCommitReplayDate}
              />
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                <TerminalButton type="button" size="sm" variant="default" disabled={!activeTicker} onClick={() => onDrillInto("security")}>
                  Security
                </TerminalButton>
                <TerminalButton type="button" size="sm" variant="default" disabled={!activeTicker} onClick={() => onDrillInto("news")}>
                  News
                </TerminalButton>
                <TerminalButton type="button" size="sm" variant="default" disabled={!activeTicker} onClick={() => onDrillInto("screener")}>
                  Screener
                </TerminalButton>
                <TerminalButton type="button" size="sm" variant="default" disabled={!activeTicker} onClick={() => onDrillInto("compare")}>
                  Compare
                </TerminalButton>
                <TerminalButton type="button" size="sm" variant="ghost" disabled={!activeTicker} onClick={() => onDrillInto("portfolio")}>
                  Portfolio
                </TerminalButton>
              </div>
            </div>
          </section>

          <section className="rounded border border-terminal-border bg-terminal-bg/50 p-2 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <div className="ot-type-label text-terminal-muted">Workspace</div>
              <span className="text-[10px] text-terminal-muted">{gridTemplate.cols}x{gridTemplate.rows} layout</span>
            </div>
            <div className="mt-2 grid gap-2">
              <div className="grid gap-2 md:grid-cols-[auto_auto_minmax(0,1fr)]">
                <TerminalButton type="button" size="sm" variant="ghost" className="px-2" onClick={onSaveWorkspaceDefault}>
                  Save Default
                </TerminalButton>
                <TerminalButton type="button" size="sm" variant="ghost" className="px-2" disabled={!hasSavedDefault} onClick={onRestoreWorkspaceDefault}>
                  Load Default
                </TerminalButton>
                <div className="text-[10px] leading-4 text-terminal-muted">
                  Defaults persist the active tab’s layout, link matrix, compare scope, and range choices for future workstation launches.
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-[auto_auto_auto_minmax(0,1fr)]">
                <TerminalButton type="button" size="sm" variant="ghost" className="px-2" onClick={onSaveWorkspaceSnapshot}>
                  Save Snapshot
                </TerminalButton>
                <TerminalButton type="button" size="sm" variant="ghost" className="px-2" onClick={onCopyShareLink}>
                  Copy Share Link
                </TerminalButton>
                <TerminalButton type="button" size="sm" variant="ghost" className="px-2" onClick={onExportWorkspaceJson}>
                  Export JSON
                </TerminalButton>
                <div className="text-[10px] leading-4 text-terminal-muted" data-testid="chart-shell-persistence-note">
                  {persistenceBoundaryNote}
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                <TerminalInput
                  as="select"
                  size="sm"
                  value={selectedSnapshotId}
                  onChange={(event) => onSetSelectedSnapshotId(event.target.value)}
                  disabled={snapshots.length === 0}
                  data-testid="chart-shell-snapshot-select"
                >
                  <option value="">{snapshots.length ? "Select saved snapshot" : "No saved snapshots"}</option>
                  {snapshots.map((snapshot) => (
                    <option key={snapshot.id} value={snapshot.id}>
                      {snapshot.label}
                    </option>
                  ))}
                </TerminalInput>
                <TerminalButton type="button" size="sm" variant="default" disabled={!selectedSnapshotId} onClick={onApplySelectedSnapshot}>
                  Load Snapshot
                </TerminalButton>
                <TerminalButton type="button" size="sm" variant="ghost" disabled={!selectedSnapshotId} onClick={onOpenSnapshotInNewTab}>
                  Snapshot Tab
                </TerminalButton>
              </div>
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                <TerminalInput
                  as="select"
                  size="sm"
                  value={selectedTemplateId}
                  onChange={(event) => onSetSelectedTemplateId(event.target.value)}
                  disabled={templatesLoading || templates.length === 0}
                >
                  <option value="">{templatesLoading ? "Loading templates..." : "Select workstation template"}</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </TerminalInput>
                <TerminalButton type="button" size="sm" variant="default" disabled={!selectedTemplateId} onClick={onApplySelectedTemplate}>
                  Apply
                </TerminalButton>
                <TerminalButton type="button" size="sm" variant="ghost" disabled={!selectedTemplateId} onClick={onOpenTemplateInNewTab}>
                  New Tab
                </TerminalButton>
              </div>
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <TerminalInput
                  size="sm"
                  value={templateDraftName}
                  placeholder="Save current workstation as template"
                  onChange={(event) => onSetTemplateDraftName(event.target.value)}
                  onKeyDown={(event) => handleEnter(event, () => {
                    void onSaveCurrentTemplate();
                  })}
                />
                <TerminalButton type="button" size="sm" variant="accent" onClick={() => void onSaveCurrentTemplate()}>
                  Save Current
                </TerminalButton>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
