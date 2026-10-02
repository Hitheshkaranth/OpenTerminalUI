// OWNER: agent H (swarm fi_v1). Placeholder wired into SecurityHub; replace the body, keep the export + props.
import { useEffect, useState } from "react";
import { ChevronDown, FileText } from "lucide-react";

import { fetchKnowledge, buildKnowledge, type ConcallSummary, type Citation, type Knowledge } from "../../api/filingsRag";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalBadge } from "../terminal/TerminalBadge";
import { GuidedEmptyState } from "../dashboard/GuidedEmptyState";
import { formatCitationLabel, formatKeyNumber, toneLabel, toneVariant } from "./presentation";

type Props = {
  symbol: string;
  market?: string;
};

function CitationsCollapsible({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState(false);
  if (!citations?.length) return null;
  return (
    <div className="border-t border-terminal-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-center gap-1 py-2 text-[11px] uppercase tracking-wide text-terminal-muted hover:text-terminal-text"
        aria-expanded={open}
      >
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        {open ? "Hide citations" : `${citations.length} citations`}
      </button>
      {open ? (
        <ul className="space-y-2 pb-2">
          {citations.map((c, i) => (
            <li key={`${c.doc_id}-${i}`} className="text-[11px] text-terminal-muted">
              {c.source_url ? (
                <a
                  href={/^[a-z]+:\/\//i.test(c.source_url) ? c.source_url : undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-terminal-accent"
                >
                  {formatCitationLabel(c)}
                </a>
              ) : (
                formatCitationLabel(c)
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ConcallCard({ summary }: { summary: ConcallSummary }) {
  return (
    <div className="rounded-sm border border-terminal-border bg-terminal-panel/70">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="max-w-[70%] truncate text-sm font-semibold text-terminal-text" title={summary.title}>
              {summary.title || "Concall summary"}
            </span>
            <TerminalBadge variant={toneVariant(summary.management_tone)} dot>
              {toneLabel(summary.management_tone)}
            </TerminalBadge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-terminal-muted">
            <span>{summary.period || "—"}</span>
            {summary.filed_at ? <span>· {summary.filed_at}</span> : null}
            {summary.engine ? <span>· {summary.engine}</span> : null}
          </div>
        </div>
      </div>

      <div className="border-t border-terminal-border px-3 py-2">
        {summary.highlights?.length ? (
          <ul className="space-y-1">
            {summary.highlights.map((h, i) => (
              <li key={`hl-${i}`} className="flex gap-2 text-xs text-terminal-text">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-terminal-accent" aria-hidden="true" />
                <span className="truncate">{h}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-terminal-muted">No highlights extracted.</p>
        )}
      </div>

      {summary.key_numbers?.length ? (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2">
          {summary.key_numbers.map((kn, i) => (
            <span key={`kn-${i}`} className="rounded-sm border border-terminal-border bg-terminal-bg px-1.5 py-0.5 text-[11px] text-terminal-muted">
              {formatKeyNumber(kn.label, kn.value, kn.unit)}
            </span>
          ))}
        </div>
      ) : null}

      {summary.qa_themes?.length ? (
        <div className="border-t border-terminal-border px-3 pt-2">
          <div className="mb-1.5 ot-type-label text-[10px] uppercase text-terminal-muted">Q&amp;A themes</div>
          <div className="flex flex-wrap gap-1.5">
            {summary.qa_themes.map((t, i) => (
              <span key={`th-${i}`} className="rounded-full bg-terminal-accent/10 px-2 py-0.5 text-[11px] text-terminal-accent">
                {t}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <CitationsCollapsible citations={summary.citations} />
    </div>
  );
}

export function ConcallSummaries({ symbol }: Props) {
  const [knowledge, setKnowledge] = useState<Knowledge | null>(null);
  const [building, setBuilding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) return;
    let active = true;
    setLoading(true);
    setError(null);
    fetchKnowledge(symbol)
      .then((payload) => {
        if (active) setKnowledge(payload);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Knowledge unavailable");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [symbol]);

  const rebuild = async () => {
    if (!symbol) return;
    setBuilding(true);
    setError(null);
    try {
      const next = await buildKnowledge(symbol, true);
      setKnowledge(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Build failed");
    } finally {
      setBuilding(false);
    }
  };

  const hasAny = Boolean(knowledge?.concalls?.length || knowledge?.guidance?.length);

  return (
    <TerminalPanel
      title="Concall Summaries"
      subtitle="Earnings-call takeaways"
      actions={
        hasAny ? null : (
          <TerminalButton size="sm" loading={building} onClick={rebuild}>
            Build Summaries
          </TerminalButton>
        )
      }
    >
      {error ? (
        <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-3 text-xs text-terminal-muted">
          {loading ? "Loading knowledge base…" : "Knowledge feed unavailable."}
        </div>
      ) : !knowledge || !hasAny ? (
        <GuidedEmptyState
          title="No call summaries yet"
          message="The knowledge base has not been built for this symbol. Build it to generate tone, highlights, key numbers and cited Q&amp;A themes for each earnings call."
          icon={<FileText size={16} />}
          actions={[{ label: "Build Summaries", onClick: rebuild }]}
        />
      ) : (
        <div className="grid gap-3">
          {knowledge.concalls?.map((summary) => (
            <ConcallCard key={summary.doc_id} summary={summary} />
          ))}
        </div>
      )}
    </TerminalPanel>
  );
}