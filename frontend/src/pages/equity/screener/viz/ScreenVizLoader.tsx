import { VizPanel } from "./VizPanel";

type ScreenVizLoaderProps = {
  screenId: string | null;
  vizData: Record<string, unknown>;
};

export function ScreenVizLoader({ screenId, vizData }: ScreenVizLoaderProps) {
  return (
    <div>
      <div className="mb-2 text-xs text-terminal-muted">Screen Viz: {screenId || "custom"}</div>
      <VizPanel vizData={vizData} />
    </div>
  );
}
