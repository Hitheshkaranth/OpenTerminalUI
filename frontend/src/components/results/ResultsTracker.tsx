import { useState } from "react";
import { Search } from "lucide-react";

import { TerminalPanel } from "../terminal/TerminalPanel";
import { TerminalTabs } from "../terminal/TerminalTabs";
import { useSettingsStore } from "../../store/settingsStore";
import { ResultsLatest } from "./ResultsLatest";
import { ResultsHistory } from "./ResultsHistory";

type View = "latest" | "history";

export function ResultsTracker() {
  // Desk market is an exchange code ("NSE", "BSE", "NASDAQ", …), never "IN"; comparing to "IN"
  // always fell through to US results for Indian users.
  const market = useSettingsStore((s) => (s.selectedMarket === "NSE" || s.selectedMarket === "BSE" ? "IN" : "US"));
  const [view, setView] = useState<View>("latest");
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const openHistory = (symbol: string) => {
    setSelected(symbol);
    setView("history");
  };

  const submit = (raw: string) => {
    const next = raw.trim().toUpperCase();
    if (!next) return;
    setSelected(next);
    setView("history");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TerminalTabs
          tabs={[
            { id: "latest", label: "Latest reported", icon: null, badge: undefined },
            { id: "history", label: "Quarterly history", icon: null, badge: undefined },
          ]}
          value={view}
          onChange={(id) => setView(id as View)}
          size="sm"
          fullWidth
        />
        <div className="relative w-56 sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-terminal-muted" aria-hidden="true" />
          <input
            className="h-8 w-full rounded-sm border border-terminal-border bg-terminal-bg pl-8 pr-7 font-sans text-xs text-terminal-text outline-none transition-colors placeholder:text-terminal-muted focus:border-terminal-accent"
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit(query);
            }}
            placeholder="Search symbol…"
            aria-label="Search symbol for history"
          />
        </div>
      </div>

      {view === "latest" ? (
        <ResultsLatest market={market} onOpen={openHistory} selectedSymbol={selected} />
      ) : null}

      {view === "history" && selected ? (
        <ResultsHistory symbol={selected} />
      ) : view === "history" ? (
        <TerminalPanel
          title="Select a symbol"
          subtitle="Search above to open quarterly results."
          className="w-full"
        >
          <div className="flex h-24 items-center justify-center rounded-sm border border-terminal-border bg-terminal-bg text-xs text-terminal-muted">
            Enter a symbol to view its quarterly history.
          </div>
        </TerminalPanel>
      ) : null}
    </div>
  );
}