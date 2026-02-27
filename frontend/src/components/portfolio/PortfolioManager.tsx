import { useEffect, useMemo, useState } from "react";
import { Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import {
  addPortfolioHolding,
  createPortfolio,
  fetchPortfolioAnalyticsV2,
  fetchPortfolioHoldings,
  fetchPortfolios,
  type MultiPortfolio,
  type MultiPortfolioAnalytics,
  type MultiPortfolioHolding,
} from "../../api/client";
import { DenseTable } from "../terminal/DenseTable";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";

const BENCHMARKS = ["NIFTY50", "S&P500", "NASDAQ", "DOW", "MSCIWI"];

function metricFmt(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "-";
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function PortfolioManager() {
  const [portfolios, setPortfolios] = useState<MultiPortfolio[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [holdings, setHoldings] = useState<MultiPortfolioHolding[]>([]);
  const [analytics, setAnalytics] = useState<MultiPortfolioAnalytics | null>(null);
  const [loading, setLoading] = useState(false);

  const [newName, setNewName] = useState("Core Portfolio");
  const [newBenchmark, setNewBenchmark] = useState(BENCHMARKS[0]);
  const [newCash, setNewCash] = useState(100000);

  const [addSymbol, setAddSymbol] = useState("AAPL");
  const [addShares, setAddShares] = useState(10);
  const [addCost, setAddCost] = useState(100);
  const [addDate, setAddDate] = useState(new Date().toISOString().slice(0, 10));

  const loadAll = async (nextId?: string) => {
    setLoading(true);
    try {
      const pfs = await fetchPortfolios();
      setPortfolios(pfs);
      const activeId = nextId || selectedId || pfs[0]?.id || "";
      if (activeId) {
        setSelectedId(activeId);
        const [h, a] = await Promise.all([fetchPortfolioHoldings(activeId), fetchPortfolioAnalyticsV2(activeId)]);
        setHoldings(h);
        setAnalytics(a);
      } else {
        setHoldings([]);
        setAnalytics(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const perfSeries = useMemo(() => {
    if (!holdings.length) return [];
    let cumulative = 100;
    return holdings.map((h, idx) => {
      const current = Number(h.current_price || h.cost_basis_per_share || 0);
      const ret = h.cost_basis_per_share > 0 ? (current - h.cost_basis_per_share) / h.cost_basis_per_share : 0;
      cumulative *= 1 + ret / Math.max(1, holdings.length);
      return { i: idx + 1, value: cumulative };
    });
  }, [holdings]);

  return (
    <div className="grid gap-3 xl:grid-cols-[240px_1fr]">
      <aside className="rounded border border-terminal-border bg-terminal-panel p-2">
        <div className="mb-2 text-xs font-semibold text-terminal-accent">Portfolios</div>
        <div className="space-y-1">
          {portfolios.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`w-full rounded border px-2 py-1 text-left text-xs ${selectedId === p.id ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent" : "border-terminal-border text-terminal-text"}`}
              onClick={() => void loadAll(p.id)}
            >
              <div>{p.name}</div>
              <div className="text-[10px] text-terminal-muted">{metricFmt(p.total_value)}</div>
            </button>
          ))}
        </div>
        <div className="mt-3 space-y-1 border-t border-terminal-border pt-2">
          <TerminalInput value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Portfolio name" />
          <select className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={newBenchmark} onChange={(e) => setNewBenchmark(e.target.value)}>
            {BENCHMARKS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <TerminalInput type="number" value={newCash} onChange={(e) => setNewCash(Number(e.target.value) || 0)} placeholder="Starting cash" />
          <TerminalButton
            variant="accent"
            onClick={async () => {
              const created = await createPortfolio({ name: newName, benchmark_symbol: newBenchmark, starting_cash: newCash });
              await loadAll(created.id);
            }}
          >
            Add Portfolio
          </TerminalButton>
        </div>
      </aside>

      <section className="space-y-2">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div className="rounded border border-terminal-border bg-terminal-panel p-2 text-xs"><div className="text-terminal-muted">Total Value</div><div className="text-terminal-text">{metricFmt(analytics?.total_value)}</div></div>
          <div className="rounded border border-terminal-border bg-terminal-panel p-2 text-xs"><div className="text-terminal-muted">Day P&L</div><div className={Number(analytics?.day_change || 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{metricFmt(analytics?.day_change)} ({metricFmt(analytics?.day_change_pct)}%)</div></div>
          <div className="rounded border border-terminal-border bg-terminal-panel p-2 text-xs"><div className="text-terminal-muted">Total P&L</div><div className={Number(analytics?.unrealized_pnl || 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{metricFmt(analytics?.unrealized_pnl)} ({metricFmt(analytics?.unrealized_pnl_pct)}%)</div></div>
          <div className="rounded border border-terminal-border bg-terminal-panel p-2 text-xs"><div className="text-terminal-muted">Sharpe</div><div className="text-terminal-text">{metricFmt(analytics?.sharpe_ratio)}</div></div>
        </div>

        <div className="rounded border border-terminal-border bg-terminal-panel p-2">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-terminal-muted">Add Holding</span>
            <TerminalInput className="w-24" value={addSymbol} onChange={(e) => setAddSymbol(e.target.value.toUpperCase())} />
            <TerminalInput className="w-20" type="number" value={addShares} onChange={(e) => setAddShares(Number(e.target.value) || 0)} />
            <TerminalInput className="w-24" type="number" value={addCost} onChange={(e) => setAddCost(Number(e.target.value) || 0)} />
            <TerminalInput className="w-32" type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} />
            <TerminalButton
              variant="default"
              onClick={async () => {
                if (!selectedId) return;
                await addPortfolioHolding(selectedId, { symbol: addSymbol, shares: addShares, cost_basis_per_share: addCost, purchase_date: addDate });
                await loadAll(selectedId);
              }}
            >
              Add
            </TerminalButton>
            {loading ? <span className="text-terminal-muted">Loading...</span> : null}
          </div>
          <DenseTable
            id="portfolio-manager-holdings"
            rows={holdings}
            rowKey={(row) => row.id}
            height={260}
            columns={[
              { key: "symbol", title: "Symbol", type: "text", frozen: true, width: 100, sortable: true, getValue: (r) => r.symbol },
              { key: "shares", title: "Shares", type: "number", align: "right", sortable: true, getValue: (r) => r.shares },
              { key: "avgCost", title: "Avg Cost", type: "currency", align: "right", sortable: true, getValue: (r) => r.cost_basis_per_share },
              { key: "current", title: "Current", type: "currency", align: "right", sortable: true, getValue: (r) => r.current_price || 0 },
              { key: "value", title: "Market Value", type: "large-number", align: "right", sortable: true, getValue: (r) => (r.current_price || 0) * r.shares },
              { key: "pnl", title: "P&L", type: "large-number", align: "right", sortable: true, getValue: (r) => ((r.current_price || 0) - r.cost_basis_per_share) * r.shares },
              { key: "pnlPct", title: "P&L%", type: "percent", align: "right", sortable: true, getValue: (r) => (r.cost_basis_per_share > 0 ? (((r.current_price || 0) - r.cost_basis_per_share) / r.cost_basis_per_share) * 100 : 0) },
            ]}
          />
        </div>

        <div className="grid gap-2 xl:grid-cols-2">
          <div className="rounded border border-terminal-border bg-terminal-panel p-2">
            <div className="mb-1 text-xs text-terminal-muted">Allocation by Sector</div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={analytics?.allocation_by_sector || []} dataKey="value" nameKey="name" outerRadius={70} fill="#FF6B00" />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded border border-terminal-border bg-terminal-panel p-2">
            <div className="mb-1 text-xs text-terminal-muted">Performance vs Benchmark</div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={perfSeries}>
                  <Line dataKey="value" stroke="#FF6B00" dot={false} strokeWidth={2} />
                  <Tooltip />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
