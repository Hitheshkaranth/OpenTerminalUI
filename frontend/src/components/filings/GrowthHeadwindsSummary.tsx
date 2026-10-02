import { useEffect, useState } from "react";

import { fetchAnalysis, type Analysis, type DriverResult } from "../../api/filingsRag";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalBadge } from "../terminal/TerminalBadge";
import { stanceLabel, stanceVariant, strengthPct } from "./presentation";

type Props = {
  symbol: string;
  market?: string;
  onOpenFilings?: () => void;
};

function DriverRow({ label, strength }: { label: string; strength: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-xs text-terminal-text" title={label}>{label}</span>
      <div className="w-16 shrink-0 overflow-hidden rounded-full bg-terminal-panel">
        <div className="h-1.5 rounded-full bg-terminal-accent/70" style={{ width: `${strengthPct(strength)}%` }} />
      </div>
    </div>
  );
}

function TopDrivers({ drivers }: { drivers: DriverResult[] }) {
  const top = drivers
    .filter((d) => d?.label && d.strength > 0)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3);
  if (!top.length) return <div className="text-xs text-terminal-muted">—</div>;
  return (
    <div className="space-y-1.5">
      {top.map((d) => (
        <DriverRow key={d.id} label={d.label} strength={d.strength} />
      ))}
    </div>
  );
}

export function GrowthHeadwindsSummary({ symbol, onOpenFilings }: Props) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) return;
    let active = true;
    setLoading(true);
    setError(null);
    fetchAnalysis(symbol)
      .then((payload) => {
        if (active) setAnalysis(payload);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Analysis unavailable");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [symbol]);

  const openFilings = () => {
    if (onOpenFilings) onOpenFilings();
  };

  const scores = analysis?.scores;
  const stance = analysis?.stance;

  return (
    <TerminalPanel
      title="Growth & Headwinds"
      subtitle="Primary-document signals"
      actions={
        onOpenFilings ? (
          <TerminalButton size="sm" variant="ghost" onClick={openFilings}>
            Open Filings
          </TerminalButton>
        ) : null
      }
    >
      {loading ? (
        <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-3 text-xs text-terminal-muted">
          Reading filings analysis…
        </div>
      ) : error ? (
        <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-3 text-xs text-terminal-muted">
          Filings analysis unavailable.
        </div>
      ) : !analysis ? (
        <div className="space-y-2">
          <p className="text-xs text-terminal-muted">
            No growth / headwind read yet. Import documents into the Filings tab and run an analysis
            to surface cited drivers of return.
          </p>
          {onOpenFilings ? (
            <TerminalButton size="sm" onClick={openFilings}>
              Go to Filings
            </TerminalButton>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="ot-type-label text-terminal-muted">Net stance</span>
              <TerminalBadge variant={stanceVariant(stance ?? "balanced")} dot>
                {stanceLabel(stance ?? "balanced")}
              </TerminalBadge>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px]">
              <div className="flex items-end gap-1">
                <span className="text-terminal-muted">Growth</span>
                <span className="ot-type-data text-sm text-terminal-pos">{scores?.growth ?? 0}</span>
              </div>
              <div className="text-terminal-border">/</div>
              <div className="flex items-end gap-1">
                <span className="text-terminal-muted">Headwind</span>
                <span className="ot-type-data text-sm text-terminal-neg">{scores?.headwind ?? 0}</span>
              </div>
              <div className="text-terminal-border">/</div>
              <div className="flex items-end gap-1">
                <span className="text-terminal-muted">Net</span>
                <span className="ot-type-data text-sm text-terminal-text">{scores?.net ?? 0}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div>
              <div className="mb-1.5 ot-type-label text-terminal-accent">Growth engines</div>
              <TopDrivers drivers={analysis.growth} />
            </div>
            <div>
              <div className="mb-1.5 ot-type-label text-terminal-neg">Headwinds</div>
              <TopDrivers drivers={analysis.headwinds} />
            </div>
          </div>

          {analysis.warnings?.length ? (
            <div className="text-[11px] text-terminal-warn">
              {analysis.warnings.join(" · ")}
            </div>
          ) : null}
        </div>
      )}
    </TerminalPanel>
  );
}