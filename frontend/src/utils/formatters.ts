export function formatInr(value?: number | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "-";
  }
  const abs = Math.abs(value);
  if (abs >= 1e7) {
    return `\u20b9 ${(value / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr`;
  }
  if (abs >= 1e5) {
    return `\u20b9 ${(value / 1e5).toLocaleString("en-IN", { maximumFractionDigits: 2 })} L`;
  }
  return `\u20b9 ${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/**
 * Format an amount in its own currency. INR keeps the lakh/crore style of formatInr;
 * other currencies use their Intl symbol ($, £, €…). Unknown currency → plain number.
 */
export function formatMoney(value?: number | null, currency?: string | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "-";
  }
  const ccy = (currency || "").toUpperCase();
  if (ccy === "INR") return formatInr(value);
  if (!/^[A-Z]{3}$/.test(ccy)) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: ccy, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${ccy} ${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
}

/** Short axis label, e.g. "$4.1K" or "INR 2.75L". */
export function formatCompactMoney(value: number, currency?: string | null): string {
  const ccy = (currency || "").toUpperCase();
  const abs = Math.abs(value);
  if (ccy === "INR") {
    if (abs >= 1e7) return `INR ${(value / 1e7).toFixed(2)}Cr`;
    if (abs >= 1e5) return `INR ${(value / 1e5).toFixed(2)}L`;
    if (abs >= 1e3) return `INR ${(value / 1e3).toFixed(1)}K`;
    return `INR ${value.toFixed(0)}`;
  }
  try {
    return new Intl.NumberFormat("en-US", {
      ...(/^[A-Z]{3}$/.test(ccy) ? { style: "currency", currency: ccy } : {}),
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return value.toFixed(0);
  }
}

export function formatPct(value?: number | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "-";
  }
  return `${value.toFixed(2)}%`;
}
