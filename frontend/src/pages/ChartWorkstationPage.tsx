import { useCallback, useEffect, useState, useMemo } from "react";
import { CrosshairSyncProvider } from "../contexts/CrosshairSyncContext";
import { useChartWorkstationStore } from "../store/chartWorkstationStore";
import { ChartGridContainer } from "../components/chart-workstation/ChartGridContainer";
import { ChartPanel } from "../components/chart-workstation/ChartPanel";
import { AddChartPlaceholder } from "../components/chart-workstation/AddChartPlaceholder";
import { LayoutSelector } from "../components/chart-workstation/LayoutSelector";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalToast, TerminalToastViewport } from "../components/terminal/TerminalToast";
import { TerminalTooltip } from "../components/terminal/TerminalTooltip";
import { useBatchChartData } from "../hooks/useBatchChartData";
import { useWorkstationQuotes } from "../hooks/useWorkstationQuotes";
import type { ChartSlotTimeframe, ChartSlotType, SlotMarket } from "../store/chartWorkstationStore";
import type { IndicatorConfig } from "../shared/chart/types";
import "../components/chart-workstation/ChartWorkstation.css";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function isMenuTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('[role="menu"]'));
}

function focusPanelBySlotId(slotId: string) {
  const el = document.querySelector<HTMLElement>(`[data-slot-id="${slotId}"]`);
  el?.focus();
}

function focusLayoutSelector() {
  const btn = document.querySelector<HTMLElement>(".layout-selector .layout-btn.active, .layout-selector .layout-btn");
  btn?.focus();
}

function getLayoutCapacity(cols: number, rows: number) {
  return Math.max(1, Math.min(6, cols * rows));
}

export function ChartWorkstationPage() {
  const [fullscreenSlotId, setFullscreenSlotId] = useState<string | null>(null);
  const [layoutNotice, setLayoutNotice] = useState<null | { title: string; message: string; variant: "info" | "success" | "warning" }>(null);
  const {
    slots,
    activeSlotId,
    gridTemplate,
    addSlot,
    removeSlot,
    updateSlotTicker,
    updateSlotTimeframe,
    updateSlotType,
    updateSlotETH,
    updateSlotPMLevels,
    updateSlotIndicators,
    setActiveSlot,
    setGridTemplate,
  } = useChartWorkstationStore();

  const visibleCapacity = getLayoutCapacity(gridTemplate.cols || 1, gridTemplate.rows || 1);
  const visibleSlots = useMemo(() => slots.slice(0, visibleCapacity), [slots, visibleCapacity]);
  const hiddenSlotCount = Math.max(0, slots.length - visibleSlots.length);
  const canAddVisibleSlot = slots.length < 6 && visibleSlots.length < visibleCapacity;

  const { bySlotId: chartBatchBySlotId, loadingAny: batchLoadingAny, source: chartBatchSource } = useBatchChartData(visibleSlots);
  const { connectionState: quotesConnectionState, quoteBySlotId } = useWorkstationQuotes(visibleSlots);

  useEffect(() => {
    if (!layoutNotice) return;
    const t = window.setTimeout(() => setLayoutNotice(null), 2500);
    return () => window.clearTimeout(t);
  }, [layoutNotice]);

  const handleLayoutChange = useCallback(
    (nextTemplate: typeof gridTemplate) => {
      const nextCapacity = getLayoutCapacity(nextTemplate.cols || 1, nextTemplate.rows || 1);
      const currentVisiblePopulated = slots
        .slice(0, visibleCapacity)
        .filter((slot) => Boolean(slot.ticker))
        .length;
      const nextVisiblePopulated = slots
        .slice(0, nextCapacity)
        .filter((slot) => Boolean(slot.ticker))
        .length;
      const populatedThatWillBeHidden = Math.max(0, currentVisiblePopulated - nextVisiblePopulated);
      const nextHiddenCount = Math.max(0, slots.length - Math.min(slots.length, nextCapacity));

      if (nextCapacity < visibleCapacity && populatedThatWillBeHidden > 0) {
        const ok = window.confirm(
          `Switch layout to ${nextTemplate.cols}x${nextTemplate.rows}? ` +
            `${populatedThatWillBeHidden} populated chart(s) will be hidden (not deleted).`,
        );
        if (!ok) return;
      }

      setGridTemplate(nextTemplate);
      if (nextCapacity < visibleCapacity && nextHiddenCount > hiddenSlotCount) {
        setLayoutNotice({
          title: "Layout reduced",
          message: `${nextHiddenCount} chart(s) hidden. They are preserved and will reappear when you expand the layout.`,
          variant: "warning",
        });
      } else if (nextCapacity > visibleCapacity && hiddenSlotCount > 0) {
        const restored = Math.min(hiddenSlotCount, nextCapacity - visibleCapacity);
        setLayoutNotice({
          title: "Layout expanded",
          message: `${restored} hidden chart(s) restored to view.`,
          variant: "success",
        });
      } else {
        setLayoutNotice({
          title: "Layout updated",
          message: `Switched to ${nextTemplate.cols}x${nextTemplate.rows}.`,
          variant: "info",
        });
      }
    },
    [hiddenSlotCount, setGridTemplate, slots, visibleCapacity],
  );

  const handleTickerChange = useCallback(
    (slotId: string) =>
      (ticker: string, market: SlotMarket, companyName?: string | null) => {
        updateSlotTicker(slotId, ticker, market, companyName);
      },
    [updateSlotTicker],
  );

  const handleTimeframeChange = useCallback(
    (slotId: string) =>
      (tf: ChartSlotTimeframe) => {
        updateSlotTimeframe(slotId, tf);
      },
    [updateSlotTimeframe],
  );

  const handleChartTypeChange = useCallback(
    (slotId: string) =>
      (chartType: ChartSlotType) => {
        updateSlotType(slotId, chartType);
      },
    [updateSlotType],
  );

  const handleETHChange = useCallback(
    (slotId: string) =>
      (eth: Partial<Parameters<typeof updateSlotETH>[1]>) => {
        updateSlotETH(slotId, eth);
      },
    [updateSlotETH],
  );

  const handlePMLevelsChange = useCallback(
    (slotId: string) =>
      (levels: Partial<Parameters<typeof updateSlotPMLevels>[1]>) => {
        updateSlotPMLevels(slotId, levels);
      },
    [updateSlotPMLevels],
  );

  const handleIndicatorsChange = useCallback(
    (slotId: string) =>
      (indicators: IndicatorConfig[]) => {
        updateSlotIndicators(slotId, indicators);
      },
    [updateSlotIndicators],
  );

  useEffect(() => {
    if (fullscreenSlotId && !slots.some((slot) => slot.id === fullscreenSlotId)) {
      setFullscreenSlotId(null);
    }
  }, [fullscreenSlotId, slots]);

  useEffect(() => {
    if (fullscreenSlotId && !visibleSlots.some((slot) => slot.id === fullscreenSlotId)) {
      setFullscreenSlotId(null);
    }
  }, [fullscreenSlotId, visibleSlots]);

  useEffect(() => {
    if (!activeSlotId) return;
    const activeIsVisible = visibleSlots.some((slot) => slot.id === activeSlotId);
    if (!activeIsVisible) {
      setActiveSlot(visibleSlots[0]?.id ?? null);
    }
  }, [activeSlotId, setActiveSlot, visibleSlots]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (isMenuTarget(event.target)) return;

      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Tab") {
        if (!visibleSlots.length) return;
        event.preventDefault();
        const currentIndex = Math.max(0, visibleSlots.findIndex((slot) => slot.id === activeSlotId));
        const nextIndex = event.shiftKey
          ? (currentIndex - 1 + visibleSlots.length) % visibleSlots.length
          : (currentIndex + 1) % visibleSlots.length;
        const nextSlot = visibleSlots[nextIndex];
        if (nextSlot) {
          setActiveSlot(nextSlot.id);
          focusPanelBySlotId(nextSlot.id);
        }
        return;
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey && /^[1-6]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        const slot = visibleSlots[index];
        if (slot) {
          event.preventDefault();
          setActiveSlot(slot.id);
          focusPanelBySlotId(slot.id);
        }
        return;
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        if (!activeSlotId) return;
        event.preventDefault();
        setFullscreenSlotId((prev) => (prev === activeSlotId ? null : activeSlotId));
        return;
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Escape") {
        if (fullscreenSlotId) {
          event.preventDefault();
          setFullscreenSlotId(null);
          return;
        }
        if (activeSlotId) {
          event.preventDefault();
          setActiveSlot(null);
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "n") {
        if (!canAddVisibleSlot) return;
        event.preventDefault();
        addSlot();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        focusLayoutSelector();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "w" && activeSlotId) {
        event.preventDefault();
        removeSlot(activeSlotId);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSlotId, addSlot, canAddVisibleSlot, fullscreenSlotId, removeSlot, setActiveSlot, slots, visibleSlots]);


  return (
    <CrosshairSyncProvider>
      <div className="chart-workstation flex h-full flex-col bg-terminal-canvas text-terminal-text" data-testid="chart-workstation">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-terminal-border bg-terminal-panel px-3 py-1.5 text-[10px]">
          <span className="ot-type-label text-terminal-accent font-bold uppercase tracking-widest">Workspace</span>

          <div className="h-4 w-px bg-terminal-border" />

          <LayoutSelector current={gridTemplate} onChange={handleLayoutChange} />

          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
            <TerminalBadge
              variant={
                quotesConnectionState === "connected"
                  ? "success"
                  : quotesConnectionState === "connecting"
                    ? "info"
                    : "danger"
              }
              size="sm"
              dot
              className="font-bold"
            >
              DATA: {quotesConnectionState.toUpperCase()}
            </TerminalBadge>

            {batchLoadingAny && (
              <TerminalBadge variant="live" size="sm" dot className="animate-pulse font-bold">
                LOADING CHARTS
              </TerminalBadge>
            )}

            {!batchLoadingAny && chartBatchSource !== "idle" && (
              <TerminalTooltip
                side="bottom"
                content={
                  chartBatchSource === "batch"
                    ? "Chart data loaded via high-performance batch endpoint."
                    : "Chart data loaded via parallel fallback requests."
                }
              >
                <span>
                  <TerminalBadge
                    variant={chartBatchSource === "batch" ? "success" : "warn"}
                    size="sm"
                    className="font-bold"
                  >
                    SYNC: {chartBatchSource.toUpperCase()}
                  </TerminalBadge>
                </span>
              </TerminalTooltip>
            )}

            <div className="h-4 w-px bg-terminal-border" />

            <span className="text-terminal-muted uppercase font-bold">
              {visibleSlots.length}/{slots.length} PANES
            </span>

            {hiddenSlotCount > 0 && (
              <TerminalBadge variant="info" size="sm" dot className="font-bold">
                {hiddenSlotCount} HIDDEN
              </TerminalBadge>
            )}

            {canAddVisibleSlot && (
              <TerminalButton
                type="button"
                size="sm"
                variant="ghost"
                className="px-2 font-bold uppercase"
                onClick={addSlot}
                data-testid="add-chart-btn"
              >
                + ADD PANE
              </TerminalButton>
            )}
          </div>
        </div>

        {/* Grid Area */}
        <div className="flex-1 min-h-0 relative">
          <ChartGridContainer slotCount={visibleSlots.length} template={gridTemplate}>
            {visibleSlots.map((slot) => (
              <ChartPanel
                key={slot.id}
                slot={slot}
                isActive={slot.id === activeSlotId}
                isFullscreen={slot.id === fullscreenSlotId}
                onActivate={() => setActiveSlot(slot.id)}
                onToggleFullscreen={() =>
                  setFullscreenSlotId((prev) => (prev === slot.id ? null : slot.id))
                }
                onRemove={() => removeSlot(slot.id)}
                onTickerChange={handleTickerChange(slot.id)}
                onTimeframeChange={handleTimeframeChange(slot.id)}
                onChartTypeChange={handleChartTypeChange(slot.id)}
                onETHChange={handleETHChange(slot.id)}
                onPMLevelsChange={handlePMLevelsChange(slot.id)}
                onIndicatorsChange={handleIndicatorsChange(slot.id)}
                chartResponse={chartBatchBySlotId[slot.id]?.data ?? null}
                chartLoading={chartBatchBySlotId[slot.id]?.loading ?? false}
                chartError={chartBatchBySlotId[slot.id]?.error ?? null}
                liveQuote={quoteBySlotId[slot.id] ?? null}
              />
            ))}
            {canAddVisibleSlot && (
              <AddChartPlaceholder onClick={addSlot} />
            )}
          </ChartGridContainer>
        </div>

        <TerminalToastViewport className="top-14">
          {layoutNotice ? (
            <TerminalToast
              title={layoutNotice.title}
              message={layoutNotice.message}
              variant={layoutNotice.variant}
            />
          ) : null}
        </TerminalToastViewport>
      </div>
    </CrosshairSyncProvider>
  );
}
