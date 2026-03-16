import type { IChartApi } from "lightweight-charts";

type ExportableChartPoint = { t: number; o: number; h: number; l: number; c: number; v: number };

export function buildChartExportFilename(
  symbol: string,
  timeframe: string | undefined,
  extension: "png" | "csv",
): string {
  const safeSymbol = String(symbol || "chart")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "chart";
  const safeTimeframe = String(timeframe || "1D")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "1d";
  return `chart-${safeSymbol}-${safeTimeframe}.${extension}`;
}

export function buildChartCsvContents(data: ExportableChartPoint[]): string {
  const header = "Date,Open,High,Low,Close,Volume\n";
  const rows = data.map((d) => {
    const dt = new Date(d.t * 1000).toISOString().split("T")[0];
    return `${dt},${d.o},${d.h},${d.l},${d.c},${d.v}`;
  });
  return header + rows.join("\n");
}

export function exportChartPng(chart: IChartApi, filename = "chart.png"): void {
  try {
    const canvas = (chart as any).takeScreenshot?.();
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch {
    console.warn("Chart screenshot not available");
  }
}

export function exportChartCsv(
  data: ExportableChartPoint[],
  filename = "chart_data.csv"
): void {
  const blob = new Blob([buildChartCsvContents(data)], { type: "text/csv" });
  const link = document.createElement("a");
  link.download = filename;
  if (typeof URL.createObjectURL !== "function") return;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}
