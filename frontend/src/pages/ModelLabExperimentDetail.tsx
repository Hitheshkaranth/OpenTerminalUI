import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getModelExperiment, runModelExperiment, runModelParamSweep, runModelWalkForward } from "../api/modelLab";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

export function ModelLabExperimentDetailPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const [wfTrain, setWfTrain] = useState(252);
  const [wfTest, setWfTest] = useState(63);
  const [sweepGrid, setSweepGrid] = useState('{"short_window":[10,20],"long_window":[50,100]}');
  const [sweepMax, setSweepMax] = useState(16);
  const [robustnessOutput, setRobustnessOutput] = useState<string>("");

  const detailQuery = useQuery({
    queryKey: ["model-lab", "experiment", id],
    queryFn: () => getModelExperiment(id),
    enabled: Boolean(id),
    refetchInterval: 2000,
  });

  const runMutation = useMutation({
    mutationFn: () => runModelExperiment(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["model-lab", "experiment", id] });
    },
  });

  const newestRunId = useMemo(() => detailQuery.data?.runs?.[0]?.id || null, [detailQuery.data]);

  const runWalkForwardMutation = useMutation({
    mutationFn: () => runModelWalkForward(id, { train_window_days: wfTrain, test_window_days: wfTest }),
    onSuccess: (payload) => setRobustnessOutput(JSON.stringify(payload, null, 2)),
  });

  const runSweepMutation = useMutation({
    mutationFn: async () => {
      const grid = JSON.parse(sweepGrid) as Record<string, Array<number | string | boolean>>;
      return runModelParamSweep(id, { grid, max_combinations: sweepMax });
    },
    onSuccess: (payload) => setRobustnessOutput(JSON.stringify(payload, null, 2)),
    onError: () => setRobustnessOutput("Failed to run sweep; check grid JSON and bound."),
  });

  if (!id) {
    return <div className="p-3 text-sm text-terminal-neg">Missing experiment id.</div>;
  }

  return (
    <div className="space-y-3 p-3">
      <TerminalPanel title="Model Lab / Experiment" subtitle={id}>
        {detailQuery.isLoading && <div className="text-xs text-terminal-muted">Loading experiment...</div>}
        {detailQuery.isError && <div className="text-xs text-terminal-neg">Failed to load experiment.</div>}
        {detailQuery.data && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.2fr_1fr] text-xs">
            <div className="space-y-2 rounded border border-terminal-border/50 p-2">
              <div className="text-sm font-semibold">{detailQuery.data.name}</div>
              <div className="text-terminal-muted">{detailQuery.data.description || "No description"}</div>
              <div>Model: <span className="text-terminal-accent">{detailQuery.data.model_key}</span></div>
              <div>Date range: {detailQuery.data.start_date} {"->"} {detailQuery.data.end_date}</div>
              <div className="flex flex-wrap gap-1">{detailQuery.data.tags.map((tag) => <span className="rounded border border-terminal-border px-1 py-0.5" key={tag}>{tag}</span>)}</div>
              <div className="flex gap-2">
                <button className="rounded border border-terminal-accent bg-terminal-accent/10 px-3 py-1 text-terminal-accent" onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
                  {runMutation.isPending ? "Running..." : "Run"}
                </button>
                {newestRunId && <Link className="rounded border border-terminal-border px-3 py-1" to={`/backtesting/model-lab/runs/${newestRunId}`}>Open Latest Report</Link>}
              </div>
            </div>
            <div className="space-y-2 rounded border border-terminal-border/50 p-2">
              <div className="font-semibold">Runs</div>
              {(detailQuery.data.runs || []).map((run) => (
                <div className="flex items-center justify-between rounded border border-terminal-border/40 p-1" key={run.id}>
                  <div>
                    <div>{run.id}</div>
                    <div className="text-terminal-muted">{run.status}</div>
                  </div>
                  <Link className="rounded border border-terminal-border px-2 py-1" to={`/backtesting/model-lab/runs/${run.id}`}>Report</Link>
                </div>
              ))}
            </div>
          </div>
        )}
      </TerminalPanel>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <TerminalPanel title="Walk-Forward" subtitle="Robustness validation">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label>Train days
              <input type="number" className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={wfTrain} onChange={(e) => setWfTrain(Number(e.target.value))} />
            </label>
            <label>Test days
              <input type="number" className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={wfTest} onChange={(e) => setWfTest(Number(e.target.value))} />
            </label>
          </div>
          <button className="mt-2 rounded border border-terminal-accent bg-terminal-accent/10 px-3 py-1 text-xs text-terminal-accent" onClick={() => runWalkForwardMutation.mutate()}>
            Run Walk-Forward
          </button>
        </TerminalPanel>

        <TerminalPanel title="Parameter Sweep" subtitle="Bounded grid search">
          <textarea className="h-20 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 font-mono text-[11px]" value={sweepGrid} onChange={(e) => setSweepGrid(e.target.value)} />
          <label className="mt-2 block text-xs">Max combinations
            <input type="number" className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={sweepMax} onChange={(e) => setSweepMax(Number(e.target.value))} />
          </label>
          <button className="mt-2 rounded border border-terminal-accent bg-terminal-accent/10 px-3 py-1 text-xs text-terminal-accent" onClick={() => runSweepMutation.mutate()}>
            Run Sweep
          </button>
        </TerminalPanel>
      </div>

      <TerminalPanel title="Robustness Output" subtitle="Walk-forward + sweep results">
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap bg-terminal-bg p-2 text-[11px] text-terminal-muted">{robustnessOutput || "No run yet."}</pre>
      </TerminalPanel>
    </div>
  );
}
