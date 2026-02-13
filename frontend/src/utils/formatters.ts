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

export function formatPct(value?: number | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "-";
  }
  return `${value.toFixed(2)}%`;
}
