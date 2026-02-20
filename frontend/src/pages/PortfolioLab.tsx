import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createPortfolioDefinition, listPortfolioDefinitions, type RebalanceFrequency, type WeightingMethod } from "../api/portfolioLab";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

export function PortfolioLabPage() {
  const queryClient = useQueryClient();
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

  const portfolios = useQuery({
    queryKey: ["portfolio-lab", "portfolios"],
    queryFn: () => listPortfolioDefinitions(),
  });

  const createMutation = useMutation({
    mutationFn: createPortfolioDefinition,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["portfolio-lab", "portfolios"] });
    },
  });

  const tickerList = useMemo(
    () => tickers.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean),
    [tickers],
  );

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    createMutation.mutate({
      name,
      description,
      tags: tags.split(",").map((row) => row.trim()).filter(Boolean),
      universe_json: { tickers: tickerList },
      benchmark_symbol: benchmark || undefined,
      start_date: startDate,
      end_date: endDate,
      rebalance_frequency: rebalanceFrequency,
      weighting_method: weightingMethod,
      constraints_json: {
        max_weight: maxWeight,
        cash_buffer: cashBuffer,
      },
    });
  };

  return (
    <div className="space-y-3 p-3">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold uppercase tracking-wide text-terminal-accent">Portfolio</div>
          <span className="rounded border border-terminal-border bg-terminal-bg px-2 py-0.5 text-[11px] text-terminal-muted">
            Mode: Portfolio Lab
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          <Link className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent" to="/equity/portfolio">
            Equity
          </Link>
          <Link className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent" to="/equity/mutual-funds">
            Mutual Funds
          </Link>
          <Link className="rounded border border-terminal-accent px-2 py-1 text-xs text-terminal-accent" to="/equity/portfolio/lab">
            Open Portfolio Lab
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_1fr]">
        <TerminalPanel title="Portfolio Definitions" subtitle="Saved universes and construction policies">
          <div className="space-y-2 text-xs">
            {portfolios.isLoading && <div className="text-terminal-muted">Loading portfolios...</div>}
            {(portfolios.data || []).map((portfolio) => (
              <div className="rounded border border-terminal-border/50 p-2" key={portfolio.id}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-terminal-text">{portfolio.name}</div>
                    <div className="text-terminal-muted">{portfolio.weighting_method} | {portfolio.rebalance_frequency}</div>
                  </div>
                  <Link className="rounded border border-terminal-accent px-2 py-1 text-terminal-accent" to={`/equity/portfolio/lab/portfolios/${portfolio.id}`}>
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
            <button type="submit" className="rounded border border-terminal-accent bg-terminal-accent/10 px-3 py-1 font-semibold text-terminal-accent" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving..." : "Create Portfolio"}
            </button>
          </form>
        </TerminalPanel>
      </div>
    </div>
  );
}
