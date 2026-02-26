import { useMemo } from "react";
import { TickerDropdown } from "./TickerDropdown";
import ExtendedHoursToggle from "./ExtendedHoursToggle";
import { GapBadge, type GapInfo } from "../chart/GapAnalysis";
import type { ChartSlot, ChartSlotTimeframe, ChartSlotType, SlotMarket, ExtendedHoursConfig } from "../../store/chartWorkstationStore";
import { TerminalBadge } from "../terminal/TerminalBadge";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalDropdown } from "../terminal/TerminalDropdown";
import { TerminalTooltip } from "../terminal/TerminalTooltip";
import "./ChartWorkstation.css";

const TIMEFRAMES: ChartSlotTimeframe[] = ["1m", "5m", "15m", "1h", "1D", "1W", "1M"];
const CHART_TYPES: ChartSlotType[] = ["candle", "line", "area"];

interface Props {
  slot: ChartSlot;
  isFullscreen: boolean;
  onTickerChange: (ticker: string, market: SlotMarket, companyName?: string | null) => void;
  onTimeframeChange: (tf: ChartSlotTimeframe) => void;
  onChartTypeChange: (type: ChartSlotType) => void;
  onETHChange: (eth: Partial<ExtendedHoursConfig>) => void;
  onRemove: () => void;
  onToggleFullscreen: () => void;
  chartData?: any[];
}

export function ChartPanelHeader({
  slot,
  isFullscreen,
  onTickerChange,
  onTimeframeChange,
  onChartTypeChange,
  onETHChange,
  onRemove,
  onToggleFullscreen,
  chartData = [],
}: Props) {
  const isDailyPlus = ["1D", "1W", "1M"].includes(slot.timeframe);

  const gap: GapInfo | null = useMemo(() => {
    if (!chartData || chartData.length < 2) return null;

    // Find the first RTH candle of the most recent day
    const lastDayStr = new Date(chartData[chartData.length - 1].t * 1000).toDateString();
    const lastDayBars = chartData.filter(b => new Date(b.t * 1000).toDateString() === lastDayStr);
    const firstRth = lastDayBars.find(b => b.s === "rth");

    // Find the last candle of the previous day
    const prevDayBars = chartData.filter(b => new Date(b.t * 1000).toDateString() !== lastDayStr);
    const lastPrevDay = prevDayBars.length > 0 ? prevDayBars[prevDayBars.length - 1] : null;

    if (!firstRth || !lastPrevDay) return null;

    const diff = firstRth.o - lastPrevDay.c;
    const pct = (diff / lastPrevDay.c) * 100;

    return {
      previousClose: lastPrevDay.c,
      preMarketHigh: Math.max(...lastDayBars.filter(b => b.s !== "rth").map(b => b.h), firstRth.h),
      preMarketLow: Math.min(...lastDayBars.filter(b => b.s !== "rth").map(b => b.l), firstRth.l),
      openPrice: firstRth.o,
      gapAmount: diff,
      gapPercent: pct,
      gapType: pct > 0.1 ? "gap_up" : pct < -0.1 ? "gap_down" : "flat",
      gapFilled: pct > 0 ? lastDayBars.some(b => b.l <= lastPrevDay.c) : lastDayBars.some(b => b.h >= lastPrevDay.c)
    };
  }, [chartData]);

  return (
    <div className="chart-panel-header flex items-center gap-2 border-b border-terminal-border bg-terminal-panel px-2 py-1" data-testid={`cw-panel-header-${slot.id}`}>
      <TickerDropdown value={slot.ticker} market={slot.market} onChange={onTickerChange} />

      {slot.companyName && (
        <span className="max-w-40 truncate text-[10px] text-terminal-muted" title={slot.companyName}>
          {slot.companyName}
        </span>
      )}

      <div className="h-4 w-px bg-terminal-border" />

      <TerminalBadge variant="neutral" size="sm" className="font-bold">
        {slot.market}
      </TerminalBadge>

      <div className="h-4 w-px bg-terminal-border" />

      <TerminalDropdown
        label={slot.timeframe}
        aria-label="Change timeframe"
        size="sm"
        variant="ghost"
        items={TIMEFRAMES.map((tf) => ({
          id: tf,
          label: tf,
          badge: tf === slot.timeframe ? "ACTIVE" : undefined,
        }))}
        onSelect={(id) => {
          if (TIMEFRAMES.includes(id as ChartSlotTimeframe)) {
            onTimeframeChange(id as ChartSlotTimeframe);
          }
        }}
      />

      <TerminalDropdown
        label={slot.chartType.toUpperCase()}
        aria-label="Change chart type"
        size="sm"
        variant="ghost"
        items={CHART_TYPES.map((type) => ({
          id: type,
          label: type.toUpperCase(),
          badge: type === slot.chartType ? "ACTIVE" : undefined,
        }))}
        onSelect={(id) => {
          if (CHART_TYPES.includes(id as ChartSlotType)) {
            onChartTypeChange(id as ChartSlotType);
          }
        }}
      />

      <div className="h-4 w-px bg-terminal-border" />

      <ExtendedHoursToggle
        value={slot.extendedHours}
        onChange={onETHChange}
        market={slot.market}
        disabled={isDailyPlus}
      />

      {gap && (
        <>
          <div className="h-4 w-px bg-terminal-border" />
          <GapBadge gap={gap} />
        </>
      )}

      <div className="ml-auto flex items-center gap-1">
        <TerminalTooltip content={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
          <span>
            <TerminalButton
              type="button"
              size="sm"
              variant={isFullscreen ? "accent" : "ghost"}
              className="min-w-8 px-1.5"
              onClick={onToggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen chart"}
            >
              {isFullscreen ? "Exit" : "FS"}
            </TerminalButton>
          </span>
        </TerminalTooltip>

        <TerminalTooltip content="Remove chart">
          <span>
            <TerminalButton
              type="button"
              size="sm"
              variant="danger"
              className="min-w-8 px-1.5"
              onClick={onRemove}
              aria-label="Remove chart"
              data-testid={`remove-chart-${slot.id}`}
            >
              X
            </TerminalButton>
          </span>
        </TerminalTooltip>
      </div>
    </div>
  );
}
