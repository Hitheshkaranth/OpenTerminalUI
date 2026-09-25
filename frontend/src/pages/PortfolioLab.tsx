import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createPortfolioDefinition, listPortfolioDefinitions, type RebalanceFrequency, type WeightingMethod } from "../api/client";
import { api } from "../api/base";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

type LeaderboardSortKey = "sharpe" | "cagr" | "max_drawdown" | "turnover" | "stability" | "recency" | "governance";
type PortfolioLeaderboardRow = {
  run_id?: string;
  portfolio_id?: string;
  name?: string;
  market?: string;
  sharpe?: number;
  cagr?: number;
  max_drawdown?: number;
  turnover?: number;
  stability?: number;
  recency?: number;
  governance?: number;
};

function normalizeIsoDate(input: string): string {
  const value = input.trim();
  if (!value) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const dmy = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    return `${yyyy}-${mm}-${dd}`;
  }
  return value;
}

export function PortfolioLabPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [leaderboardMarket, setLeaderboardMarket] = useState<"US" | "India">("India");
  const [leaderboardSort, setLeaderboardSort] = useState<LeaderboardSortKey>("sharpe");
  const [name, setName] = useState("Core Multi-Asset");
  const [description, setDescription] = useState("Portfolio lab baseline");
  const [tags, setTags] = useState("core,multi-asset");
  const [tickers, setTickers] = useState("RELIANCE,TCS,INFY,HDFCBANK");
  const [startDate, setStartDate] = useState("2025-01-01");
  const [endDate, setEndDate] = useState("2025-12-31");
  const [benchmark, setBenchmark] = useState("NIFTY50");
  const [rebalanceFrequency, setRebalanceFrequency] = useState<RebalanceFrequency>("WEEKLY");
  const [weightingMethod, setWeightingMethod] = useState<WeightingMethod>("RISK_PARITY");
  const [maxWeight, setMaxWeight] = useState(0.25);
  const [cashBuffer, setCashBuffer] = useState(0);
  const [createMessage, setCreateMessage] = useState<string | null>(null);

  const portfolios = useQuery({
    queryKey: ["portfolio-lab", "portfolios"],
    queryFn: () => listPortfolioDefinitions(),
  });
  const leaderboardQuery = useQuery({
    queryKey: ["portfolio-lab", "leaderboard", leaderboardMarket],
    queryFn: async () => {
      const { data } = await api.get<{ items?: PortfolioLeaderboardRow[]; rows?: PortfolioLeaderboardRow[] } | PortfolioLeaderboardRow[]>("/portfolio-lab/leaderboard", {
        params: { market: leaderboardMarket },
      });
      if (Array.isArray(data)) return data;
      return data.items || data.rows || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: createPortfolioDefinition,
    onSuccess: (created) => {
      setCreateMessage(`Portfolio created: ${created.name}`);
      void queryClient.invalidateQueries({ queryKey: ["portfolio-lab", "portfolios"] });
    },
    onError: (err: unknown) => {
      let detail = "Failed to create portfolio";
      if (typeof err === "object" && err && "response" in err) {
        const maybeResponse = (err as { response?: { data?: { detail?: string } } }).response;
        if (maybeResponse?.data?.detail) detail = maybeResponse.data.detail;
      } else if (err instanceof Error && err.message) {
        detail = err.message;
      }
      setCreateMessage(detail);
    },
  });

  const tickerList = useMemo(
    () => tickers.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean),
    [tickers],
  );
  const sortedLeaderboard = useMemo(() => {
    const direction = leaderboardSort === "max_drawdown" || leaderboardSort === "turnover" ? 1 : -1;
    return [...(leaderboardQuery.data || [])].sort((a, b) => direction * (Number(a[leaderboardSort] ?? 0) - Number(b[leaderboardSort] ?? 0)));
  }, [leaderboardQuery.data, leaderboardSort]);
  const portfolioCount = portfolios.data?.length ?? 0;
  const leaderboardCount = leaderboardQuery.data?.length ?? 0;

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    setCreateMessage(null);
    const normalizedStart = normalizeIsoDate(startDate);
    const normalizedEnd = normalizeIsoDate(endDate);
    createMutation.mutate({
      name: name.trim(),
      description,
      tags: tags.split(",").map((row) => row.trim()).filter(Boolean),
      universe_json: { tickers: tickerList },
      benchmark_symbol: benchmark.trim().toUpperCase() || undefined,
      start_date: normalizedStart,
      end_date: normalizedEnd,
      rebalance_frequency: rebalanceFrequency,
      weighting_method: weightingMethod,
      constraints_json: {
        max_weight: maxWeight,
        cash_buffer: cashBuffer,
      },
    });
  };

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(255,107,0,0.08),transparent_34rem)] p-3 md:p-5">
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-4">
        <section className="rounded-md border border-terminal-border/70 bg-terminal-panel/95 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.18)] md:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <TerminalBadge variant="accent">Portfolio Lab</TerminalBadge>
                <TerminalBadge variant="neutral">{leaderboardMarket}</TerminalBadge>
                <TerminalBadge variant={createMutation.isPending ? "warn" : "info"}>
                  {createMutation.isPending ? "Saving" : "Research Mode"}
                </TerminalBadge>
              </div>
              <h1 className="max-w-4xl font-sans text-2xl font-semibold tracking-normal text-terminal-text md:text-3xl">
                Research and stress-test portfolio strategies.
              </h1>
              <p className="mt-2 max-w-3xl font-sans text-sm leading-6 text-terminal-muted">
                Build reusable universes, compare construction policies, and review leaderboard quality without leaving the portfolio workflow.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs md:min-w-[420px]">
              <div className="rounded-md border border-terminal-border bg-terminal-bg/70 p-3">
                <div className="font-sans text-[11px] text-terminal-muted">Definitions</div>
                <div className="mt-1 text-xl font-semibold text-terminal-text">{portfolios.isLoading ? "--" : portfolioCount.toLocaleString("en-IN")}</div>
              </div>
              <div className="rounded-md border border-terminal-border bg-terminal-bg/70 p-3">
                <div className="font-sans text-[11px] text-terminal-muted">Leaderboard</div>
                <div className="mt-1 text-xl font-semibold text-terminal-text">{leaderboardQuery.isLoading ? "--" : leaderboardCount.toLocaleString("en-IN")}</div>
              </div>
              <div className="rounded-md border border-terminal-border bg-terminal-bg/70 p-3">
                <div className="font-sans text-[11px] text-terminal-muted">Universe</div>
                <div className="mt-1 text-xl font-semibold text-terminal-text">{tickerList.length.toLocaleString("en-IN")}</div>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <TerminalButton size="sm" variant="default" onClick={() => navigate("/equity/portfolio")}>
              Equity
            </TerminalButton>
            <TerminalButton size="sm" variant="default" onClick={() => navigate("/equity/mutual-funds")}>
              Mutual Funds
            </TerminalButton>
            <TerminalButton size="sm" variant="accent" onClick={() => navigate("/equity/portfolio/lab")}>
              Open Portfolio Lab
            </TerminalButton>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr]">
          <TerminalPanel title="Portfolio Definitions" subtitle="Saved universes and construction policies">
            <div className="space-y-2 text-xs">
              {portfolios.isLoading && <div className="text-terminal-muted">Loading portfolios...</div>}
              {portfolios.isError && <div className="text-terminal-neg">Failed to load portfolios.</div>}
              {portfolios.isSuccess && !(portfolios.data || []).length && (
                <div className="rounded-md border border-dashed border-terminal-border/60 p-3 text-terminal-muted">
                  No portfolio definitions yet. Create one with the New Portfolio form to backtest a universe and construction policy.
                </div>
              )}
              {(portfolios.data || []).map((portfolio) => (
                <div className="rounded-md border border-terminal-border/50 bg-terminal-bg/40 p-2" key={portfolio.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-terminal-text">{portfolio.name}</div>
                      <div className="text-terminal-muted">{portfolio.weighting_method} | {portfolio.rebalance_frequency}</div>
                    </div>
                    <Link className="rounded-sm border border-terminal-accent px-2 py-1 text-terminal-accent transition-colors hover:bg-terminal-accent/10" to={`/equity/portfolio/lab/portfolios/${portfolio.id}`}>
                      Open
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </TerminalPanel>

          <TerminalPanel title="New Portfolio" subtitle="Universe + constraints + benchmark">
            <form onSubmit={onCreate} className="space-y-2 text-xs">
              <input className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <textarea className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
              <textarea className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" placeholder="Tickers comma-separated" value={tickers} onChange={(e) => setTickers(e.target.value)} />
              <input className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" placeholder="Benchmark" value={benchmark} onChange={(e) => setBenchmark(e.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                <input type="date" className="rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                <input type="date" className="rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select className="rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={rebalanceFrequency} onChange={(e) => setRebalanceFrequency(e.target.value as RebalanceFrequency)}>
                  <option value="DAILY">DAILY</option>
                  <option value="WEEKLY">WEEKLY</option>
                  <option value="MONTHLY">MONTHLY</option>
                </select>
                <select className="rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={weightingMethod} onChange={(e) => setWeightingMethod(e.target.value as WeightingMethod)}>
                  <option value="EQUAL">EQUAL</option>
                  <option value="VOL_TARGET">VOL_TARGET</option>
                  <option value="RISK_PARITY">RISK_PARITY</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label>
                  Max Weight
                  <input type="number" min={0.05} max={1} step={0.01} className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={maxWeight} onChange={(e) => setMaxWeight(Number(e.target.value))} />
                </label>
                <label>
                  Cash Buffer
                  <input type="number" min={0} max={0.9} step={0.01} className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={cashBuffer} onChange={(e) => setCashBuffer(Number(e.target.value))} />
                </label>
              </div>
              <input className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" placeholder="Tags" value={tags} onChange={(e) => setTags(e.target.value)} />
              <TerminalButton type="submit" size="md" variant="accent" loading={createMutation.isPending}>
                {createMutation.isPending ? "Saving..." : "Create Portfolio"}
              </TerminalButton>
              {createMessage && (
                <div className={`rounded border px-2 py-1 ${createMutation.isError ? "border-terminal-neg/60 text-terminal-neg" : "border-terminal-pos/60 text-terminal-pos"}`}>
                  {createMessage}
                </div>
              )}
            </form>
          </TerminalPanel>
        </div>

        <TerminalPanel title="Portfolio Leaderboard" subtitle={`${leaderboardMarket} market / sortable construction quality`}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex gap-1">
              {(["India", "US"] as const).map((marketOpt) => (
                <TerminalButton key={marketOpt} type="button" size="sm" variant={leaderboardMarket === marketOpt ? "accent" : "default"} onClick={() => setLeaderboardMarket(marketOpt)}>
                  {marketOpt}
                </TerminalButton>
              ))}
            </div>
            <select className="rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={leaderboardSort} onChange={(event) => setLeaderboardSort(event.target.value as LeaderboardSortKey)}>
              <option value="sharpe">Sharpe</option>
              <option value="cagr">CAGR</option>
              <option value="max_drawdown">Max drawdown</option>
              <option value="turnover">Turnover</option>
              <option value="stability">Stability</option>
              <option value="recency">Recency</option>
              <option value="governance">Governance</option>
            </select>
          </div>
          <div className="overflow-auto">
            <table className="min-w-full text-[11px]">
              <thead>
                <tr className="border-b border-terminal-border/50 text-terminal-muted">
                  {["Run", "Portfolio", "Market", "Sharpe", "CAGR", "MaxDD", "Turnover", "Stability", "Recency", "Governance"].map((header) => <th key={header} className="px-2 py-1 text-left">{header}</th>)}
                </tr>
              </thead>
              <tbody>
                {sortedLeaderboard.map((row, index) => (
                  <tr key={`${row.run_id || row.portfolio_id || row.name}-${index}`} className="border-b border-terminal-border/30">
                    <td className="px-2 py-1">{row.run_id ? <Link className="text-terminal-accent" to={`/equity/portfolio/lab/runs/${row.run_id}`}>{row.run_id}</Link> : "-"}</td>
                    <td className="px-2 py-1">{row.name || row.portfolio_id || "-"}</td>
                    <td className="px-2 py-1">{row.market || leaderboardMarket}</td>
                    <td className="px-2 py-1 text-right">{Number(row.sharpe || 0).toFixed(2)}</td>
                    <td className="px-2 py-1 text-right">{Number(row.cagr || 0).toLocaleString(undefined, { style: "percent", maximumFractionDigits: 2 })}</td>
                    <td className="px-2 py-1 text-right text-terminal-neg">{Number(row.max_drawdown || 0).toLocaleString(undefined, { style: "percent", maximumFractionDigits: 2 })}</td>
                    <td className="px-2 py-1 text-right">{Number(row.turnover || 0).toFixed(3)}</td>
                    <td className="px-2 py-1 text-right">{Number(row.stability || 0).toFixed(2)}</td>
                    <td className="px-2 py-1 text-right">{Number(row.recency || 0).toFixed(2)}</td>
                    <td className="px-2 py-1 text-right">{Number(row.governance || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!sortedLeaderboard.length && <div className="p-3 text-xs text-terminal-muted">{leaderboardQuery.isLoading ? "Loading leaderboard..." : "No leaderboard rows."}</div>}
          </div>
        </TerminalPanel>
      </main>
    </div>
  );
}
