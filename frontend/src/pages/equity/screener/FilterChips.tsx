import { useMemo } from "react";

import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useScreenerContext } from "./ScreenerContext";

export function FilterChips() {
  const { query } = useScreenerContext();
  const chips = useMemo(() => query.split(/\bAND\b/i).map((piece) => piece.trim()).filter(Boolean), [query]);

  return (
    <TerminalPanel title="Active Filters" subtitle={`${chips.length} clauses`}>
      <div className="flex flex-wrap gap-1">
        {chips.map((chip, idx) => (
          <span key={`${chip}-${idx}`} className="inline-flex items-center rounded-sm border border-terminal-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-terminal-muted">
            {chip}
          </span>
        ))}
      </div>
    </TerminalPanel>
  );
}
