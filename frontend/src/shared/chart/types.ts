import type { Bar, IndicatorResult } from "oakscriptjs";
import type { ISeriesApi, Time } from "lightweight-charts";
import type { ExtendedHoursConfig } from "../../store/chartWorkstationStore";

export type ChartKind = "candle" | "line" | "area" | "baseline";

export type ChartTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1D" | "1W" | "1M";

export type IndicatorConfig = {
  id: string;
  params: Record<string, unknown>;
  visible: boolean;
  color?: string;
  lineWidth?: number;
};

export type ChartEngineProps = {
  symbol: string;
  timeframe: ChartTimeframe;
  historicalData: Bar[];
  activeIndicators: IndicatorConfig[];
  chartType: ChartKind;
  showVolume: boolean;
  enableRealtime: boolean;
  height?: number;
  market?: string;
  symbolIsFnO?: boolean;
  onCrosshairOHLC?: (payload: { open: number; high: number; low: number; close: number; time: number } | null) => void;
  onTick?: (payload: { ltp: number; change_pct: number } | null) => void;
  canRequestBackfill?: boolean;
  onRequestBackfill?: (oldestTime: number) => Promise<void> | void;
  showDeliveryOverlay?: boolean;
  deliverySeries?: Array<{ time: number; value: number }>;
  panelId?: string;
  extendedHours?: ExtendedHoursConfig;
};

export type IndicatorRegistryView = {
  id: string;
  name: string;
  category: string;
  overlay: boolean;
  defaultInputs: Record<string, unknown>;
};

export type IndicatorSeriesRegistry = Record<string, Record<string, ISeriesApi<"Line", Time>>>;

export type IndicatorComputation = {
  config: IndicatorConfig;
  result: IndicatorResult;
  overlay: boolean;
};
