import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { TerminalTable } from "../components/terminal/TerminalTable";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { api } from "../api/client";

export function DividendDashboardPage() {
  const [activeTab, setTab] = useState<"calendar" | "income" | "analysis" | "aristocrats">("calendar");
  const [calendar, setCalendar] = useState<any[]>([]);
  const [income, setIncome] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [aristocrats, setAristocrats] = useState<any[]>([]);
  const [symbol, setSymbol] = useState("RELIANCE");
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === "calendar") {
        const res = await api.get("/api/dividends/calendar");
        setCalendar(res.data);
      } else if (activeTab === "income") {
        const res = await api.get("/api/dividends/portfolio-income");
        setIncome(res.data);
      } else if (activeTab === "analysis") {
        const res = await api.get(`/api/dividends/history/${symbol}`);
        setHistory(res.data);
      } else if (activeTab === "aristocrats") {
        const res = await api.get("/api/dividends/aristocrats");
        setAristocrats(res.data);
      }
    } catch (e) {
      console.error("Failed to load dividend data", e);
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
          onClick={() => setTab("calendar")}
          className={`px-3 py-1 text-xs rounded border ${activeTab === "calendar" ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
        >
          Upcoming Calendar
        </button>
        <button
          onClick={() => setTab("income")}
          className={`px-3 py-1 text-xs rounded border ${activeTab === "income" ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
        >
          Portfolio Income
        </button>
        <button
          onClick={() => setTab("analysis")}
          className={`px-3 py-1 text-xs rounded border ${activeTab === "analysis" ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
        >
          Stock Analysis
        </button>
        <button
          onClick={() => setTab("aristocrats")}
          className={`px-3 py-1 text-xs rounded border ${activeTab === "aristocrats" ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
        >
          Aristocrats
        </button>
      </div>

      {activeTab === "calendar" && (
        <TerminalPanel title="Upcoming Dividends" subtitle="Ex-dates in the next 30 days">
          <TerminalTable
            rows={calendar}
            rowKey={(r) => r.symbol + r.ex_date}
            columns={[
              { key: "symbol", label: "Symbol", render: (r) => r.symbol },
              { key: "ex_date", label: "Ex-Date", render: (r) => r.ex_date },
              { key: "amount", label: "Amount", align: "right", render: (r) => r.amount.toFixed(2) },
              { key: "type", label: "Type", render: (r) => r.type },
            ]}
          />
        </TerminalPanel>
      )}

      {activeTab === "income" && income && (
        <div className="grid gap-3 lg:grid-cols-3">
          <TerminalPanel title="Annual Projection" className="lg:col-span-1">
            <div className="text-3xl font-bold text-terminal-pos mt-4">
              ₹{income.annual_income.toLocaleString()}
            </div>
            <p className="text-xs text-terminal-muted mt-2">Projected income based on current holdings</p>
          </TerminalPanel>
          <TerminalPanel title="Monthly Breakdown" className="lg:col-span-2">
            <div className="h-48 w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={income.monthly_breakdown}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2f3a" />
                  <XAxis dataKey="month" tick={{ fill: "#8e98a8", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#8e98a8", fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="amount" fill="#00c176" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </TerminalPanel>
        </div>
      )}

      {activeTab === "analysis" && (
        <TerminalPanel title="Dividend History" actions={
          <div className="flex gap-2">
            <TerminalInput size="sm" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} />
            <button onClick={loadData} className="px-2 py-1 bg-terminal-accent text-terminal-bg text-[10px] rounded">Go</button>
          </div>
        }>
          <div className="h-64 w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={history}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2f3a" />
                <XAxis dataKey="date" tick={{ fill: "#8e98a8", fontSize: 10 }} />
                <YAxis tick={{ fill: "#8e98a8", fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="amount" fill="#5aa9ff" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </TerminalPanel>
      )}

      {activeTab === "aristocrats" && (
        <TerminalPanel title="Dividend Aristocrats" subtitle="Consistent growth over decades">
          <TerminalTable
            rows={aristocrats}
            rowKey={(r) => r.symbol}
            columns={[
              { key: "symbol", label: "Symbol", render: (r) => r.symbol },
              { key: "years_growth", label: "Years of Growth", align: "right", render: (r) => r.years_growth },
              { key: "yield", label: "Yield %", align: "right", render: (r) => `${r.yield}%` },
            ]}
          />
        </TerminalPanel>
      )}
    </div>
  );
}
