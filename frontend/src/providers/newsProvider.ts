import { fetchMarketNews, fetchSymbolNews, type NewsApiItem } from "../api/client";

export type NewsItem = {
  id: string;
  symbol?: string;
  source: string;
  headline: string;
  summary?: string;
  publishedAt: string;
  url: string;
};

type NewsParams = {
  market: string;
  limit?: number;
};

type SymbolNewsParams = NewsParams & {
  symbol: string;
};

function toNewsItem(row: NewsApiItem): NewsItem {
  const symbol = "";
  const headline = String(row.title || "").trim();
  return {
    id: String(row.id || `${headline}-${row.publishedAt}`),
    symbol: symbol || undefined,
    source: String(row.source || "News"),
    headline,
    summary: row.summary || undefined,
    publishedAt: row.publishedAt,
    url: row.url,
  };
}

export async function getMarketNews({ market, limit = 20 }: NewsParams): Promise<NewsItem[]> {
  const rows = await fetchMarketNews(market, limit);
  return rows
    .map(toNewsItem)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, limit);
}

export async function getSymbolNews({ symbol, market, limit = 20 }: SymbolNewsParams): Promise<NewsItem[]> {
  const rows = await fetchSymbolNews(market, symbol, limit);
  return rows
    .map(toNewsItem)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, limit);
}
