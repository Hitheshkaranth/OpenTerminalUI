import { getAccessToken } from "../api/base";

export interface UnifiedOHLCVBar {
  t: number; // ms epoch
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  s?: string;   // session: "pre", "rth", "post", etc.
  ext?: boolean; // isExtended
}

export interface UnifiedChartResponse {
  symbol: string;
  interval: string;
  count: number;
  market_hint?: string;
  data: UnifiedOHLCVBar[];
}

/** Bound the request so a hung backend surfaces as an error instead of an endless "Loading chart...". */
const CHART_FETCH_TIMEOUT_MS = 20_000;

function apiBase(): string {
  return String(import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/+$/, "");
}

export async function fetchChartData(
  symbol: string,
  opts?: {
    market?: string;
    interval?: string;
    period?: string;
    start?: string;
    end?: string;
    extended?: boolean;
  },
): Promise<UnifiedChartResponse> {
  const params = new URLSearchParams();
  params.set("normalized", "true");
  params.set("interval", opts?.interval ?? "1d");
  params.set("period", opts?.period ?? "6mo");
  if (opts?.market) params.set("market", opts.market);
  if (opts?.start) params.set("start", opts.start);
  if (opts?.end) params.set("end", opts.end);
  if (opts?.extended) params.set("extended", "true");
  const token = getAccessToken();
  const res = await fetch(`${apiBase()}/chart/${encodeURIComponent(symbol)}?${params.toString()}`, {
    // /api routes are authenticated; without the bearer this always 401'd and fell back to a second request.
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(CHART_FETCH_TIMEOUT_MS) : undefined,
  });
  if (!res.ok) {
    throw new Error(`Unified chart fetch failed (${res.status})`);
  }
  return (await res.json()) as UnifiedChartResponse;
}
