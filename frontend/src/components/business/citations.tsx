import { BookOpen } from "lucide-react";

import type { Citation } from "../../api/businessResearch";
import { TerminalTooltip } from "../terminal/TerminalTooltip";

export function formatCitation(citation: Citation | null | undefined): string {
  if (!citation) return "";
  const title = citation.title?.trim();
  if (citation.page_start != null && citation.page_end != null && citation.page_start === citation.page_end) {
    return title ? `${title} · p${citation.page_start}` : `p${citation.page_start}`;
  }
  if (citation.page_start != null && citation.page_end != null) {
    return title ? `${title} · p${citation.page_start}-${citation.page_end}` : `p${citation.page_start}-${citation.page_end}`;
  }
  if (citation.page_start != null) {
    return title ? `${title} · p${citation.page_start}` : `p${citation.page_start}`;
  }
  return title || "";
}

export function CitationHint({ citation, className = "" }: { citation: Citation | null; className?: string }) {
  const label = formatCitation(citation);
  if (!label) {
    return <span className={`inline-block cursor-default ${className}`.trim()} aria-label="No citation source" />;
  }
  return (
    <TerminalTooltip content={label} className={className}>
      <BookOpen className="inline-block h-3 w-3 shrink-0 text-terminal-muted hover:text-terminal-text" aria-label={`Source: ${label}`} />
    </TerminalTooltip>
  );
}