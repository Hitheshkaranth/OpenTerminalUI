export type WorkspaceGroupContext = {
  name: string;
  symbol?: string;
  dateRange?: { from?: string; to?: string };
  currency?: "INR" | "USD";
};
export function validateGroupContext(input: WorkspaceGroupContext): WorkspaceGroupContext {
  const name = String(input.name || "").trim().slice(0, 60);
  if (!name) throw new Error("Name the context group.");
  const dateRange = input.dateRange;
  if (dateRange) {
    for (const date of [dateRange.from, dateRange.to]) if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error("Use valid calendar dates.");
    if (dateRange.from && dateRange.to && dateRange.from > dateRange.to) throw new Error("Start date must be before end date.");
  }
  if (input.currency && input.currency !== "INR" && input.currency !== "USD") throw new Error("Unsupported reporting currency.");
  return { name, symbol: input.symbol?.trim().toUpperCase() || undefined, currency: input.currency, dateRange: dateRange ? { from: dateRange.from || undefined, to: dateRange.to || undefined } : undefined };
}
export function withinDateRange(value: string | number, range?: WorkspaceGroupContext["dateRange"]): boolean {
  if (!range?.from && !range?.to) return true;
  const timestamp = typeof value === "number" ? value * 1000 : Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  return (!range.from || timestamp >= Date.parse(range.from)) && (!range.to || timestamp < Date.parse(range.to) + 86_400_000);
}
