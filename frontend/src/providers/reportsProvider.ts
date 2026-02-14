import { fetchQuarterlyReports } from "../api/client";
import type { QuarterlyReport, QuarterlyReportLink } from "../types/financialReports";

type Params = {
  symbol: string;
  market: string;
  limit?: number;
};

function toQuarterLabel(value: string): string {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  const date = new Date(ts);
  const q = Math.floor(date.getUTCMonth() / 3) + 1;
  return `Q${q} ${date.getUTCFullYear()}`;
}

function toLinkType(label: string): QuarterlyReportLink["type"] {
  const normalized = label.trim().toUpperCase();
  if (normalized === "PDF") return "PDF";
  if (normalized === "HTML") return "HTML";
  return "SOURCE";
}

function toLocalReportType(value: string): QuarterlyReport["reportType"] {
  const type = value.trim().toUpperCase();
  if (type === "10-Q") return "10-Q";
  if (type === "10-K") return "10-K";
  if (type === "ANNUAL REPORT") return "Annual Report";
  return "Quarterly Results";
}

export async function getQuarterlyReports({ symbol, market, limit = 8 }: Params): Promise<QuarterlyReport[]> {
  const rows = await fetchQuarterlyReports(market, symbol, limit);
  return rows.slice(0, limit).map((row, index) => ({
    id: row.id || `${symbol.toUpperCase()}-${row.periodEndDate}-${index}`,
    quarterLabel: toQuarterLabel(row.periodEndDate),
    periodEndDate: row.periodEndDate,
    filingDate: row.publishedAt,
    reportType: toLocalReportType(row.reportType),
    links: (row.links || [])
      .filter((link) => Boolean(link?.url))
      .map((link) => ({
        type: toLinkType(link.label || "SOURCE"),
        url: link.url,
      })),
  }));
}
