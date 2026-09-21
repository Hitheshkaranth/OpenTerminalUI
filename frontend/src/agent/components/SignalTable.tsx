import { useState } from "react";
import { getScorecard, evaluateSignals, type ScorecardPersona } from "../../api/agentExtras";
import type { SignalTableData } from "../types";

type Verdict = "BUY" | "SELL" | "HOLD";
const VERDICT_COLORS: Record<Verdict, string> = {
  BUY: "text-terminal-pos",
  SELL: "text-terminal-neg",
  HOLD: "text-terminal-muted",
};

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`font-mono text-[10px] font-bold uppercase ${VERDICT_COLORS[verdict]}`}>
      {verdict}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = ((score + 100) / 200) * 100;
  const color = score > 0 ? "bg-terminal-pos" : score < 0 ? "bg-terminal-neg" : "bg-terminal-border";
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-terminal-bg/60">
      <div className={`absolute left-1/2 top-0 h-full w-px bg-terminal-border/60`} />
      <div
        className={`absolute top-0 h-full rounded-full ${color}`}
        style={{
          left: score >= 0 ? "50%" : `${50 + pct / 2}%`,
          right: score < 0 ? "50%" : `${100 - pct / 2}%`,
          width: score >= 0 ? `${pct / 2}%` : `${50 - pct / 2}%`,
          maxWidth: "50%",
        }}
      />
    </div>
  );
}

const SIGNAL_COLORS: Record<string, string> = {
  bullish: "text-terminal-pos",
  bearish: "text-terminal-neg",
  neutral: "text-terminal-muted",
};

export function SignalTable({ data }: { data: SignalTableData }) {
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);

  const scorecard = { personas: [], as_of: "", loaded: false as false };
  // Scorecard is fetched externally via props or the getScorecard function
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-terminal-border">
            <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-terminal-muted">Symbol</th>
            <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-terminal-muted">Verdict</th>
            <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-terminal-muted">Score</th>
            <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-terminal-muted">B / B / N</th>
            <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-terminal-muted" />
          </tr>
        </thead>
        <tbody>
          {data.consensus.map((c) => (
            <SignalRow
              key={c.symbol}
              consensus={c}
              personaSignals={data.signals.filter((s) => s.symbol === c.symbol)}
              expanded={expandedSymbol === c.symbol}
              onToggle={() => setExpandedSymbol(expandedSymbol === c.symbol ? null : c.symbol)}
            />
          ))}
        </tbody>
      </table>
      <ScorecardStrip personas={scorecard.personas} loaded={scorecard.loaded} />
    </div>
  );
}

function SignalRow({
  consensus,
  personaSignals,
  expanded,
  onToggle,
}: {
  consensus: { symbol: string; score: number; verdict: Verdict; bullish: number; bearish: number; neutral: number };
  personaSignals: { persona: string; signal: string; confidence: number; reason: string }[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="cursor-pointer border-b border-terminal-border/40 hover:bg-terminal-bg/40" onClick={onToggle}>
        <td className="px-2 py-1.5 font-mono text-[11px] text-terminal-text">{consensus.symbol}</td>
        <td className="px-2 py-1.5">
          <VerdictBadge verdict={consensus.verdict} />
        </td>
        <td className="px-2 py-1.5">
          <div className="w-20">
            <ScoreBar score={consensus.score} />
            <span className="text-[9px] text-terminal-muted">{consensus.score}</span>
          </div>
        </td>
        <td className="px-2 py-1.5 font-mono text-[10px] text-terminal-muted">
          {consensus.bullish} / {consensus.bearish} / {consensus.neutral}
        </td>
        <td className="px-2 py-1.5 text-terminal-muted text-[10px]">{expanded ? "▾" : "▸"}</td>
      </tr>
      {expanded && personaSignals.map((ps, i) => (
        <tr key={`${consensus.symbol}-${ps.persona}-${i}`} className="border-b border-terminal-border/20 bg-terminal-bg/20">
          <td className="px-2 py-1" colSpan={5}>
            <div className="flex items-start gap-2 px-2 py-0.5">
              <span className={`shrink-0 font-mono text-[9px] uppercase ${SIGNAL_COLORS[ps.signal] ?? ""}`}>
                [{ps.signal}]
              </span>
              <span className="font-mono text-[9px] text-terminal-accent">{ps.persona}</span>
              <span className="text-[9px] text-terminal-muted">conf {ps.confidence}%</span>
              <span className="text-[11px] text-terminal-text">{ps.reason}</span>
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

function ScorecardStrip({ personas, loaded }: { personas: ScorecardPersona[]; loaded: boolean }) {
  const [evaluating, setEvaluating] = useState(false);
  const [sc, setSc] = useState({ personas: [] as ScorecardPersona[], loaded: false as boolean });

  if (loaded) {
    if (!sc.personas.length) return null;
    return (
      <div className="mt-2 flex items-center gap-3 rounded border border-terminal-border/60 bg-terminal-panel/60 px-2.5 py-1.5">
        <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-terminal-muted">Scorecard</span>
        {sc.personas.map((p) => (
          <div key={p.id} className="flex items-center gap-1">
            <span className="text-[10px] text-terminal-text">{p.label}</span>
            <span className="font-mono text-[9px] text-terminal-muted">{p.evaluated}</span>
            <span className={`font-mono text-[9px] ${p.accuracy != null ? "text-terminal-pos" : "text-terminal-muted"}`}>
              {p.accuracy != null ? `${(p.accuracy * 100).toFixed(0)}%` : "—"}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2 rounded border border-terminal-border/60 bg-terminal-panel/60 px-2.5 py-1.5">
      <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-terminal-muted">Scorecard</span>
      <button
        onClick={async () => {
          setEvaluating(true);
          try {
            await evaluateSignals(10);
          } catch { /* silent */ } finally {
            setEvaluating(false);
          }
        }}
        disabled={evaluating}
        className="rounded border border-terminal-accent/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-terminal-accent transition-colors hover:bg-terminal-accent/10 disabled:opacity-40"
      >
        {evaluating ? "Evaluating…" : "Evaluate now"}
      </button>
    </div>
  );
}