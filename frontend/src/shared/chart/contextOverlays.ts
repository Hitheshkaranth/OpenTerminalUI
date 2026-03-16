import type { CorporateEvent, PitFundamentalsResponse } from "../../types";

export type ContextOverlayKind = "event" | "action";
export type ContextOverlayTone = "positive" | "negative" | "warning" | "info" | "neutral";

export type ContextOverlayBar = {
  time: number;
  session?: string;
};

export type ContextOverlayMarker = {
  id: string;
  kind: ContextOverlayKind;
  tone: ContextOverlayTone;
  time: number;
  label: string;
  title: string;
  detail: string;
  count: number;
};

export type ContextOverlayFundamental = {
  key: string;
  label: string;
  value: string;
};

export type ContextOverlayStatus = {
  label: string;
  detail: string;
  tone: ContextOverlayTone;
};

const ACTION_TYPES = new Set<CorporateEvent["event_type"]>([
  "dividend",
  "bonus",
  "split",
  "rights",
  "buyback",
]);

const LABELS: Partial<Record<CorporateEvent["event_type"], string>> = {
  dividend: "DIV",
  bonus: "BON",
  split: "SPL",
  rights: "RGT",
  agm: "AGM",
  egm: "EGM",
  board_meeting: "BOD",
  buyback: "BUY",
  delisting: "DEL",
  ipo: "IPO",
  merger: "M&A",
  earnings: "ER",
  insider_trade: "INS",
  block_deal: "BLK",
  bulk_deal: "DEAL",
  credit_rating: "RATE",
};

const FUNDAMENTAL_PICKS: Array<{
  key: string;
  label: string;
  kind: "compact" | "ratio" | "percent";
  aliases?: string[];
}> = [
  { key: "market_cap", label: "Mkt Cap", kind: "compact" },
  { key: "pe_ratio", label: "P/E", kind: "ratio", aliases: ["pe"] },
  { key: "roe", label: "ROE", kind: "percent", aliases: ["roe_pct"] },
  { key: "dividend_yield", label: "Div Yld", kind: "percent", aliases: ["div_yield_pct"] },
  { key: "revenue_growth", label: "Rev G", kind: "percent", aliases: ["rev_growth_pct", "revenue_growth_yoy"] },
  { key: "eps_growth", label: "EPS G", kind: "percent", aliases: ["eps_growth_pct", "earnings_growth_yoy"] },
  { key: "pb_ratio", label: "P/B", kind: "ratio", aliases: ["pb"] },
  { key: "debt_equity", label: "D/E", kind: "ratio" },
];
const SECONDS_PER_DAY = 86_400;
const MILLISECONDS_PER_DAY = SECONDS_PER_DAY * 1_000;

function toUtcDayStart(value: string): number | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  return time;
}

function firstTradingBarByDay(bars: ContextOverlayBar[]): Array<{ dayTs: number; time: number }> {
  const seen = new Set<number>();
  const out: Array<{ dayTs: number; time: number }> = [];
  for (const bar of bars) {
    const dayTs = Math.floor(Number(bar.time) / SECONDS_PER_DAY) * MILLISECONDS_PER_DAY;
    if (!Number.isFinite(dayTs) || seen.has(dayTs)) continue;
    seen.add(dayTs);
    out.push({ dayTs, time: bar.time });
  }
  return out;
}

function findTradingDayMatch(
  tradingDays: Array<{ dayTs: number; time: number }>,
  anchorTs: number,
): { dayTs: number; time: number } | null {
  let low = 0;
  let high = tradingDays.length - 1;
  let matchIndex = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = tradingDays[mid];
    if (!candidate) break;
    if (candidate.dayTs >= anchorTs) {
      matchIndex = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return matchIndex >= 0 ? tradingDays[matchIndex] ?? null : null;
}

function resolveAnchorDate(event: CorporateEvent): string {
  if (ACTION_TYPES.has(event.event_type) && event.ex_date) return event.ex_date;
  return event.event_date;
}

function resolveEventTone(event: CorporateEvent): ContextOverlayTone {
  if (event.impact === "negative" || event.event_type === "delisting") return "negative";
  if (ACTION_TYPES.has(event.event_type)) return "positive";
  if (event.event_type === "board_meeting" || event.event_type === "credit_rating") return "warning";
  if (event.event_type === "earnings") return "info";
  return "neutral";
}

function markerLabel(event: CorporateEvent): string {
  return LABELS[event.event_type] ?? event.event_type.slice(0, 3).toUpperCase();
}

function formatPercent(value: number): string {
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  return `${normalized.toFixed(Math.abs(normalized) >= 100 ? 0 : 1)}%`;
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: Math.abs(value) >= 10 ? 1 : 2,
  }).format(value);
}

function formatRatio(value: number): string {
  return `${value.toFixed(Math.abs(value) >= 100 ? 0 : 1)}x`;
}

function findMetricValue(
  metrics: Record<string, number> | undefined,
  key: string,
  aliases: string[] = [],
): number | null {
  if (!metrics) return null;
  for (const candidate of [key, ...aliases]) {
    const value = metrics[candidate];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function classifyContextEvent(eventType: CorporateEvent["event_type"]): ContextOverlayKind {
  return ACTION_TYPES.has(eventType) ? "action" : "event";
}

export function buildContextOverlayMarkers(
  events: CorporateEvent[],
  bars: ContextOverlayBar[],
): ContextOverlayMarker[] {
  if (!events.length || !bars.length) return [];
  const tradingDays = firstTradingBarByDay(bars);
  const firstDayTs = tradingDays[0]?.dayTs ?? null;
  const lastDayTs = tradingDays[tradingDays.length - 1]?.dayTs ?? null;
  if (firstDayTs === null || lastDayTs === null) return [];

  const grouped = new Map<string, {
    kind: ContextOverlayKind;
    tone: ContextOverlayTone;
    time: number;
    label: string;
    items: CorporateEvent[];
  }>();

  for (const event of events) {
    const anchorDate = resolveAnchorDate(event);
    const anchorTs = toUtcDayStart(anchorDate);
    if (anchorTs === null || anchorTs < firstDayTs || anchorTs > lastDayTs) continue;
    const match = findTradingDayMatch(tradingDays, anchorTs);
    if (!match) continue;
    const kind = classifyContextEvent(event.event_type);
    const key = `${kind}:${match.time}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.items.push(event);
      if (existing.tone === "neutral") existing.tone = resolveEventTone(event);
      continue;
    }
    grouped.set(key, {
      kind,
      tone: resolveEventTone(event),
      time: match.time,
      label: markerLabel(event),
      items: [event],
    });
  }

  return Array.from(grouped.entries())
    .map(([id, group]) => {
      const primary = group.items[0];
      const extraCount = Math.max(0, group.items.length - 1);
      return {
        id,
        kind: group.kind,
        tone: group.tone,
        time: group.time,
        label: extraCount > 0 ? `${group.label}+${extraCount}` : group.label,
        title: primary?.title ?? group.label,
        detail: group.items.map((item) => item.title).join(" | "),
        count: group.items.length,
      };
    })
    .sort((left, right) => left.time - right.time || left.kind.localeCompare(right.kind));
}

export function pickFundamentalContext(
  fundamentals: PitFundamentalsResponse | null | undefined,
  limit = 4,
): ContextOverlayFundamental[] {
  const metrics = fundamentals?.metrics;
  if (!metrics) return [];
  const rows: ContextOverlayFundamental[] = [];
  for (const pick of FUNDAMENTAL_PICKS) {
    const value = findMetricValue(metrics, pick.key, pick.aliases ?? []);
    if (value === null) continue;
    rows.push({
      key: pick.key,
      label: pick.label,
      value:
        pick.kind === "compact"
          ? formatCompact(value)
          : pick.kind === "ratio"
            ? formatRatio(value)
            : formatPercent(value),
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

export function describeSessionState(
  bar: ContextOverlayBar | null | undefined,
  replayEnabled: boolean,
): ContextOverlayStatus | null {
  if (!bar) return null;
  const raw = String(bar.session || "rth").toLowerCase();
  const label =
    raw === "pre" || raw === "pre_open"
      ? "PRE"
      : raw === "post" || raw === "closing"
        ? "POST"
        : "RTH";
  const tone: ContextOverlayTone =
    label === "RTH" ? "positive" : label === "PRE" ? "info" : "warning";
  return {
    label: replayEnabled ? `REPLAY ${label}` : label,
    detail: new Date(bar.time * 1000).toLocaleString(),
    tone,
  };
}

export function describeMarketState(args: {
  market: "US" | "IN";
  replayEnabled: boolean;
  bar: ContextOverlayBar | null | undefined;
  liveMarketStatus?: Record<string, unknown> | null;
}): ContextOverlayStatus {
  if (args.replayEnabled) {
    const session = describeSessionState(args.bar, true);
    return {
      label: session?.label ?? "REPLAY",
      detail: session?.detail ?? "Replay context",
      tone: session?.tone ?? "info",
    };
  }

  const payload = args.liveMarketStatus ?? {};
  const raw =
    args.market === "US"
      ? String(payload.nyseStatus ?? payload.marketStatus ?? payload.status ?? "").toUpperCase()
      : String((payload.marketState as Array<{ marketStatus?: string }> | undefined)?.[0]?.marketStatus ?? payload.nseStatus ?? payload.marketStatus ?? "").toUpperCase();

  if (raw.includes("PRE")) {
    return { label: "PRE", detail: args.market === "US" ? "US market pre-open" : "IN market pre-open", tone: "info" };
  }
  if (raw.includes("OPEN")) {
    return { label: "OPEN", detail: args.market === "US" ? "US market live" : "IN market live", tone: "positive" };
  }
  if (raw.includes("AFTER")) {
    return { label: "AFTER", detail: args.market === "US" ? "US after hours" : "After hours", tone: "warning" };
  }
  if (raw.includes("CLOSE")) {
    return { label: "CLOSED", detail: args.market === "US" ? "US market closed" : "IN market closed", tone: "neutral" };
  }

  const session = describeSessionState(args.bar, false);
  return {
    label: session?.label ?? "STATUS",
    detail: session?.detail ?? "Status unavailable",
    tone: session?.tone ?? "neutral",
  };
}
