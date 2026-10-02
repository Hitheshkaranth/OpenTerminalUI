import { api, extractApiErrorMessage } from "./base";

export type Market = "IN" | "US";

export type IdeaItem = {
  symbol: string;
  name: string | null;
  headline: string;
  metric_label: string | null;
  metric_value: number | null;
  date: string | null;
  source_url: string | null;
};

export type IdeaCategory = {
  id:
    | "insider_buying"
    | "bulk_block_deals"
    | "order_wins"
    | "capex_expansion"
    | "regulatory_approvals"
    | "results_momentum"
    | "near_52w_high"
    | "volume_breakouts";
  label: string;
  description: string;
  items: IdeaItem[];
};

export type IdeasBoard = {
  market: Market;
  generated_at: string;
  categories: IdeaCategory[];
  warnings: string[];
};

export type TimelineEvent = {
  date: string;
  symbol: string;
  kind: "filing" | "order_win" | "capex" | "regulatory" | "insider" | "results" | "analysis";
  headline: string;
  source_url: string | null;
};

export type ThemeSummary = {
  id: string;
  name: string;
  description: string;
  market: Market;
  constituents: number;
  return_1m: number | null;
  return_3m: number | null;
  return_6m: number | null;
  return_1y: number | null;
  vs_benchmark_1y: number | null;
};

export type ThemeDetail = ThemeSummary & {
  benchmark: string;
  series: { date: string; index: number; benchmark: number | null }[];
  members: { symbol: string; name: string; weight: number; last: number | null; return_1y: number | null }[];
};

type RawRow = Record<string, unknown>;

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asNumber(value: unknown): number | null {
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? next : null;
}

function asArray(value: unknown): RawRow[] {
  if (Array.isArray(value)) return value as RawRow[];
  if (!value || typeof value !== "object") return [];
  return [] as RawRow[];
}

export function toMarket(value: unknown): Market {
  return String(value ?? "").toUpperCase() === "US" ? "US" : "IN";
}

export function marketFromDesk(value: unknown): Market {
  const normalized = String(value ?? "").toUpperCase();
  return normalized === "NSE" || normalized === "BSE" ? "IN" : "US";
}

function sanitizeItem(raw: RawRow): IdeaItem {
  const symbol = asString(raw.symbol ?? raw.ticker ?? raw.tradingsymbol).toUpperCase();
  return {
    symbol,
    name: asString(raw.name) || null,
    headline: asString(raw.headline ?? raw.title) || (symbol ? `Idea — ${symbol}` : "Idea"),
    metric_label: asString(raw.metric_label ?? raw.metric) || null,
    metric_value: asNumber(raw.metric_value ?? raw.value),
    date: asString(raw.date ?? raw.event_date) || null,
    source_url: asString(raw.source_url ?? raw.url) || null,
  };
}

function sanitizeCategory(raw: RawRow): IdeaCategory {
  const id = asString(raw.id);
  const category = {
    id: id as IdeaCategory["id"],
    label: asString(raw.label) || (id ? id.replace(/_/g, " ") : "Idea"),
    description: asString(raw.description) || "",
    items: asArray(raw.items).map(sanitizeItem),
  };
  return category;
}

function sanitizeEvent(raw: RawRow): TimelineEvent {
  const symbol = asString(raw.symbol ?? raw.ticker ?? raw.underlying).toUpperCase();
  const date = asString(raw.date ?? raw.timestamp ?? raw.filed_at) || new Date().toISOString().slice(0, 10);
  return {
    date,
    symbol,
    kind: (asString(raw.kind) || "analysis") as TimelineEvent["kind"],
    headline: asString(raw.headline ?? raw.title) || (symbol ? `Idea — ${symbol}` : "Idea"),
    source_url: asString(raw.source_url ?? raw.url) || null,
  };
}

function sanitizeSummary(raw: RawRow): ThemeSummary {
  const id = asString(raw.id);
  return {
    id,
    name: asString(raw.name) || (id ? id.replace(/_/g, " ") : "Theme"),
    description: asString(raw.description) || "",
    market: toMarket(raw.market),
    constituents: asNumber(raw.constituents ?? raw.count ?? 0) ?? 0,
    return_1m: asNumber(raw.return_1m),
    return_3m: asNumber(raw.return_3m),
    return_6m: asNumber(raw.return_6m),
    return_1y: asNumber(raw.return_1y),
    vs_benchmark_1y: asNumber(raw.vs_benchmark_1y),
  };
}

function sanitizeDetail(raw: RawRow): ThemeDetail | null {
  const id = asString(raw.id);
  if (!id) return null;
  return {
    ...sanitizeSummary(raw),
    benchmark: asString(raw.benchmark) || "Benchmark",
    series: asArray(raw.series)
      .map((point) => ({
        date: asString(point.date ?? point.when),
        index: asNumber(point.index ?? point.value),
        benchmark: asNumber(point.benchmark ?? point.bench),
      }))
      // A point without an index value cannot be charted; drop it rather than plot a fake 0.
      .filter((point): point is { date: string; index: number; benchmark: number | null } => Boolean(point.date) && point.index != null),
    members: asArray(raw.members)
      .map((member) => {
        const symbol = asString(member.symbol ?? member.ticker ?? member.tradingsymbol).toUpperCase();
        if (!symbol) return null;
        return {
          symbol,
          name: asString(member.name) || symbol,
          weight: asNumber(member.weight) ?? 0,
          last: asNumber(member.last ?? member.price),
          return_1y: asNumber(member.return_1y),
        };
      })
      .filter((member): member is Exclude<typeof member, null> => member !== null),
  };
}

export async function fetchIdeasBoard(market: Market): Promise<IdeasBoard> {
  const { data } = await api.get<RawRow>("/ideas", { params: { market } });
  const payload = data || {};
  return {
    market: toMarket(payload.market),
    generated_at: asString(payload.generated_at) || new Date().toISOString(),
    categories: asArray(payload.categories).map(sanitizeCategory),
    warnings: asArray(payload.warnings).map(asString),
  };
}

export async function fetchIdeasTimeline(params: {
  symbols?: string[];
  market: Market;
  limit?: number;
}): Promise<TimelineEvent[]> {
  const symbols = (params.symbols ?? [])
    .map((symbol) => String(symbol || "").trim().toUpperCase())
    .filter(Boolean);
  if (!symbols.length) return [];
  const limit = params.limit ?? 50;
  const { data } = await api.get<RawRow>("/ideas/timeline", {
    params: { symbols: symbols.join(","), market: params.market, limit },
  });
  return asArray(data?.items).map(sanitizeEvent);
}

export async function fetchThemes(market: Market): Promise<{ market: Market; benchmark: string; themes: ThemeSummary[] }> {
  const { data } = await api.get<RawRow>("/themes", { params: { market } });
  const payload = data || {};
  return {
    market: toMarket(payload.market),
    benchmark: asString(payload.benchmark) || "—",
    themes: asArray(payload.themes).map(sanitizeSummary),
  };
}

export async function fetchThemeDetail(themeId: string): Promise<ThemeDetail | null> {
  const id = String(themeId || "").trim();
  if (!id) return null;
  try {
    const { data } = await api.get<RawRow>(`/themes/${encodeURIComponent(id)}`);
    return sanitizeDetail(data || {});
  } catch (error) {
    throw new Error(extractApiErrorMessage(error, "Theme detail unavailable"));
  }
}

export { extractApiErrorMessage };