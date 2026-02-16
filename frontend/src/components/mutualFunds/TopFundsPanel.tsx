import { useEffect, useState } from "react";

import { fetchTopMutualFunds } from "../../api/client";
import type { MutualFund, MutualFundPerformance } from "../../types";

type Props = {
  onSelectFund: (fund: MutualFund) => void;
};

const CATEGORIES = ["Large Cap", "Mid Cap", "Small Cap", "ELSS", "Flexi Cap", "Index Fund"];
const SORT_KEYS = ["returns_1m", "returns_3m", "returns_6m", "returns_1y", "returns_3y", "returns_5y"] as const;

export function TopFundsPanel({ onSelectFund }: Props) {
  const [category, setCategory] = useState("Large Cap");
  const [sortBy, setSortBy] = useState<(typeof SORT_KEYS)[number]>("returns_1y");
  const [rows, setRows] = useState<MutualFundPerformance[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setLoading(true);
      try {
        const out = await fetchTopMutualFunds(category, sortBy, 20);
        if (alive) setRows(out);
      } catch {
        if (alive) setRows([]);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [category, sortBy]);

  return (
    <div className="space-y-2 rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="flex flex-wrap gap-1">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={`rounded border px-2 py-0.5 text-[11px] ${category === cat ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
            onClick={() => setCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {SORT_KEYS.map((key) => (
          <button
            key={key}
            className={`rounded border px-2 py-0.5 text-[11px] ${sortBy === key ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
            onClick={() => setSortBy(key)}
          >
            {key.replace("returns_", "").toUpperCase()}
          </button>
        ))}
      </div>
      {loading && <div className="text-xs text-terminal-muted">Loading top funds...</div>}
      {!loading && (
        <div className="max-h-80 overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="text-terminal-muted">
              <tr className="border-b border-terminal-border">
                <th className="py-1 text-left">Fund</th>
                <th className="py-1 text-right">1M</th>
                <th className="py-1 text-right">3M</th>
                <th className="py-1 text-right">6M</th>
                <th className="py-1 text-right">1Y</th>
                <th className="py-1 text-right">3Y</th>
                <th className="py-1 text-right">5Y</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.scheme_code}
                  className="cursor-pointer border-b border-terminal-border/40 hover:bg-terminal-bg/60"
                  onClick={() =>
                    onSelectFund({
                      scheme_code: row.scheme_code,
                      scheme_name: row.scheme_name,
                      fund_house: row.fund_house,
                      scheme_category: row.category,
                      scheme_sub_category: row.category,
                      scheme_type: "Open Ended Schemes",
                      nav: row.current_nav,
                      nav_date: "",
                      isin_growth: null,
                      isin_div_payout: null,
                    })
                  }
                >
                  <td className="py-1">{row.scheme_name}</td>
                  <td className={`py-1 text-right ${(row.returns_1m ?? 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{row.returns_1m == null ? "-" : `${row.returns_1m.toFixed(2)}%`}</td>
                  <td className={`py-1 text-right ${(row.returns_3m ?? 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{row.returns_3m == null ? "-" : `${row.returns_3m.toFixed(2)}%`}</td>
                  <td className={`py-1 text-right ${(row.returns_6m ?? 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{row.returns_6m == null ? "-" : `${row.returns_6m.toFixed(2)}%`}</td>
                  <td className={`py-1 text-right ${(row.returns_1y ?? 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{row.returns_1y == null ? "-" : `${row.returns_1y.toFixed(2)}%`}</td>
                  <td className={`py-1 text-right ${(row.returns_3y ?? 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{row.returns_3y == null ? "-" : `${row.returns_3y.toFixed(2)}%`}</td>
                  <td className={`py-1 text-right ${(row.returns_5y ?? 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{row.returns_5y == null ? "-" : `${row.returns_5y.toFixed(2)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
