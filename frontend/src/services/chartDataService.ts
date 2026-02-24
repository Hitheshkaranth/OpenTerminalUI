export interface UnifiedOHLCVBar {
  t: number; // ms epoch
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface UnifiedChartResponse {
  symbol: string;
  interval: string;
  count: number;
  market_hint?: string;
  data: UnifiedOHLCVBar[];
}

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
  },
): Promise<UnifiedChartResponse> {
  const params = new URLSearchParams();
  params.set("normalized", "true");
  params.set("interval", opts?.interval ?? "1d");
  params.set("period", opts?.period ?? "6mo");
  if (opts?.market) params.set("market", opts.market);
  if (opts?.start) params.set("start", opts.start);
  if (opts?.end) params.set("end", opts.end);
  const res = await fetch(`${apiBase()}/chart/${encodeURIComponent(symbol)}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Unified chart fetch failed (${res.status})`);
  }
  return (await res.json()) as UnifiedChartResponse;
}
