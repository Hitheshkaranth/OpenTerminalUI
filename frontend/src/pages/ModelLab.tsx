import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createModelExperiment, listModelExperiments } from "../api/modelLab";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

const DEFAULT_JSON = '{"tickers":["RELIANCE"]}';
const DEFAULT_PARAMS = '{"short_window":20,"long_window":50}';

export function ModelLabPage() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [tag, setTag] = useState("");
  const [model, setModel] = useState("");

  const [name, setName] = useState("SMA Baseline");
  const [description, setDescription] = useState("Baseline trend model");
  const [tags, setTags] = useState("baseline,trend");
  const [modelKey, setModelKey] = useState("sma_crossover");
  const [benchmark, setBenchmark] = useState("NIFTY50");
  const [startDate, setStartDate] = useState("2025-01-01");
  const [endDate, setEndDate] = useState("2025-12-31");
  const [universeJson, setUniverseJson] = useState(DEFAULT_JSON);
  const [paramsJson, setParamsJson] = useState(DEFAULT_PARAMS);
  const [costJson, setCostJson] = useState('{"commission_bps":1,"slippage_bps":2,"initial_cash":100000}');
  const [error, setError] = useState<string | null>(null);

  const experimentsQuery = useQuery({
    queryKey: ["model-lab", "experiments", tag, model],
    queryFn: () => listModelExperiments({ tag: tag || undefined, model: model || undefined }),
  });

  const createMutation = useMutation({
    mutationFn: createModelExperiment,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["model-lab", "experiments"] });
      setError(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to create experiment"),
  });

  const tagList = useMemo(() => tags.split(",").map((item) => item.trim()).filter(Boolean), [tags]);
  const allExperiments = experimentsQuery.data || [];
  const availableTags = useMemo(
    () =>
      Array.from(
        new Set(
          allExperiments
            .flatMap((item) => item.tags || [])
            .map((entry) => String(entry || "").trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [allExperiments],
  );
  const availableModels = useMemo(
    () =>
      Array.from(
        new Set(
          allExperiments
            .map((item) => String(item.model_key || "").trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [allExperiments],
  );

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    try {
      const parsedUniverse = JSON.parse(universeJson) as Record<string, unknown>;
      const parsedParams = JSON.parse(paramsJson) as Record<string, unknown>;
      const parsedCost = JSON.parse(costJson) as Record<string, unknown>;
      createMutation.mutate({
        name,
        description,
        tags: tagList,
        model_key: modelKey,
        benchmark_symbol: benchmark || undefined,
        start_date: startDate,
        end_date: endDate,
        universe_json: parsedUniverse,
        params_json: parsedParams,
        cost_model_json: parsedCost,
      });
    } catch {
      setError("Invalid JSON in params/universe/cost fields");
    }
  };

  return (
    <div className="space-y-3 p-3">
      <TerminalPanel title="Research Suites" subtitle="Backtesting + Model Lab">
        <div className="flex flex-wrap gap-2 text-xs">
          <Link className={`rounded border px-2 py-1 ${location.pathname.startsWith("/backtesting/model-lab") ? "border-terminal-border text-terminal-muted hover:text-terminal-text" : "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"}`} to="/backtesting">
            Backtesting Console
          </Link>
          <Link className={`rounded border px-2 py-1 ${location.pathname.startsWith("/backtesting/model-lab") ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent" : "border-terminal-border text-terminal-muted hover:text-terminal-text"}`} to="/backtesting/model-lab">
            Open Model Lab
          </Link>
        </div>
      </TerminalPanel>

      <TerminalPanel title="Model Lab" subtitle="Experiment registry and builder">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
          <label className="text-xs">Tag
            <input
              className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              list="model-lab-tag-suggestions"
              placeholder={availableTags.length ? "Try existing tag..." : "Tag"}
            />
          </label>
          <label className="text-xs">Model
            <input
              className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              list="model-lab-model-suggestions"
              placeholder={availableModels.length ? "Try existing model..." : "Model"}
            />
          </label>
          <div className="md:col-span-3 text-xs text-terminal-muted">
            Filters apply to experiment list only.
            {availableTags.length > 0 ? ` Tags: ${availableTags.slice(0, 8).join(", ")}${availableTags.length > 8 ? " ..." : ""}.` : ""}
            {availableModels.length > 0 ? ` Models: ${availableModels.slice(0, 6).join(", ")}${availableModels.length > 6 ? " ..." : ""}.` : ""}
          </div>
        </div>
        <datalist id="model-lab-tag-suggestions">
          {availableTags.map((entry) => (
            <option key={`tag-opt-${entry}`} value={entry} />
          ))}
        </datalist>
        <datalist id="model-lab-model-suggestions">
          {availableModels.map((entry) => (
            <option key={`model-opt-${entry}`} value={entry} />
          ))}
        </datalist>
      </TerminalPanel>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_1fr]">
        <TerminalPanel title="Experiments" subtitle="Research runs and reports">
          {experimentsQuery.isLoading && <div className="text-xs text-terminal-muted">Loading experiments...</div>}
          {experimentsQuery.isError && <div className="text-xs text-terminal-neg">Failed to load experiments.</div>}
          <div className="space-y-2">
            {(experimentsQuery.data || []).map((item) => (
              <div key={item.id} className="rounded border border-terminal-border/50 p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-terminal-text">{item.name}</div>
                    <div className="text-terminal-muted">{item.model_key} | {item.start_date} {"->"} {item.end_date}</div>
                  </div>
                  <div className="flex gap-2">
                    <Link className="rounded border border-terminal-accent px-2 py-1 text-terminal-accent" to={`/backtesting/model-lab/experiments/${item.id}`}>Open</Link>
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {item.tags.map((row) => <span key={`${item.id}-${row}`} className="rounded border border-terminal-border px-1 py-0.5 text-[10px]">{row}</span>)}
                </div>
              </div>
            ))}
            {!experimentsQuery.data?.length && !experimentsQuery.isLoading && (
              <div className="rounded border border-terminal-border/40 p-3 text-xs text-terminal-muted">No experiments yet.</div>
            )}
          </div>
        </TerminalPanel>

        <TerminalPanel title="New Experiment" subtitle="Model + universe + cost profile">
          <form onSubmit={onCreate} className="space-y-2 text-xs">
            <input className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
            <textarea className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
            <input className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={modelKey} onChange={(e) => setModelKey(e.target.value)} placeholder="Model key (e.g. sma_crossover)" />
            {availableModels.length > 0 ? (
              <div className="flex flex-wrap gap-1 text-[10px]">
                {availableModels.slice(0, 8).map((entry) => (
                  <button
                    key={`model-suggest-${entry}`}
                    type="button"
                    className="rounded border border-terminal-border px-1.5 py-0.5 text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                    onClick={() => setModelKey(entry)}
                  >
                    {entry}
                  </button>
                ))}
              </div>
            ) : null}
            <input className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={benchmark} onChange={(e) => setBenchmark(e.target.value)} placeholder="Benchmark" />
            <div className="grid grid-cols-2 gap-2">
              <input type="date" className="rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              <input type="date" className="rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <input className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="comma tags" />
            {availableTags.length > 0 ? (
              <div className="flex flex-wrap gap-1 text-[10px]">
                {availableTags.slice(0, 10).map((entry) => (
                  <button
                    key={`tag-suggest-${entry}`}
                    type="button"
                    className="rounded border border-terminal-border px-1.5 py-0.5 text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                    onClick={() => {
                      const current = tags.split(",").map((item) => item.trim()).filter(Boolean);
                      if (current.includes(entry)) return;
                      setTags(current.length ? `${current.join(",")},${entry}` : entry);
                    }}
                  >
                    {entry}
                  </button>
                ))}
              </div>
            ) : null}
            <textarea className="h-16 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 font-mono text-[11px]" value={universeJson} onChange={(e) => setUniverseJson(e.target.value)} />
            <textarea className="h-16 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 font-mono text-[11px]" value={paramsJson} onChange={(e) => setParamsJson(e.target.value)} />
            <textarea className="h-16 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 font-mono text-[11px]" value={costJson} onChange={(e) => setCostJson(e.target.value)} />
            {error && <div className="text-terminal-neg">{error}</div>}
            <button type="submit" className="rounded border border-terminal-accent bg-terminal-accent/10 px-3 py-1 font-semibold text-terminal-accent" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create Experiment"}
            </button>
          </form>
        </TerminalPanel>
      </div>
    </div>
  );
}
