import { useEffect, useMemo, useState } from "react";

import { TerminalBadge } from "../terminal/TerminalBadge";
import { TerminalButton } from "../terminal/TerminalButton";

export type StressAnalysisMode = "stress" | "replay";

export type StressScenarioDescriptor = {
  key: string;
  name: string;
  description?: string;
  period?: string;
  start_date?: string;
  end_date?: string;
  shocks: Record<string, number>;
};

export type StressCustomParams = {
  equity: number;
  rates: number;
  oil: number;
  fx_usd: number;
  credit_spread: number;
};

const SAVED_SCENARIOS_KEY = "ot:risk:stress:custom-scenarios:v1";

const FACTORS: Array<{
  key: keyof StressCustomParams;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: "pct" | "bps";
}> = [
  { key: "equity", label: "Equity Shock", min: -0.5, max: 0.3, step: 0.01, unit: "pct" },
  { key: "rates", label: "Interest Rates", min: -0.03, max: 0.05, step: 0.0025, unit: "bps" },
  { key: "oil", label: "Oil Shock", min: -0.7, max: 0.5, step: 0.05, unit: "pct" },
  { key: "fx_usd", label: "USD / FX", min: -0.2, max: 0.2, step: 0.01, unit: "pct" },
  { key: "credit_spread", label: "Credit Spread", min: -0.01, max: 0.05, step: 0.0025, unit: "bps" },
];

type SavedScenario = {
  name: string;
  params: StressCustomParams;
};

type Props = {
  analysisMode: StressAnalysisMode;
  onAnalysisModeChange: (mode: StressAnalysisMode) => void;
  portfolioId: string;
  onPortfolioIdChange: (value: string) => void;
  scenarios: StressScenarioDescriptor[];
  selectedScenarioKey: string;
  onScenarioKeyChange: (value: string) => void;
  customParams: StressCustomParams;
  onCustomParamsChange: (next: StressCustomParams) => void;
  onRun: () => void;
  onReplay: () => void;
  running: boolean;
  replaying: boolean;
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures.
  }
}

function formatFactorValue(key: keyof StressCustomParams, value: number): string {
  if (key === "rates" || key === "credit_spread") {
    return `${Math.round(value * 10000)} bps`;
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(0)}%`;
}

export function ScenarioBuilder({
  analysisMode,
  onAnalysisModeChange,
  portfolioId,
  onPortfolioIdChange,
  scenarios,
  selectedScenarioKey,
  onScenarioKeyChange,
  customParams,
  onCustomParamsChange,
  onRun,
  onReplay,
  running,
  replaying,
}: Props) {
  const [scenarioName, setScenarioName] = useState("My Stress Scenario");
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>(() => readJson<SavedScenario[]>(SAVED_SCENARIOS_KEY, []));
  const [loadIndex, setLoadIndex] = useState("");

  useEffect(() => {
    writeJson(SAVED_SCENARIOS_KEY, savedScenarios.slice(0, 12));
  }, [savedScenarios]);

  const scenarioDescription = useMemo(() => {
    const selected = scenarios.find((item) => item.key === selectedScenarioKey);
    return selected?.description || selected?.period || "Custom or predefined scenario";
  }, [scenarios, selectedScenarioKey]);

  const updateFactor = (factor: keyof StressCustomParams, value: number) => {
    onCustomParamsChange({ ...customParams, [factor]: value });
  };

  const saveScenario = () => {
    const trimmed = scenarioName.trim();
    if (!trimmed) return;
    setSavedScenarios((prev) => {
      const next = [{ name: trimmed, params: customParams }, ...prev.filter((item) => item.name !== trimmed)];
      return next.slice(0, 12);
    });
  };

  const loadScenario = () => {
    if (loadIndex === "") return;
    const index = Number(loadIndex);
    if (!Number.isInteger(index)) return;
    const selected = savedScenarios[index];
    if (!selected) return;
    onScenarioKeyChange("custom");
    onCustomParamsChange(selected.params);
    onAnalysisModeChange("stress");
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-[1.3fr_0.9fr]">
        <div className="rounded border border-terminal-border bg-terminal-panel p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-terminal-muted">Scenario Builder</div>
              <div className="text-sm text-terminal-text">{scenarioDescription}</div>
            </div>
            <TerminalBadge variant={analysisMode === "replay" ? "info" : "accent"}>{analysisMode.toUpperCase()}</TerminalBadge>
          </div>

          <div className="grid gap-2 md:grid-cols-[1fr_180px]">
            <label className="space-y-1 text-[10px] uppercase tracking-[0.16em] text-terminal-muted">
              <span>Portfolio ID</span>
              <input
                value={portfolioId}
                onChange={(event) => onPortfolioIdChange(event.target.value)}
                className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1.5 text-xs text-terminal-text outline-none focus:border-terminal-accent"
                placeholder="current"
              />
            </label>
            <label className="space-y-1 text-[10px] uppercase tracking-[0.16em] text-terminal-muted">
              <span>Mode</span>
              <select
                value={analysisMode}
                onChange={(event) => onAnalysisModeChange(event.target.value as StressAnalysisMode)}
                className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1.5 text-xs text-terminal-text outline-none focus:border-terminal-accent"
              >
                <option value="stress">Stress Test</option>
                <option value="replay">Historical Replay</option>
              </select>
            </label>
          </div>

          <label className="mt-3 block space-y-1 text-[10px] uppercase tracking-[0.16em] text-terminal-muted">
            <span>Scenario</span>
            <select
              value={selectedScenarioKey}
              onChange={(event) => onScenarioKeyChange(event.target.value)}
              className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1.5 text-xs text-terminal-text outline-none focus:border-terminal-accent"
            >
              {scenarios.map((scenario) => (
                <option key={scenario.key} value={scenario.key}>
                  {scenario.name}
                </option>
              ))}
              <option value="custom">Custom Scenario</option>
            </select>
          </label>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {FACTORS.map((factor) => (
              <label key={factor.key} className="space-y-1 rounded border border-terminal-border/60 bg-terminal-bg/40 p-2 text-[10px] uppercase tracking-[0.16em] text-terminal-muted">
                <div className="flex items-center justify-between gap-2">
                  <span>{factor.label}</span>
                  <span className="text-terminal-text">{formatFactorValue(factor.key, customParams[factor.key])}</span>
                </div>
                <input
                  type="range"
                  min={factor.min}
                  max={factor.max}
                  step={factor.step}
                  value={customParams[factor.key]}
                  onChange={(event) => updateFactor(factor.key, Number(event.target.value))}
                  className="w-full accent-terminal-accent"
                />
              </label>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <TerminalButton variant="accent" size="md" onClick={onRun} loading={running}>
              Run Stress Test
            </TerminalButton>
            <TerminalButton variant="success" size="md" onClick={onReplay} loading={replaying}>
              Run Replay
            </TerminalButton>
            <TerminalButton
              variant="ghost"
              size="md"
              onClick={() => {
                onAnalysisModeChange("stress");
                onScenarioKeyChange("custom");
              }}
            >
              Switch to Custom
            </TerminalButton>
          </div>
        </div>

        <div className="rounded border border-terminal-border bg-terminal-panel p-3">
          <div className="text-[10px] uppercase tracking-[0.22em] text-terminal-muted">Saved Custom Scenarios</div>
          <div className="mt-2 space-y-2">
            <input
              value={scenarioName}
              onChange={(event) => setScenarioName(event.target.value)}
              className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1.5 text-xs text-terminal-text outline-none focus:border-terminal-accent"
              placeholder="Scenario name"
            />
            <div className="flex gap-2">
              <TerminalButton variant="accent" size="md" className="flex-1" onClick={saveScenario}>
                Save Current
              </TerminalButton>
              <TerminalButton variant="ghost" size="md" className="flex-1" onClick={loadScenario} disabled={!savedScenarios.length}>
                Load Selected
              </TerminalButton>
            </div>
            <select
              value={loadIndex}
              onChange={(event) => setLoadIndex(event.target.value)}
              className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1.5 text-xs text-terminal-text outline-none focus:border-terminal-accent"
            >
              <option value="">
                {savedScenarios.length ? "Select saved scenario" : "No saved scenarios"}
              </option>
              {savedScenarios.map((scenario, index) => (
                <option key={`${scenario.name}-${index}`} value={index}>
                  {scenario.name}
                </option>
              ))}
            </select>
            <div className="space-y-2 text-[11px] text-terminal-muted">
              {savedScenarios.length ? (
                savedScenarios.slice(0, 5).map((scenario, index) => (
                  <button
                    key={`${scenario.name}-${index}`}
                    type="button"
                    onClick={() => {
                      setLoadIndex(String(index));
                      onScenarioKeyChange("custom");
                      onCustomParamsChange(scenario.params);
                      onAnalysisModeChange("stress");
                    }}
                    className="flex w-full items-center justify-between rounded border border-terminal-border/60 px-2 py-1 text-left hover:border-terminal-accent hover:text-terminal-text"
                  >
                    <span className="truncate">{scenario.name}</span>
                    <span className="text-terminal-muted">Load</span>
                  </button>
                ))
              ) : (
                <div className="rounded border border-terminal-border/60 px-2 py-3 text-center text-terminal-muted">
                  Save a custom scenario to reuse its parameter set.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
