import { api } from "./base";

export type MarketCode = "US" | "NSE" | "BSE" | "INDIA" | string;

export type LabLeaderboardEntry = {
  id?: string;
  run_id?: string;
  experiment_id?: string;
  portfolio_id?: string;
  name?: string;
  strategy?: string;
  symbol?: string;
  market?: string;
  status?: string;
  sharpe?: number;
  sharpe_ratio?: number;
  cagr?: number;
  total_return?: number;
  max_drawdown?: number;
  win_rate?: number;
  updated_at?: string;
  completed_at?: string;
  created_at?: string;
  [key: string]: unknown;
};

export type DashboardResults = {
  modelLab: LabLeaderboardEntry[];
  portfolioLab: LabLeaderboardEntry[];
};

export type IntelligenceTimelineItem = {
  id: string;
  kind:
    | "news"
    | "alert"
    | "event"
    | "insider"
    | "earnings"
    | "corporate_action"
    | "model_signal"
    | "backtest_run";
  title: string;
  symbol?: string;
  source?: string;
  timestamp?: string;
  sentiment?: "bullish" | "bearish" | "neutral" | string;
  score?: number | null;
  url?: string | null;
  meta?: Record<string, unknown>;
};

type RawRow = Record<string, unknown>;

function asArray(payload: unknown, keys: string[]): RawRow[] {
  if (Array.isArray(payload)) return payload as RawRow[];
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value as RawRow[];
  }
  return [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asNumber(value: unknown): number | null {
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? next : null;
}

function timestampFrom(row: RawRow, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function sortTimeline(items: IntelligenceTimelineItem[]) {
  return items.sort((left, right) => {
    const leftTs = left.timestamp ? Date.parse(left.timestamp) : 0;
    const rightTs = right.timestamp ? Date.parse(right.timestamp) : 0;
    return (Number.isFinite(rightTs) ? rightTs : 0) - (Number.isFinite(leftTs) ? leftTs : 0);
  });
}

export async function fetchDashboardResults(limit = 5): Promise<DashboardResults> {
  const [modelRes, portfolioRes] = await Promise.allSettled([
    api.get("/model-lab/leaderboard", { params: { limit } }),
    api.get("/portfolio-lab/leaderboard", { params: { limit } }),
  ]);

  return {
    modelLab:
      modelRes.status === "fulfilled"
        ? (asArray(modelRes.value.data, ["items", "results", "leaderboard", "runs"]) as LabLeaderboardEntry[]).slice(0, limit)
        : [],
    portfolioLab:
      portfolioRes.status === "fulfilled"
        ? (asArray(portfolioRes.value.data, ["items", "results", "leaderboard", "runs"]) as LabLeaderboardEntry[]).slice(0, limit)
        : [],
  };
}

export async function fetchFnoSignal(symbol: string): Promise<Record<string, unknown> | null> {
  if (!symbol.trim()) return null;
  try {
    const { data } = await api.get<Record<string, unknown>>(`/fno/signals/${encodeURIComponent(symbol.trim().toUpperCase())}`);
    return data;
  } catch {
    return null;
  }
}

export async function fetchIntelligenceTimeline(params: {
  market?: MarketCode;
  symbol?: string;
  symbols?: string[];
  limit?: number;
}): Promise<IntelligenceTimelineItem[]> {
  const limit = params.limit ?? 30;
  const symbol = params.symbol?.trim().toUpperCase();
  const symbols = Array.from(new Set([symbol, ...(params.symbols ?? [])].filter(Boolean).map((item) => item!.trim().toUpperCase()))).slice(0, 12);
  const primarySymbol = symbol || symbols[0] || "";
  const market = params.market;
  const today = new Date();
  const toDate = today.toISOString().slice(0, 10);
  const fromDate = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const calls: Array<Promise<{ bucket: string; rows: RawRow[] }>> = [
    api
      .get(primarySymbol ? `/news/by-ticker/${encodeURIComponent(primarySymbol)}` : "/news/latest", {
        params: { limit: Math.min(limit, 40), market },
      })
      .then((res) => ({ bucket: "news", rows: asArray(res.data, ["items", "results", "news"]) })),
    api.get("/alerts/history", { params: { page: 1, page_size: Math.min(limit, 40) } }).then((res) => ({
      bucket: "alert",
      rows: asArray(res.data, ["history", "items", "alerts"]),
    })),
    primarySymbol
      ? api.get(`/events/${encodeURIComponent(primarySymbol)}/upcoming`, { params: { days: 45 } }).then((res) => ({
          bucket: "event",
          rows: asArray(res.data, ["items", "events"]),
        }))
      : Promise.resolve({ bucket: "event", rows: [] }),
    primarySymbol
      ? api.get(`/earnings/${encodeURIComponent(primarySymbol)}/next`).then((res) => ({
          bucket: "earnings",
          rows: asArray(res.data, ["items", "earnings"]).concat(res.data?.item ? [res.data.item as RawRow] : []),
        }))
      : api.get("/earnings/calendar", { params: { from_date: fromDate, to_date: toDate, symbols } }).then((res) => ({
          bucket: "earnings",
          rows: asArray(res.data, ["items", "earnings"]),
        })),
    primarySymbol
      ? api.get(`/insider/stock/${encodeURIComponent(primarySymbol)}`, { params: { days: 180 } }).then((res) => ({
          bucket: "insider",
          rows: asArray(res.data, ["trades", "items"]),
        }))
      : api.get("/insider/recent", { params: { days: 30, limit: Math.min(limit, 40) } }).then((res) => ({
          bucket: "insider",
          rows: asArray(res.data, ["trades", "items"]),
        })),
    primarySymbol
      ? api.get(`/stocks/${encodeURIComponent(primarySymbol)}/corporate-actions`).then((res) => ({
          bucket: "corporate_action",
          rows: asArray(res.data, ["items", "actions", "corporate_actions", "results"]),
        }))
      : Promise.resolve({ bucket: "corporate_action", rows: [] }),
    api.get("/model-lab/leaderboard", { params: { limit: 10 } }).then((res) => ({
      bucket: "model_signal",
      rows: asArray(res.data, ["items", "results", "leaderboard", "runs"]),
    })),
    api.get("/portfolio-lab/leaderboard", { params: { limit: 10 } }).then((res) => ({
      bucket: "backtest_run",
      rows: asArray(res.data, ["items", "results", "leaderboard", "runs"]),
    })),
  ];

  const settled = await Promise.allSettled(calls);
  const items: IntelligenceTimelineItem[] = [];

  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    const { bucket, rows } = result.value;
    rows.forEach((row, index) => {
      const rowSymbol = asString(row.symbol ?? row.ticker ?? row.underlying);
      const timestamp = timestampFrom(row, [
        "published_at",
        "triggered_at",
        "event_date",
        "earnings_date",
        "date",
        "completed_at",
        "updated_at",
        "created_at",
      ]);
      const title =
        asString(row.title) ||
        asString(row.headline) ||
        asString(row.name) ||
        asString(row.event_type) ||
        asString(row.condition_type) ||
        asString(row.strategy) ||
        asString(row.experiment_id) ||
        "Desk intelligence update";
      const score = asNumber(row.sentiment_score ?? row.score ?? row.sharpe ?? row.sharpe_ratio ?? row.total_return);
      items.push({
        id: `${bucket}-${row.id ?? row.run_id ?? row.alert_id ?? rowSymbol ?? "row"}-${index}`,
        kind: bucket as IntelligenceTimelineItem["kind"],
        title,
        symbol: rowSymbol || primarySymbol || undefined,
        source: asString(row.source) || bucket.replace("_", " "),
        timestamp,
        sentiment: asString(row.sentiment_label ?? row.sentiment ?? row.impact ?? row.type ?? row.status) || undefined,
        score,
        url: asString(row.url) || null,
        meta: row,
      });
    });
  }

  return sortTimeline(items).slice(0, limit);
}
