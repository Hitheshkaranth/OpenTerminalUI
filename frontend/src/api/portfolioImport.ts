import { api } from "./base";

export type ImportRow = {
  ticker: string;
  quantity: number;
  avg_buy_price: number;
  buy_date: string | null;
  exchange: string | null;
};

export type ImportRequest = {
  source: "csv" | "kite" | "manual";
  mode: "append" | "replace";
  rows: ImportRow[];
};

export type ImportResponse = {
  imported: number;
  skipped: number;
  mode: "append" | "replace";
  errors: Array<{ row: number; ticker: string | null; reason: string }>;
};

export type KiteHolding = {
  symbol: string;
  exchange: "NSE" | "BSE";
  isin: string | null;
  quantity: number;
  average_price: number;
  last_price: number | null;
  pnl: number | null;
  product: string | null;
};

export type KiteHoldingsResponse = {
  source: "kite";
  fetched_at: string;
  holdings: KiteHolding[];
};

export async function importPortfolio(body: ImportRequest): Promise<ImportResponse> {
  const { data } = await api.post<ImportResponse>("/portfolio/import", body);
  return data;
}

export async function fetchKiteHoldings(): Promise<KiteHoldingsResponse> {
  const { data } = await api.get<KiteHoldingsResponse>("/kite/holdings");
  return data;
}

export function kiteHoldingsToImportRows(h: KiteHolding[]): ImportRow[] {
  return h.map((holding) => ({
    ticker: holding.symbol.toUpperCase(),
    quantity: holding.quantity,
    avg_buy_price: holding.average_price,
    buy_date: null,
    exchange: holding.exchange,
  }));
}