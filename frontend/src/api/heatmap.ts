import axios from "axios";

const heatmapApi = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  timeout: 30000,
});

export type HeatmapGroupBy = "sector" | "industry";
export type HeatmapPeriod = "1d" | "1w" | "1m" | "3m" | "ytd" | "1y";
export type HeatmapSizeBy = "market_cap" | "volume" | "turnover";
export type HeatmapMarket = "IN" | "US";

export type HeatmapLeaf = {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  market_cap: number;
  price: number;
  change_pct: number;
  volume: number;
  turnover: number;
  value: number;
};

export type HeatmapGroup = {
  name: string;
  group_by: HeatmapGroupBy;
  size_metric: HeatmapSizeBy;
  value: number;
  children: HeatmapLeaf[];
};

export type HeatmapTreemapResponse = {
  market: HeatmapMarket;
  group: HeatmapGroupBy;
  period: HeatmapPeriod;
  size_by: HeatmapSizeBy;
  total_value: number;
  data: HeatmapLeaf[];
  groups: HeatmapGroup[];
};

export async function fetchMarketHeatmap(params: {
  market: HeatmapMarket;
  group: HeatmapGroupBy;
  period: HeatmapPeriod;
  sizeBy: HeatmapSizeBy;
}): Promise<HeatmapTreemapResponse> {
  const { data } = await heatmapApi.get<HeatmapTreemapResponse>("/heatmap/treemap", {
    params: {
      market: params.market,
      group: params.group,
      period: params.period,
      size_by: params.sizeBy,
    },
  });
  return data;
}
