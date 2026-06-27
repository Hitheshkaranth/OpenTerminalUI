import type { ScreenerView } from "../ScreenerContext";
import { VizPanel } from "./VizPanel";

type ScreenVizLoaderProps = {
  screenId: string | null;
  vizData: Record<string, unknown>;
  view?: ScreenerView;
  rows?: Array<Record<string, unknown>>;
};

export function ScreenVizLoader({ screenId, vizData, view = "charts", rows = [] }: ScreenVizLoaderProps) {
  return (
    <div>
      <div className="mb-2 text-xs text-terminal-muted">Screen Viz: {screenId || "custom"}</div>
      <VizPanel vizData={vizData} view={view} rows={rows} />
    </div>
  );
}
