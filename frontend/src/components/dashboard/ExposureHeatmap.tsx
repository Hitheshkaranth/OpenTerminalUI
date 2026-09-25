import type { PortfolioItem } from "../../types";
import { GuidedEmptyState } from "./GuidedEmptyState";

type HeatmapMode = "sector" | "factor" | "currency" | "correlation";

type ExposureCell = {
  label: string;
  value: number;
  context?: string;
  tone?: "positive" | "negative" | "neutral" | "accent";
};

function asNumber(value: unknown): number {
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? next : 0;
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function classifyCurrency(item: PortfolioItem, market: string): string {
  const exchange = (item.exchange || "").toUpperCase();
  const country = (item.country_code || "").toUpperCase();
  if (exchange.includes("NSE") || exchange.includes("BSE") || country === "IN" || market === "NSE" || market === "BSE") return "INR";
  return "USD";
}

function sectorCells(items: PortfolioItem[]): ExposureCell[] {
  const total = items.reduce((sum, item) => sum + asNumber(item.current_value), 0);
  const bySector = new Map<string, number>();
  items.forEach((item) => {
    bySector.set(item.sector || "Unclassified", (bySector.get(item.sector || "Unclassified") || 0) + asNumber(item.current_value));
  });
  return [...bySector.entries()]
    .map(([label, value]) => ({ label, value: total > 0 ? (value / total) * 100 : 0, context: "portfolio weight", tone: "accent" as const }))
    .sort((left, right) => right.value - left.value);
}

function currencyCells(items: PortfolioItem[], market: string): ExposureCell[] {
  const total = items.reduce((sum, item) => sum + asNumber(item.current_value), 0);
  const byCurrency = new Map<string, number>();
  items.forEach((item) => {
    const currency = classifyCurrency(item, market);
    byCurrency.set(currency, (byCurrency.get(currency) || 0) + asNumber(item.current_value));
  });
  return [...byCurrency.entries()].map(([label, value]) => ({
    label,
    value: total > 0 ? (value / total) * 100 : 0,
    context: label === "INR" ? "India" : "US",
    tone: "neutral" as const,
  }));
}

function factorCells(items: PortfolioItem[], factorExposures?: Record<string, unknown>): ExposureCell[] {
  const raw = (factorExposures?.exposures || factorExposures || {}) as Record<string, unknown>;
  const keys = ["market", "momentum", "value", "quality", "size", "low_vol"];
  const fromApi = keys
    .map((key) => {
      const entry = raw[key] as Record<string, unknown> | number | undefined;
      const value = typeof entry === "number" ? entry : asNumber(entry?.exposure);
      return { label: key.replace("_", " "), value: value * 100, context: "factor beta", tone: value >= 0 ? ("positive" as const) : ("negative" as const) };
    })
    .filter((cell) => Math.abs(cell.value) > 0.01);
  if (fromApi.length) return fromApi;

  const growth = items.filter((item) => asNumber(item.pnl) >= 0).length;
  const loss = Math.max(0, items.length - growth);
  return [
    { label: "momentum", value: items.length ? (growth / items.length) * 100 : 0, context: "profitable names", tone: "positive" },
    { label: "drawdown", value: items.length ? (loss / items.length) * -100 : 0, context: "losing names", tone: "negative" },
  ];
}

function correlationCells(correlation?: Record<string, unknown>): ExposureCell[] {
  const assets = Array.isArray(correlation?.assets) ? (correlation.assets as string[]) : [];
  const matrix = Array.isArray(correlation?.matrix) ? (correlation.matrix as number[][]) : [];
  if (!assets.length || !matrix.length) return [];
  return assets.slice(0, 10).map((asset, index) => {
    const row = Array.isArray(matrix[index]) ? matrix[index] : [];
    const values = row.filter((_, i) => i !== index).map(asNumber).filter((value) => Number.isFinite(value));
    const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    return {
      label: asset,
      value: avg * 100,
      context: "avg corr",
      tone: avg > 0.65 ? ("negative" as const) : avg < 0.25 ? ("positive" as const) : ("neutral" as const),
    };
  });
}

function toneClass(cell: ExposureCell): string {
  if (cell.tone === "positive") return "border-terminal-pos/50 bg-terminal-pos/15 text-terminal-pos";
  if (cell.tone === "negative") return "border-terminal-neg/50 bg-terminal-neg/15 text-terminal-neg";
  if (cell.tone === "accent") return "border-terminal-accent/50 bg-terminal-accent/15 text-terminal-accent";
  return "border-terminal-border bg-terminal-bg text-terminal-text";
}

export function ExposureHeatmap({
  title = "Exposure Heatmap",
  market,
  scopeLabel,
  items,
  factorExposures,
  correlation,
  defaultMode = "sector",
  onCreateWatchlist,
  onOpenRisk,
}: {
  title?: string;
  market: string;
  /** What the exposures describe (e.g. "Portfolio"); defaults to the market desk. */
  scopeLabel?: string;
  items: PortfolioItem[];
  factorExposures?: Record<string, unknown> | null;
  correlation?: Record<string, unknown> | null;
  defaultMode?: HeatmapMode;
  onCreateWatchlist?: () => void;
  onOpenRisk?: () => void;
}) {
  const modes: HeatmapMode[] = ["sector", "factor", "currency", "correlation"];
  const cellsByMode: Record<HeatmapMode, ExposureCell[]> = {
    sector: sectorCells(items),
    factor: factorCells(items, factorExposures ?? undefined),
    currency: currencyCells(items, market),
    correlation: correlationCells(correlation ?? undefined),
  };
  const activeMode = cellsByMode[defaultMode]?.length ? defaultMode : modes.find((mode) => cellsByMode[mode].length) ?? defaultMode;
  const cells = cellsByMode[activeMode].slice(0, 12);

  return (
    <div className="rounded-sm border border-terminal-border bg-terminal-panel/80 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="ot-type-panel-title uppercase tracking-[0.14em] text-terminal-accent">{title}</h3>
          <p className="mt-1 text-xs text-terminal-muted">Sector, factor, currency, and correlation concentration for {scopeLabel ? `${scopeLabel} (${market} desk)` : `the ${market} desk`}.</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {modes.map((mode) => (
            <span
              key={mode}
              className={`rounded-sm border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
                mode === activeMode ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"
              }`}
            >
              {mode}
            </span>
          ))}
        </div>
      </div>
      {cells.length ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
          {cells.map((cell) => {
            const magnitude = Math.min(100, Math.max(10, Math.abs(cell.value)));
            return (
              <div key={`${activeMode}-${cell.label}`} className={`rounded-sm border p-2 ${toneClass(cell)}`}>
                <div className="truncate text-[11px] uppercase tracking-[0.1em]">{cell.label}</div>
                <div className="mt-2 text-lg font-semibold tabular-nums">{pct(cell.value)}</div>
                <div className="mt-2 h-1.5 rounded bg-terminal-bg/80">
                  <div className="h-1.5 rounded bg-current opacity-70" style={{ width: `${magnitude}%` }} />
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.1em] opacity-75">{cell.context || activeMode}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <GuidedEmptyState
          title="Build exposure context"
          message="Add holdings or run the risk engine to populate sector, factor, currency, and correlation exposure maps."
          icon="HEAT"
          actions={[
            { label: "Create Watchlist", onClick: onCreateWatchlist },
            { label: "Open Risk", onClick: onOpenRisk },
          ].filter((action) => Boolean(action.onClick))}
        />
      )}
    </div>
  );
}
