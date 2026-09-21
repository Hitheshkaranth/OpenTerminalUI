import { api } from "./base";
import { fetchChartData } from "../services/chartDataService";
import type {
  ChartResponse,
  IndicatorResponse,
  StockSnapshot,
  PriceSeriesResponse,
} from "../types";
import type {
  SearchSymbolItem,
  DepthSnapshotResponse,
  ChartBatchSource,
} from "./types";

export async function getHistory(
  symbol: string,
  market: string,
  interval = "1d",
  range = "1y",
  limit?: number,
  cursor?: number,
  extended?: boolean,
): Promise<ChartResponse> {
  if (!limit && !cursor) {
    try {
      const unified = await fetchChartData(symbol, {
        market,
        interval,
        period: range,
        extended,
      });
      return {
        ticker: symbol.toUpperCase(),
        interval,
        currency: market.toUpperCase() === "NSE" || market.toUpperCase() === "BSE" ? "INR" : "USD",
        data: (Array.isArray(unified.data) ? unified.data : []).map((row) => ({
          t: Math.floor(Number(row.t) / 1000),
          o: Number(row.o),
          h: Number(row.h),
          l: Number(row.l),
          c: Number(row.c),
          v: Number(row.v ?? 0),
          s: row.s,
          ext: row.ext,
        })),
        meta: { warnings: [] },
      } as ChartResponse;
    } catch {
      // Fall back to legacy endpoint below.
    }
  }
  const { data } = await api.get<ChartResponse>(`/chart/${symbol}`, {
    params: { market, interval, range, limit, cursor, extended }
  });
  return data;
}

export async function fetchIndicator(
  ticker: string,
  type: string,
  interval = "1d",
  range = "1y",
  params: Record<string, number> = {}
): Promise<IndicatorResponse> {
  const { data } = await api.get<IndicatorResponse>(`/chart/${ticker}/indicators`, {
    params: { type, interval, range, ...params },
  });
  return data;
}

export async function getQuote(symbol: string, market: string): Promise<StockSnapshot> {
  const { data } = await api.get<StockSnapshot>(`/stocks/${symbol}`, { params: { market } });
  return data;
}

export async function fetchPriceSeries(
  symbol: string,
  opts?: { adjusted?: boolean; start?: string; end?: string; data_version_id?: string },
): Promise<PriceSeriesResponse> {
  const { data } = await api.get<PriceSeriesResponse>(`/prices/${encodeURIComponent(symbol)}`, { params: opts });
  return data;
}

export async function searchSymbols(q: string, market: string): Promise<SearchSymbolItem[]> {
  const { data } = await api.get<{ results: SearchSymbolItem[] }>("/search", { params: { q, market } });
  return data.results;
}

export async function fetchChart(ticker: string, interval = "1d", range = "1y", market = "NSE"): Promise<ChartResponse> {
  return getHistory(ticker, market, interval, range);
}

export async function fetchChartsBatchWithMeta(
  items: Array<{ symbol: string; interval?: string; range?: string; market?: string; extended?: boolean }>,
): Promise<{ data: Record<string, ChartResponse>; source: ChartBatchSource }> {
  const normalized = items
    .map((item) => ({
      symbol: item.symbol.trim().toUpperCase(),
      interval: item.interval ?? "1d",
      range: item.range ?? "1y",
      market: (item.market ?? "NSE").trim().toUpperCase(),
      extended: !!item.extended,
    }))
    .filter((item) => Boolean(item.symbol));
  if (!normalized.length) return { data: {}, source: "batch" };

  try {
    const { data } = await api.post<Record<string, ChartResponse>>("/charts/batch", {
      tickers: normalized.map((item) => ({
        symbol: item.symbol,
        timeframe: item.interval,
        market: item.market,
        range: item.range,
        extended: item.extended,
      })),
    });
    if (data && typeof data === "object") {
      return { data, source: "batch" };
    }
  } catch {
    // Fallback to parallel legacy chart requests below.
  }

  const entries = await Promise.all(
    normalized.map(async (item) => {
      const res = await fetchChart(item.symbol, item.interval, item.range, item.market);
      const key = `${item.market}:${item.symbol}|${item.interval}|${item.range}|ext=${item.extended}`;
      return [key, res] as const;
    }),
  );
  return { data: Object.fromEntries(entries), source: "fallback" };
}

export async function fetchChartsBatch(
  items: Array<{ symbol: string; interval?: string; range?: string; market?: string }>,
): Promise<Record<string, ChartResponse>> {
  const result = await fetchChartsBatchWithMeta(items);
  return result.data;
}

export async function fetchStock(ticker: string, market = "NSE"): Promise<StockSnapshot> {
  return getQuote(ticker, market);
}

export async function searchStocks(q: string, market = "NSE"): Promise<SearchSymbolItem[]> {
  return searchSymbols(q, market);
}

export async function fetchDepth(symbol: string, market = "NSE", levels = 20, refPrice?: number): Promise<DepthSnapshotResponse> {
  const { data } = await api.get<DepthSnapshotResponse>(`/depth/${encodeURIComponent(symbol)}`, {
    params: { market, levels, ...(refPrice && refPrice > 0 ? { ref_price: refPrice } : {}) },
  });
  return data;
}

export async function fetchQuotesBatch(
  symbols: string[],
  market: string,
): Promise<{ market: string; status?: string; quotes: Array<{ symbol: string; last: number; change: number; changePct: number; ts: string }> }> {
  if (!symbols.length) return { market, quotes: [] };
  const tickers = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean).join(",");
  if (!tickers) return { market, quotes: [] };
  const { data } = await api.get<{ market: string; status?: string; quotes: Array<{ symbol: string; last: number; change: number; changePct: number; ts: string }> }>("/quotes", {
    params: { symbols: tickers, market },
  });
  return data;
}
