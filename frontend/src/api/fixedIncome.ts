import { api } from "./base";
import type {
  BondScreenerItem,
  CreditSpreadPoint,
  RatingsMigrationItem,
  YieldCurveResponse,
  SpreadHistoryResponse,
} from "../types";

export async function fetchBondScreener(rating?: string, issuerType?: string): Promise<BondScreenerItem[]> {
  const { data } = await api.get<{ items: BondScreenerItem[] }>("/fixed-income/screener", { params: { rating, issuer_type: issuerType } });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchCreditSpreads(): Promise<{ history: CreditSpreadPoint[] }> {
  const { data } = await api.get<{ history: CreditSpreadPoint[] }>("/fixed-income/credit-spreads");
  return data;
}

export async function fetchBondRatingsMigration(): Promise<RatingsMigrationItem[]> {
  const { data } = await api.get<{ items: RatingsMigrationItem[] }>("/fixed-income/ratings-migration");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchYieldCurve(country = "IN"): Promise<YieldCurveResponse> {
  const { data } = await api.get<YieldCurveResponse>("/fixed-income/yield-curve", { params: { country } });
  return data;
}

export async function fetchHistoricalYieldCurve(date: string): Promise<YieldCurveResponse> {
  const { data } = await api.get<YieldCurveResponse>("/fixed-income/yield-curve/historical", { params: { date } });
  return data;
}

export async function fetch2s10sHistory(): Promise<SpreadHistoryResponse> {
  const { data } = await api.get<SpreadHistoryResponse>("/fixed-income/2s10s-spread-history");
  return data;
}

export async function fetchSpreadHistory(assetA: string, assetB: string, days = 90): Promise<SpreadHistoryResponse> {
  const { data } = await api.get<SpreadHistoryResponse>("/fixed-income/spread-history", {
    params: { asset_a: assetA, asset_b: assetB, days },
  });
  return data;
}
