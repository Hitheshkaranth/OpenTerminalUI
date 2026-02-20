const TICKER_ALIASES: Record<string, string> = {
  APPL: "AAPL",
};

export function normalizeTicker(input: string): string {
  const symbol = (input || "").trim().toUpperCase();
  if (!symbol) return symbol;
  return TICKER_ALIASES[symbol] || symbol;
}
