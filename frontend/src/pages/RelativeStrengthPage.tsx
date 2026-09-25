import { useEffect, useState } from "react";
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, Bar, BarChart } from "recharts";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { TerminalTable } from "../components/terminal/TerminalTable";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { api } from "../api/client";

export function RelativeStrengthPage() {
  const [activeTab, setTab] = useState<"rankings" | "sector" | "chart" | "highs">("rankings");
  const [rankings, setRankings] = useState<any[]>([]);
  const [sectorRS, setSectorRS] = useState<any[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [highs, setHighs] = useState<any[]>([]);
  const [symbol, setSymbol] = useState("RELIANCE");
  const [universe, setUniverse] = useState("Nifty 50");
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === "rankings") {
        const res = await api.get("/rs/rankings", { params: { universe } });
        setRankings(res.data);
      } else if (activeTab === "sector") {
        const res = await api.get("/rs/sector-rs");
        setSectorRS(res.data);
      } else if (activeTab === "chart") {
        const res = await api.get(`/rs/chart/${symbol}`);
        setChartData(res.data);
      } else if (activeTab === "highs") {
        const res = await api.get("/rs/new-highs");
        setHighs(res.data);
      }
    } catch (e) {
      console.error("Failed to load RS data", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [activeTab]);

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => setTab("rankings")}
          className={`px-3 py-1 text-xs rounded border ${activeTab === "rankings" ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
        >
          RS Rankings
        </button>
        <button
          onClick={() => setTab("sector")}
          className={`px-3 py-1 text-xs rounded border ${activeTab === "sector" ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
        >
          Sector RS
        </button>
        <button
          onClick={() => setTab("chart")}
          className={`px-3 py-1 text-xs rounded border ${activeTab === "chart" ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
        >
          RS Chart
        </button>
        <button
          onClick={() => setTab("highs")}
          className={`px-3 py-1 text-xs rounded border ${activeTab === "highs" ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
        >
          New Highs
        </button>
      </div>

      {activeTab === "rankings" && (
        <TerminalPanel title="Relative Strength Rankings" subtitle="1-99 percentile of weighted 3/6/9/12M returns" actions={
          <div className="flex gap-2">
            <TerminalInput size="sm" value={universe} onChange={e => setUniverse(e.target.value)} />
            <button onClick={loadData} className="px-2 py-1 bg-terminal-accent text-terminal-bg text-[10px] rounded">Go</button>
          </div>
        }>
          {loading ? <div className="py-2 text-xs text-terminal-muted">Computing RS from price history…</div> : null}
          {!loading && rankings.length === 0 ? (
            <div className="py-2 text-xs text-terminal-muted">No RS data — price history unavailable or unsupported universe (try "Nifty 50").</div>
          ) : null}
          <TerminalTable
            rows={rankings}
            rowKey={(r) => r.symbol}
            columns={[
              { key: "rank", label: "Rank", align: "right", render: (r) => r.rank },
              { key: "symbol", label: "Symbol", render: (r) => r.symbol },
              { key: "rs_score", label: "RS Score", align: "right", render: (r) => <TerminalBadge variant={r.rs_score > 80 ? "success" : "neutral"}>{r.rs_score}</TerminalBadge> },
              { key: "prev_rank", label: "Prev Rank", align: "right", render: (r) => r.prev_rank ?? "—" },
            ]}
          />
        </TerminalPanel>
      )}

      {activeTab === "sector" && (
        <TerminalPanel title="Sector Relative Strength" subtitle="NSE sector indices">
          {!loading && sectorRS.length === 0 ? <div className="py-2 text-xs text-terminal-muted">Sector index history unavailable.</div> : null}
          <div className="h-64 w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sectorRS} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#2a2f3a" />
                <XAxis type="number" tick={{ fill: "#8e98a8", fontSize: 10 }} />
                <YAxis dataKey="sector" type="category" tick={{ fill: "#8e98a8", fontSize: 10 }} width={100} />
                <Tooltip />
                <Bar dataKey="rs_score" fill="#5aa9ff" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </TerminalPanel>
      )}

      {activeTab === "chart" && (
        <TerminalPanel title="RS Line vs Price" actions={
          <div className="flex gap-2">
            <TerminalInput size="sm" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} />
            <button onClick={loadData} className="px-2 py-1 bg-terminal-accent text-terminal-bg text-[10px] rounded">Go</button>
          </div>
        }>
          {!loading && chartData.length === 0 ? <div className="py-2 text-xs text-terminal-muted">No price history for {symbol} vs NIFTY 50.</div> : null}
          <div className="h-80 w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2f3a" />
                <XAxis dataKey="date" tick={{ fill: "#8e98a8", fontSize: 10 }} />
                <YAxis yAxisId="left" tick={{ fill: "#8e98a8", fontSize: 10 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: "#fbbf24", fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="price" stroke="#00c176" dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="rs_line" stroke="#fbbf24" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </TerminalPanel>
      )}

      {activeTab === "highs" && (
        <TerminalPanel title="RS Leaders at New Highs" subtitle="Within 2% of 52W high, RS ≥ 80">
          {!loading && highs.length === 0 ? <div className="py-2 text-xs text-terminal-muted">No RS leaders at new highs right now.</div> : null}
          <TerminalTable
            rows={highs}
            rowKey={(r) => r.symbol}
            columns={[
              { key: "symbol", label: "Symbol", render: (r) => r.symbol },
              { key: "price", label: "Price", align: "right", render: (r) => r.price.toFixed(2) },
              { key: "rs_score", label: "RS Score", align: "right", render: (r) => r.rs_score },
              { key: "high_52w", label: "52W High", align: "right", render: (r) => r.high_52w.toFixed(2) },
            ]}
          />
        </TerminalPanel>
      )}
    </div>
  );
}
