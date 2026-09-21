import { useEffect, useState } from "react";

import "../agentConsole.css";
import { useStockStore } from "../../store/stockStore";
import { useAgentStore } from "../agentStore";
import { buildScreenContext } from "../screenContext";
import { listThreads, deleteThread, type ThreadItem } from "../../api/agentExtras";
import { ArtifactCanvas } from "./ArtifactCanvas";
import { ChatThread } from "./ChatThread";
import { MemoryPanel } from "./MemoryPanel";

function ModeToggle({ active, label, onToggle, title }: { active: boolean; label: string; onToggle: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={`Toggle ${label} mode`}
      title={title}
      className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide transition-colors ${
        active
          ? "border-terminal-accent bg-terminal-accent text-terminal-bg"
          : "border-terminal-border text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
      }`}
    >
      {label}
    </button>
  );
}

function ThreadsPanel({ onSelect, onClose }: { onSelect: (t: ThreadItem) => void; onClose: () => void }) {
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    listThreads()
      .then((r: { items: ThreadItem[] }) => setThreads(r.items))
      .catch((err: unknown) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteThread(id);
      setThreads((prev) => prev.filter((t) => t.thread_id !== id));
    } catch { /* silent */ }
  };

  return (
    <div className="absolute left-0 top-full z-50 mt-1 w-64 max-h-64 overflow-y-auto rounded border border-terminal-border bg-terminal-panel shadow-lg">
      {loading && <div className="px-3 py-2 text-[11px] text-terminal-muted">Loading…</div>}
      {error && <div className="px-3 py-2 text-[11px] text-terminal-neg">{error}</div>}
      {!loading && !error && threads.length === 0 && (
        <div className="px-3 py-2 text-[11px] text-terminal-muted">No threads yet.</div>
      )}
      {threads.map((t) => (
        <div
          key={t.thread_id}
          onClick={() => onSelect(t)}
          className="flex items-center justify-between border-b border-terminal-border/40 px-3 py-2 hover:bg-terminal-bg/60 cursor-pointer"
        >
          <div className="min-w-0">
            <div className="truncate text-[11px] text-terminal-text font-medium">{t.title || "Untitled"}</div>
            <div className="text-[9px] text-terminal-muted">{t.message_count} messages · {t.updated_at}</div>
          </div>
          <button
            onClick={(e) => handleDelete(e, t.thread_id)}
            className="ml-2 shrink-0 text-[10px] text-terminal-muted hover:text-terminal-neg"
            title="Delete thread"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export function AgentConsole() {
  const open = useAgentStore((s) => s.open);
  const running = useAgentStore((s) => s.running);
  const debate = useAgentStore((s) => s.debate);
  const strategy = useAgentStore((s) => s.strategy);
  const screener = useAgentStore((s) => s.screener);
  const ensemble = useAgentStore((s) => s.ensemble);
  const threadId = useAgentStore((s) => s.threadId);
  const messages = useAgentStore((s) => s.messages);
  const artifacts = useAgentStore((s) => s.artifacts);
  const toggleOpen = useAgentStore((s) => s.toggleOpen);
  const setOpen = useAgentStore((s) => s.setOpen);
  const toggleDebate = useAgentStore((s) => s.toggleDebate);
  const toggleStrategy = useAgentStore((s) => s.toggleStrategy);
  const toggleScreener = useAgentStore((s) => s.toggleScreener);
  const toggleEnsemble = useAgentStore((s) => s.toggleEnsemble);
  const startRun = useAgentStore((s) => s.startRun);
  const newThread = useAgentStore((s) => s.newThread);
  const loadThread = useAgentStore((s) => s.loadThread);
  // Subscribe to the active ticker so the context chip re-renders on symbol change.
  useStockStore((s) => s.ticker);
  const contextSymbol = buildScreenContext().symbol;
  const [draft, setDraft] = useState("");
  const [showThreads, setShowThreads] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const activeModel = [...messages].reverse().find((message) => message.role === "assistant")?.model;
  const modelLabel = activeModel?.replace(/^.*\//, "").replace(/:free$/, "");

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "j") {
        ev.preventDefault();
        toggleOpen();
      } else if (ev.key === "Escape" && useAgentStore.getState().open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleOpen, setOpen]);

  const submit = () => {
    const text = draft.trim();
    if (!text || running) return;
    setDraft("");
    void startRun(text);
  };

  return (
    <aside
      className={`ot-agent-panel${open ? "" : " ot-agent-panel--closed"}`}
      role="dialog"
      aria-label="Agent Console"
      aria-hidden={!open}
    >
      <header
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "var(--ot-space-2) var(--ot-space-3)",
          borderBottom: "1px solid var(--ot-color-border-default)",
          fontWeight: "var(--ot-font-weight-semibold)", color: "var(--ot-color-text-primary)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--ot-space-2)" }}>
          <span>Agent</span>
          <ModeToggle active={debate} label="Debate" onToggle={toggleDebate} title="Multi-agent debate: analyst team → bull vs bear → portfolio-manager decision" />
          <ModeToggle active={strategy} label="Strategy Lab" onToggle={toggleStrategy} title="Strategy Lab: bounded, read-only backtest iteration with out-of-sample validation" />
          <ModeToggle active={screener} label="Screener" onToggle={toggleScreener} title="Screen membership: which built-in screens this stock qualifies under" />
          <ModeToggle active={ensemble} label="Ensemble" onToggle={toggleEnsemble} title="Ensemble: multiple personas analyse a basket of symbols" />
          <div style={{ display: "flex", gap: "var(--ot-space-1)" }}>
            <button
              type="button"
              onClick={newThread}
              title="Start a new thread"
              className="rounded border border-terminal-border px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-terminal-muted hover:text-terminal-text transition-colors"
            >
              New thread
            </button>
            <button
              type="button"
              onClick={() => setShowThreads((v) => !v)}
              title="View threads"
              className="rounded border border-terminal-border px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-terminal-muted hover:text-terminal-text transition-colors"
            >
              Threads
            </button>
          </div>
          {showThreads && (
            <ThreadsPanel
              onSelect={(t) => {
                void loadThread(t.thread_id);
                setShowThreads(false);
              }}
              onClose={() => setShowThreads(false)}
            />
          )}
          {contextSymbol ? (
            <span
              title={`Default subject: ${contextSymbol} (the stock you have open)`}
              className="rounded border border-terminal-accent/50 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-terminal-accent"
            >
              ▦ {contextSymbol}
            </span>
          ) : null}
          {modelLabel ? (
            <span
              title="Model handling this request"
              className="rounded border border-terminal-border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-terminal-muted"
            >
              {modelLabel}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close agent console"
          style={{ background: "transparent", border: "none", color: "var(--ot-color-text-muted)", cursor: "pointer", fontSize: 16 }}
        >
          ✕
        </button>
      </header>

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {showMemory && <MemoryPanel symbol={contextSymbol ?? null} />}
        <ChatThread messages={messages} proposalReplacements={(m) => {
          return m.steps
            .filter((s) => s.name.startsWith("propose_") && s.result && typeof s.result === "object")
            .map((s) => {
              const r = s.result as { proposal_id?: string; type?: string; summary?: string; payload?: unknown; status?: string; expires_at?: string };
              if (!r.proposal_id) return null as unknown as { step: typeof s; proposal: { proposal_id: string; type: string; summary: string; payload: unknown; status: string; expires_at: string } };
              return { step: s, proposal: r } as { step: typeof s; proposal: { proposal_id: string; type: string; summary: string; payload: unknown; status: string; expires_at: string } };
            })
            .filter(Boolean) as { step: typeof m.steps[number]; proposal: { proposal_id: string; type: string; summary: string; payload: unknown; status: string; expires_at: string } }[];
        }} />
        <ArtifactCanvas artifacts={artifacts} />
      </div>

      <div style={{ display: "flex", gap: "var(--ot-space-2)", padding: "var(--ot-space-2)", borderTop: "1px solid var(--ot-color-border-default)" }}>
        <button
          type="button"
          onClick={() => setShowMemory((v) => !v)}
          className={`shrink-0 rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
            showMemory
              ? "border-terminal-accent text-terminal-accent"
              : "border-terminal-border text-terminal-muted hover:text-terminal-text"
          }`}
        >
          Memory
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder={
            debate
              ? `Enter a ticker for multi-agent debate${contextSymbol ? ` (default ${contextSymbol})` : ""}…`
              : strategy
                ? `Enter a ticker for Strategy Lab${contextSymbol ? ` (default ${contextSymbol})` : ""}…`
              : ensemble
                ? `Enter symbols for ensemble analysis${contextSymbol ? ` (default ${contextSymbol})` : ""}…`
              : contextSymbol
                ? `Ask about ${contextSymbol} or any stock…`
                : "Ask the agent to find or analyze stocks…"
          }
          aria-label="Agent prompt"
          style={{
            flex: 1, background: "var(--ot-color-canvas-elevated)",
            border: "1px solid var(--ot-color-border-default)", borderRadius: "var(--ot-radius-sm)",
            color: "var(--ot-color-text-primary)", fontFamily: "var(--ot-font-ui)",
            padding: "var(--ot-space-2)",
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={running}
          style={{
            background: "var(--ot-color-accent-primary)", color: "var(--ot-color-text-inverse)",
            border: "none", borderRadius: "var(--ot-radius-sm)", padding: "0 var(--ot-space-3)",
            cursor: running ? "default" : "pointer", opacity: running ? 0.6 : 1,
            fontWeight: "var(--ot-font-weight-semibold)",
          }}
        >
          {running ? "…" : "Send"}
        </button>
      </div>
    </aside>
  );
}