import { useEffect, useMemo, useState } from "react";

import { searchMutualFunds } from "../../api/client";
import type { MutualFund } from "../../types";

type Props = {
  onSelect: (fund: MutualFund) => void;
};

const CATEGORIES = ["Large Cap", "Mid Cap", "Small Cap", "ELSS", "Flexi Cap", "Index Fund", "Debt"];

export function MutualFundSearch({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<MutualFund[]>([]);
  const canSearch = query.trim().length >= 2;

  useEffect(() => {
    const handle = setTimeout(async () => {
      if (!canSearch) {
        setRows([]);
        return;
      }
      setLoading(true);
      try {
        setRows(await searchMutualFunds(query.trim(), category || undefined));
      } catch {
        setRows([]);
      } finally {
        setLoading(false);
      }
    }, 280);
    return () => clearTimeout(handle);
  }, [canSearch, category, query]);

  const shown = useMemo(() => rows.slice(0, 50), [rows]);

  return (
    <div className="space-y-2">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-xs uppercase tracking-wide text-terminal-muted">Mutual Fund Search</div>
        <input
          className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-sm outline-none focus:border-terminal-accent"
          placeholder="Search scheme name or code"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap gap-1">
          <button
            className={`rounded border px-2 py-0.5 text-[11px] ${category ? "border-terminal-border text-terminal-muted" : "border-terminal-accent text-terminal-accent"}`}
            onClick={() => setCategory("")}
          >
            All
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={`rounded border px-2 py-0.5 text-[11px] ${
                category === cat ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"
              }`}
              onClick={() => setCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded border border-terminal-border bg-terminal-panel p-2">
        {loading && <div className="text-xs text-terminal-muted">Searching funds...</div>}
        {!loading && !shown.length && <div className="text-xs text-terminal-muted">Type at least 2 characters to search.</div>}
        {!loading && shown.length > 0 && (
          <div className="max-h-80 overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="text-terminal-muted">
                <tr className="border-b border-terminal-border">
                  <th className="py-1 text-left">Scheme</th>
                  <th className="py-1 text-left">Fund House</th>
                  <th className="py-1 text-right">NAV</th>
                  <th className="py-1 text-right">1Y</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr
                    key={row.scheme_code}
                    className="cursor-pointer border-b border-terminal-border/40 hover:bg-terminal-bg/60"
                    onClick={() => onSelect(row)}
                  >
                    <td className="py-1">{row.scheme_name}</td>
                    <td className="py-1 text-terminal-muted">{row.fund_house || "-"}</td>
                    <td className="py-1 text-right">{Number(row.nav).toFixed(2)}</td>
                    <td className={`py-1 text-right ${(row.returns_1y ?? 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                      {row.returns_1y == null ? "-" : `${row.returns_1y.toFixed(2)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
