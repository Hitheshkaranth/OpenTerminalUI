import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getPortfolioDefinition, listStrategyBlends, runPortfolioDefinition } from "../api/portfolioLab";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

export function PortfolioLabDetailPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const [selectedBlend, setSelectedBlend] = useState<string>("");

  const portfolioQuery = useQuery({
    queryKey: ["portfolio-lab", "portfolio", id],
    queryFn: () => getPortfolioDefinition(id),
    enabled: Boolean(id),
    refetchInterval: 2500,
  });

  const blendsQuery = useQuery({
    queryKey: ["portfolio-lab", "blends"],
    queryFn: listStrategyBlends,
  });

  const runMutation = useMutation({
    mutationFn: () => runPortfolioDefinition(id, selectedBlend ? { blend_id: selectedBlend } : {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["portfolio-lab", "portfolio", id] });
    },
  });

  const latestRun = portfolioQuery.data?.runs?.[0];

  return (
    <div className="space-y-3 p-3">
      <TerminalPanel title="Portfolio Lab / Portfolio" subtitle={id}>
        {portfolioQuery.isLoading && <div className="text-xs text-terminal-muted">Loading portfolio...</div>}
        {portfolioQuery.data && (
          <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-[1.2fr_1fr]">
            <div className="space-y-1">
              <div className="text-sm font-semibold">{portfolioQuery.data.name}</div>
              <div className="text-terminal-muted">{portfolioQuery.data.description || "No description"}</div>
              <div>Weighting: <span className="text-terminal-accent">{portfolioQuery.data.weighting_method}</span></div>
              <div>Rebalance: {portfolioQuery.data.rebalance_frequency}</div>
              <div>Date: {portfolioQuery.data.start_date} {"->"} {portfolioQuery.data.end_date}</div>
              <div className="mt-2 flex items-center gap-2">
                <select className="rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={selectedBlend} onChange={(e) => setSelectedBlend(e.target.value)}>
                  <option value="">No blend (single strategy baseline)</option>
                  {(blendsQuery.data || []).map((blend) => <option key={blend.id} value={blend.id}>{blend.name}</option>)}
                </select>
                <button className="rounded border border-terminal-accent bg-terminal-accent/10 px-3 py-1 text-terminal-accent" onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
                  {runMutation.isPending ? "Running..." : "Run Portfolio"}
                </button>
                <Link className="rounded border border-terminal-border px-3 py-1" to="/equity/portfolio/lab/blends">Blends</Link>
              </div>
            </div>
            <div className="space-y-1 rounded border border-terminal-border/40 p-2">
              <div className="font-semibold">Run History</div>
              {(portfolioQuery.data.runs || []).map((run) => (
                <div key={run.run_id} className="flex items-center justify-between rounded border border-terminal-border/40 p-1">
                  <div>
                    <div>{run.run_id}</div>
                    <div className="text-terminal-muted">{run.status}</div>
                  </div>
                  <Link className="rounded border border-terminal-border px-2 py-1" to={`/equity/portfolio/lab/runs/${run.run_id}`}>Report</Link>
                </div>
              ))}
              {!portfolioQuery.data.runs?.length && <div className="text-terminal-muted">No runs yet.</div>}
            </div>
          </div>
        )}
      </TerminalPanel>

      {latestRun && (
        <TerminalPanel title="Latest Run" subtitle={latestRun.run_id}>
          <div className="text-xs">Status: {latestRun.status}</div>
          <div className="mt-2">
            <Link className="rounded border border-terminal-accent px-2 py-1 text-xs text-terminal-accent" to={`/equity/portfolio/lab/runs/${latestRun.run_id}`}>
              Open Latest Report
            </Link>
          </div>
        </TerminalPanel>
      )}
    </div>
  );
}
