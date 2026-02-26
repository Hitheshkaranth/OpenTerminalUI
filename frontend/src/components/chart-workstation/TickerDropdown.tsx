import { useEffect, useRef, useState } from "react";
import { searchSymbols, type SearchSymbolItem } from "../../api/client";
import { TerminalBadge } from "../terminal/TerminalBadge";
import { TerminalCombobox } from "../terminal/TerminalCombobox";
import "./ChartWorkstation.css";

interface Props {
  value: string | null;
  market: "IN" | "US";
  onChange: (ticker: string, market: "IN" | "US") => void;
  className?: string;
}

export function TickerDropdown({ value, market, onChange, className = "" }: Props) {
  const [query, setQuery] = useState(value ?? "");
  const [results, setResults] = useState<SearchSymbolItem[]>([]);
  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value ?? "");
  }, [value]);

  const search = (q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!q.trim()) {
        setResults([]);
        setOpen(false);
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const apiMarket = market === "IN" ? "NSE" : "NASDAQ";
        const r = await searchSymbols(q, apiMarket);
        setResults(r.slice(0, 8));
        setSelectedIdx(0);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  };

  const pick = (item: SearchSymbolItem) => {
    const resolvedMarket: "IN" | "US" = item.country_code === "US" ? "US" : "IN";
    onChange(item.ticker, resolvedMarket);
    setQuery(item.ticker);
    setOpen(false);
    setResults([]);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIdx]) {
      pick(results[selectedIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <div ref={containerRef} className={`ticker-dropdown ${className}`.trim()}>
      <TerminalCombobox
        className=""
        inputClassName={`w-24 min-h-7 px-1 py-0.5 text-[11px] ${loading ? "cursor-wait" : ""}`.trim()}
        listClassName="ticker-dropdown-results"
        itemClassName=""
        value={query}
        placeholder="Search..."
        onChange={(nextValue) => {
          setQuery(nextValue);
          search(nextValue);
        }}
        onFocus={() => query && setOpen(true)}
        onKeyDown={handleKey}
        loading={loading}
        data-testid="ticker-search-input"
        open={open}
        items={results}
        selectedIndex={selectedIdx}
        getItemKey={(item) => item.ticker}
        onSelect={pick}
        renderItem={(item, meta) => (
          <div className={`ticker-dropdown-item ${meta.selected ? "selected" : ""}`}>
            <span className="inline-flex min-w-0 items-center gap-2">
              <span>{item.ticker}</span>
              <TerminalBadge
                variant={item.country_code === "US" ? "info" : "neutral"}
                size="sm"
                className="shrink-0"
              >
                {item.country_code === "US" ? "US" : "IN"}
              </TerminalBadge>
            </span>
            <span className="truncate text-[10px] opacity-60">{(item.name ?? "").slice(0, 20)}</span>
          </div>
        )}
      />
    </div>
  );
}
