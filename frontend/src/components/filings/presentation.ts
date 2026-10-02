import type {
  Citation,
  DocSource,
  Finding,
  GuidanceItem,
  ManagementTone,
  Stance,
} from "../../api/filingsRag";

// Pure presentational helpers shared across the filings components.
// Keeping them side-effect free makes the null-safe rendering rules obvious
// and easy to unit-test.

export function formatCitationLabel(citation: Citation | null | undefined): string {
  if (!citation) return "—";
  const title = citation.title || "document";
  let label = title;
  const start = Number(citation.page_start);
  const end = Number(citation.page_end);
  if (Number.isFinite(start) && start > 0) {
    label += ` · p.${start === end ? start : `${start}–${end}`}`;
  }
  if (citation.section) label += ` · ${citation.section}`;
  return label;
}

export function formatDriverValue(finding: Finding): string {
  const bits: string[] = [];
  if (finding.value != null && Number.isFinite(finding.value)) {
    bits.push(finding.value.toLocaleString("en-US", { maximumFractionDigits: 2 }));
  }
  if (finding.unit) bits.push(finding.unit);
  const valuePart = bits.join(" ");
  const chips = [valuePart, finding.period].filter(Boolean);
  return chips.length ? chips.join(" · ") : "—";
}

export function formatCitationTitle(citation: Citation | null | undefined): string {
  if (!citation) return "—";
  const title = citation.title || "document";
  const start = Number(citation.page_start);
  const end = Number(citation.page_end);
  if (Number.isFinite(start) && start > 0 && end > 0) {
    return `${title} · p.${start === end ? start : `${start}–${end}`}`;
  }
  if (Number.isFinite(start) && start > 0) return `${title} · p.${start}`;
  return title;
}

export function formatPeriod(value: string | null | undefined): string {
  return value ? String(value) : "—";
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function strengthPct(strength: number | null | undefined): number {
  const n = Number.isFinite(Number(strength)) ? Number(strength) : 0;
  return Math.max(0, Math.min(100, n));
}

const STANCE_LABEL: Record<Stance, string> = {
  constructive: "Constructive",
  balanced: "Balanced",
  cautious: "Cautious",
  insufficient_evidence: "Insufficient Evidence",
};

export function stanceLabel(stance: Stance | null | undefined): string {
  if (!stance) return "Balanced";
  return STANCE_LABEL[stance] ?? String(stance);
}

export function stanceVariant(stance: Stance | null | undefined): "success" | "neutral" | "danger" {
  if (!stance) return "neutral";
  return stance === "constructive" ? "success" : stance === "cautious" ? "danger" : "neutral";
}

const STATUS_LABEL: Record<GuidanceItem["status"], string> = {
  new: "New",
  reiterated: "Reiterated",
  raised: "Raised",
  lowered: "Lowered",
  met: "Met",
  missed: "Missed",
  unknown: "Unknown",
};

export function statusLabel(status: GuidanceItem["status"] | null | undefined): string {
  if (!status) return "Unknown";
  return STATUS_LABEL[status] ?? String(status);
}

export function statusVariant(status: GuidanceItem["status"] | null | undefined): "success" | "neutral" | "danger" {
  if (!status) return "neutral";
  if (status === "raised" || status === "met") return "success";
  if (status === "lowered" || status === "missed") return "danger";
  return "neutral";
}

const TONE_LABEL: Record<ManagementTone, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
};

export function toneLabel(tone: ManagementTone | null | undefined): string {
  if (!tone) return "Neutral";
  return TONE_LABEL[tone] ?? String(tone);
}

export function toneVariant(tone: ManagementTone | null | undefined): "success" | "neutral" | "danger" {
  if (!tone) return "neutral";
  return tone === "positive" ? "success" : tone === "negative" ? "danger" : "neutral";
}

export function docSourceLabel(source: DocSource | null | undefined): string {
  return source ? String(source).toUpperCase() : "—";
}

export function formatKeyNumber(label: string | null | undefined, value: number | null | undefined, unit: string | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const amount = value == null ? NaN : Number(value);
  const text = amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return unit ? `${text} ${unit}` : text;
}