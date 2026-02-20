import type { IChartApi } from "lightweight-charts";

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
  data: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>,
  filename = "chart_data.csv"
): void {
  const header = "Date,Open,High,Low,Close,Volume\n";
  const rows = data.map((d) => {
    const dt = new Date(d.t * 1000).toISOString().split("T")[0];
    return `${dt},${d.o},${d.h},${d.l},${d.c},${d.v}`;
  });
  const blob = new Blob([header + rows.join("\n")], { type: "text/csv" });
  const link = document.createElement("a");
  link.download = filename;
  if (typeof URL.createObjectURL !== "function") return;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}
