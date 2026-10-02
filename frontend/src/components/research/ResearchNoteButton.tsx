// OWNER: agent P (swarm fi_v1). One-click research note export, rendered next
// to "EXPORT REPORT" in the Security Hub header. The TerminalDropdown trigger is
// the "Research note" button; the menu offers the two export formats. Export
// name + props are part of the shared contract, so keep them.
import { useCallback, useEffect, useState } from "react";

import { TerminalDropdown } from "../terminal/TerminalDropdown";
import { extractApiErrorMessage } from "../../api/base";
import {
  downloadMarkdown,
  gatherResearchData,
  openPrintWindow,
  type ResearchNoteData,
} from "../../api/researchNote";

export type ResearchNoteButtonProps = { symbol: string; market?: string };

type Phase = "idle" | "loading" | "ready" | "error";

const exportItems = [
  { id: "markdown", label: "Markdown (.md)" },
  { id: "print", label: "Print-ready HTML" },
];

export function ResearchNoteButton({ symbol, market = "NSE" }: ResearchNoteButtonProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [data, setData] = useState<ResearchNoteData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setData(null);
    setError(null);
    gatherResearchData(symbol, market)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setPhase("ready");
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(extractApiErrorMessage(err, "Could not build research note"));
          setPhase("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, market]);

  const onMarkdown = useCallback(() => {
    if (!data) return;
    downloadMarkdown(symbol, data);
  }, [data, symbol]);

  const onPrint = useCallback(() => {
    if (!data) return;
    openPrintWindow(data);
  }, [data]);

  const onItemSelect = (id: string) => {
    if (id === "markdown") onMarkdown();
    else onPrint();
  };

  const label =
    phase === "loading"
      ? "Loading…"
      : phase === "error"
        ? "Failed"
        : "Research note";

  return (
    <div className="relative inline-flex flex-col items-start">
      <TerminalDropdown
        aria-label={`Export research note for ${symbol}`}
        label={label}
        items={exportItems}
        onSelect={onItemSelect}
        size="md"
        variant={phase === "ready" ? "accent" : "default"}
        disabled={phase === "loading"}
        loading={phase === "loading"}
      />
      {phase === "error" && error ? (
        <span role="status" aria-live="polite" className="mt-1 max-w-[14rem] break-all text-[10px] text-terminal-muted">
          {error}
        </span>
      ) : null}
    </div>
  );
}