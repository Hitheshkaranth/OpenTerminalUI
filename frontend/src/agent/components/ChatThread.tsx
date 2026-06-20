import { Markdown } from "./Markdown";
import type { AgentMessage, AgentPhase, AgentRoleNote } from "../types";

// Role → display label, short avatar glyph and accent tone. Mirrors the debate
// roles emitted by the backend; tones map to the home palette.
type Tone = "accent" | "pos" | "neg";
const ROLE_META: Record<string, { label: string; glyph: string; tone: Tone }> = {
  fundamental: { label: "Fundamental Analyst", glyph: "F", tone: "accent" },
  sentiment: { label: "Sentiment Analyst", glyph: "S", tone: "accent" },
  technical: { label: "Technical Analyst", glyph: "T", tone: "accent" },
  bull: { label: "Bull Case", glyph: "▲", tone: "pos" },
  bear: { label: "Bear Case", glyph: "▼", tone: "neg" },
};

const TONE = {
  accent: {
    text: "text-terminal-accent",
    border: "border-l-terminal-accent",
    avatar: "border-terminal-accent/40 bg-terminal-accent/15 text-terminal-accent",
  },
  pos: {
    text: "text-terminal-pos",
    border: "border-l-terminal-pos",
    avatar: "border-terminal-pos/40 bg-terminal-pos/10 text-terminal-pos",
  },
  neg: {
    text: "text-terminal-neg",
    border: "border-l-terminal-neg",
    avatar: "border-terminal-neg/40 bg-terminal-neg/10 text-terminal-neg",
  },
} as const;

// --- phase stepper -------------------------------------------------------
function PhaseStepper({ phases }: { phases: AgentPhase[] }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto py-1">
      {phases.map((p, i) => (
        <div key={p.key} className="flex items-center gap-1">
          {i > 0 ? <span className="h-px w-3 shrink-0 bg-terminal-accent/40" /> : null}
          <span className="flex items-center gap-1 whitespace-nowrap rounded-full border border-terminal-accent/40 bg-terminal-accent/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-terminal-accent">
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-terminal-accent text-[9px] font-bold text-terminal-bg">
              {i + 1}
            </span>
            {p.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// --- role card -----------------------------------------------------------
function RoleCard({ note }: { note: AgentRoleNote }) {
  const meta = ROLE_META[note.role] ?? { label: note.role, glyph: "•", tone: "accent" as Tone };
  const tone = TONE[meta.tone];
  return (
    <div
      className={`overflow-hidden rounded-md border border-l-2 border-terminal-border ${tone.border} bg-terminal-panel/80`}
    >
      <div className="flex items-center gap-2 border-b border-terminal-border/60 px-2.5 py-1.5">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded border font-mono text-[11px] font-bold ${tone.avatar}`}
        >
          {meta.glyph}
        </span>
        <span className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${tone.text}`}>
          {meta.label}
        </span>
      </div>
      <div className="px-2.5 py-2 text-xs leading-5 text-terminal-muted">
        <Markdown content={note.content} />
      </div>
    </div>
  );
}

// --- decision banner -----------------------------------------------------
type Decision = { verdict: string; conviction: number | null; rationale: string; body: string };

const VERDICT_COLOR: Record<string, string> = {
  BUY: "var(--ot-color-market-up)",
  SELL: "var(--ot-color-market-down)",
  HOLD: "var(--ot-color-feedback-warning)",
};

function parseDecision(content: string): Decision | null {
  // DECISION: BUY | CONVICTION: 70 | one-sentence rationale
  const m = content.match(/DECISION:\s*([A-Za-z ]+?)\s*\|\s*CONVICTION:\s*(\d{1,3})\s*\|\s*([^\n]*)/i);
  if (!m) return null;
  const verdict = m[1].trim().toUpperCase();
  const conviction = Math.max(0, Math.min(100, parseInt(m[2], 10)));
  const rationale = m[3].trim();
  // Everything before the DECISION line is the PM's supporting write-up.
  const body = content.slice(0, m.index).trim();
  return { verdict, conviction: Number.isFinite(conviction) ? conviction : null, rationale, body };
}

function DecisionBanner({ decision }: { decision: Decision }) {
  const color = VERDICT_COLOR[decision.verdict] ?? "var(--ot-color-accent-primary)";
  return (
    <div className="flex flex-col gap-2">
      {decision.body ? (
        <div className="rounded-md border border-terminal-border bg-terminal-panel/80 px-2.5 py-2 text-xs leading-5 text-terminal-muted">
          <Markdown content={decision.body} />
        </div>
      ) : null}
      <div
        className="rounded-md border bg-terminal-panel/90 p-3"
        style={{ borderColor: color, boxShadow: `0 0 0 1px ${color}22, 0 8px 24px ${color}14` }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="ot-type-panel-title uppercase tracking-[0.18em] text-terminal-muted">
              Portfolio Manager
            </span>
          </div>
          <span
            className="rounded px-2 py-0.5 font-mono text-xs font-bold uppercase tracking-wider"
            style={{ color: "var(--ot-color-text-inverse)", background: color }}
          >
            {decision.verdict}
          </span>
        </div>
        {decision.conviction != null ? (
          <div className="mt-2.5">
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wide text-terminal-muted">
              <span>Conviction</span>
              <span style={{ color }}>{decision.conviction}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-terminal-bg/70">
              <span
                className="block h-full rounded-full transition-all"
                style={{ width: `${decision.conviction}%`, background: color }}
              />
            </div>
          </div>
        ) : null}
        {decision.rationale ? (
          <p className="mt-2.5 text-[13px] leading-5 text-terminal-text">{decision.rationale}</p>
        ) : null}
      </div>
    </div>
  );
}

// --- assistant body ------------------------------------------------------
function AssistantBody({ content }: { content: string }) {
  const decision = parseDecision(content);
  if (decision) return <DecisionBanner decision={decision} />;
  return <Markdown content={content} />;
}

export function ChatThread({ messages }: { messages: AgentMessage[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--ot-space-3)", padding: "var(--ot-space-3)" }}>
      {messages.map((m) => (
        <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: "var(--ot-space-1)" }}>
          <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--ot-color-text-muted)" }}>
            {m.role}
          </span>
          {m.steps.length > 0 && (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              {m.steps.map((s) => (
                <li
                  key={s.id}
                  style={{
                    fontFamily: "var(--ot-font-data)", fontSize: 11,
                    color: s.isError ? "var(--ot-color-feedback-error)" : "var(--ot-color-text-secondary)",
                  }}
                >
                  {s.isError ? "✗ failed " : "→ ran "}{s.name}
                </li>
              ))}
            </ul>
          )}
          {(m.phases ?? []).length > 0 && <PhaseStepper phases={m.phases} />}
          {(m.roles ?? []).length > 0 && (
            <div className="flex flex-col gap-1.5">
              {(m.roles ?? []).map((r, i) => (
                <RoleCard key={`${m.id}-${r.role}-${i}`} note={r} />
              ))}
            </div>
          )}
          {m.pending && !m.content ? (
            <div style={{ fontFamily: "var(--ot-font-ui)", fontSize: 13 }}>
              <span style={{ color: "var(--ot-color-text-muted)" }}>Thinking…</span>
            </div>
          ) : m.role === "assistant" ? (
            m.content ? <AssistantBody content={m.content} /> : null
          ) : (
            <div
              style={{
                fontFamily: "var(--ot-font-ui)", fontSize: 13, lineHeight: 1.5,
                color: "var(--ot-color-text-primary)", whiteSpace: "pre-wrap",
              }}
            >
              {m.content}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
