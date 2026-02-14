export type CountryCode = "IN" | "US";

export type MarketCode = "NSE" | "BSE" | "NYSE" | "NASDAQ";

export const COUNTRY_MARKETS: Record<CountryCode, MarketCode[]> = {
  IN: ["NSE", "BSE"],
  US: ["NYSE", "NASDAQ"],
};
