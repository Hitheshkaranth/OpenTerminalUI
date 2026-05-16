import { useCallback, useState } from "react";

import { terminalColors } from "../../theme/terminal";

export type InsightSection = {
  title: string;
  tone: "positive" | "negative" | "neutral";
  points: string[];
};

export type InsightData = {
  engine: string;
  model: string;
  summary: string;
  sections: InsightSection[];
  generated_at?: string;
};

type Props = {
  title: string;
  description?: string;
  /** Resolves the insight. Invoked only when the user clicks Generate. */
  fetcher: () => Promise<InsightData>;
};

function toneColor(tone: InsightSection["tone"]): string {
  if (tone === "positive") return terminalColors.positive;
  if (tone === "negative") return terminalColors.negative;
  return terminalColors.muted;
}

/**
 * On-demand AI analysis card backed by the local Gemma model. Kept lazy because
 * local LLM inference is slow — nothing runs until the user asks for it.
 */
export function AiInsightCard({ title, description, fetcher }: Props) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [data, setData] = useState<InsightData | null>(null);

  const run = useCallback(async () => {
    setStatus("loading");
    setData(null);
    try {
      const result = await fetcher();
      setData(result);
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }, [fetcher]);

  const engineLive = data?.engine === "lmstudio";
  const engineLabel = engineLive ? `Gemma · ${data?.model}` : "LM Studio offline";

  return (
    <section className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {description && <div className="text-[11px] text-terminal-muted">{description}</div>}
        </div>
        <div className="flex items-center gap-2">
          {status === "done" && (
            <span
              className="rounded border px-1.5 py-0.5 text-[10px] font-semibold"
              style={{
                borderColor: engineLive ? terminalColors.accent : terminalColors.border,
                color: engineLive ? terminalColors.accent : terminalColors.muted,
              }}
            >
              {engineLabel}
            </span>
          )}
          <button
            className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-text hover:border-terminal-accent disabled:opacity-50"
            onClick={run}
            disabled={status === "loading"}
          >
            {status === "loading" ? "Analyzing…" : status === "idle" ? "Generate" : "Regenerate"}
          </button>
        </div>
      </div>

      {status === "idle" && (
        <div className="mt-2 text-[11px] text-terminal-muted">
          Runs locally on the Gemma model via LM Studio — analysis can take a minute.
        </div>
      )}

      {status === "loading" && (
        <div className="mt-3 space-y-2">
          <div className="text-[11px] text-terminal-muted">
            Generating analysis with the local Gemma model…
          </div>
          <div className="h-24 animate-pulse rounded bg-terminal-bg" />
        </div>
      )}

      {status === "error" && (
        <div className="mt-3 rounded border border-terminal-neg bg-terminal-neg/10 p-2 text-xs text-terminal-neg">
          Could not generate AI analysis. Check that LM Studio is running, then retry.
        </div>
      )}

      {status === "done" && data && (
        <div className="mt-3 space-y-3">
          {data.summary && (
            <p className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs text-terminal-text">
              {data.summary}
            </p>
          )}
          {data.sections.map((section, idx) => (
            <div key={`${section.title}-${idx}`}>
              <div
                className="mb-1 text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: toneColor(section.tone) }}
              >
                {section.title}
              </div>
              <ul className="space-y-1">
                {section.points.map((point, pIdx) => (
                  <li key={pIdx} className="flex gap-2 text-xs text-terminal-text">
                    <span style={{ color: toneColor(section.tone) }}>▸</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {data.engine !== "lmstudio" && !data.sections.length && (
            <div className="text-[11px] text-terminal-muted">
              Start LM Studio with a Gemma model loaded, then click Regenerate.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
