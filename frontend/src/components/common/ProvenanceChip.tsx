import { TerminalBadge } from "../terminal/TerminalBadge";
import type { Provenance } from "../../types";

export function ProvenanceChip({ provenance, compact }: { provenance?: Provenance | null; compact?: boolean }) {
  if (!provenance) return null;

  const { quality, source, note, as_of, latency_ms } = provenance;

  let variant: "live" | "info" | "neutral" | "mock" | "warn" = "neutral";
  let text: string;

  if (quality === "live") {
    variant = "live";
    text = "LIVE";
  } else if (quality === "delayed") {
    variant = "info";
    text = "DELAYED";
  } else if (quality === "cached") {
    variant = "neutral";
    text = "CACHED";
  } else if (quality === "synthetic") {
    variant = "mock";
    text = "SYNTHETIC";
  } else if (quality === "unavailable") {
    variant = "warn";
    text = "NO DATA";
  } else {
    return null;
  }

  const upperSource = source.toUpperCase();
  const label = compact ? text : `${text} \u00B7 ${upperSource}`;

  const tooltipParts: string[] = [];
  if (note) tooltipParts.push(note);
  if (as_of) tooltipParts.push(`as of ${as_of}`);
  if (latency_ms != null) tooltipParts.push(`${latency_ms}ms`);
  const title = tooltipParts.join(" \u00B7 ").trim();

  return (
    <TerminalBadge
      variant={variant}
      dot
      data-testid="provenance-chip"
      data-quality={quality}
      title={title}
    >
      {label}
    </TerminalBadge>
  );
}