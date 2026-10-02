export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatShort(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(value / 1e3).toFixed(2)}K`;
  return `${sign}${value.toFixed(2)}`;
}

// Values are TerminalBadge variants.
export function scorecardVariant(label: string): "success" | "danger" | "warn" | "accent" | "neutral" {
  switch (label) {
    case "strong":
      return "success";
    case "weak":
      return "danger";
    case "mixed":
      return "accent";
    case "steady":
      return "accent";
    default:
      return "neutral";
  }
}

export function scorecardLabel(label: string): string {
  return label.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function colorClassFor(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "text-terminal-muted";
  if (value > 0) return "text-terminal-pos";
  if (value < 0) return "text-terminal-neg";
  return "text-terminal-warn";
}