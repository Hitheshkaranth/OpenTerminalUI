import { useContext, useEffect, useState } from "react";
import { X } from "lucide-react";

import "../agentConsole.css";
import { AuthContextRef } from "../../contexts/AuthContext";
import { useStockStore } from "../../store/stockStore";
import { useAgentStore } from "../agentStore";
import { buildScreenContext } from "../screenContext";
import { listThreads, deleteThread, type ThreadItem } from "../../api/agentExtras";
import { AgentAvatar, AiWorkingBeam } from "../../components/ai/AiVisuals";
import { ArtifactCanvas } from "./ArtifactCanvas";
import { ChatThread } from "./ChatThread";
import { MemoryPanel } from "./MemoryPanel";
import { exportRun } from "../agentApi";
import { downloadJson } from "../../lib/downloadJson";
import { createDossier, emptyDossier, dossierMarket } from "../../api/researchDossiers";
import { extractApiErrorMessage } from "../../api/base";
import { useWorkspaceContextStore } from "../workspaceContextStore";

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
  const auth = useContext(AuthContextRef);
  useEffect(() => { if (auth && !auth.isInitializing) void useAgentStore.getState().setAuthenticatedUser(auth.user?.id ?? null); }, [auth?.user?.id, auth?.isInitializing]);
  const open = useAgentStore((s) => s.open);
  const running = useAgentStore((s) => s.running);
  const transportBusy = useAgentStore((s) => s.transportBusy);
  const activeRunId = useAgentStore((s) => s.activeRunId);
  const runNotice = useAgentStore((s) => s.runNotice);
  const cancelActiveRun = useAgentStore((s) => s.cancelActiveRun);
  const reconnectRun = useAgentStore((s) => s.reconnectRun);
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
  const [view, setView] = useState<"overlay" | "docked" | "expanded">("overlay");
  const [saveResearch, setSaveResearch] = useState(false);
  const [researchSymbol, setResearchSymbol] = useState("");
  const [researchTitle, setResearchTitle] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const [savedDossierId, setSavedDossierId] = useState<string | null>(null);
  useWorkspaceContextStore((s) => s.selection);
  const context = buildScreenContext();
  const latestAnswer = [...messages].reverse().find((message) => message.role === "assistant" && message.content && !message.pending);
  const activeModel = [...messages].reverse().find((message) => message.role === "assistant")?.model;
  const modelLabel = activeModel?.replace(/^.*\//, "").replace(/:free$/, "");

  useEffect(() => {
    document.body.classList.toggle("ot-agent-docked", open && view === "docked");
    return () => document.body.classList.remove("ot-agent-docked");
  }, [open, view]);

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
      className={`ot-agent-panel ot-agent-panel--${view}${open ? "" : " ot-agent-panel--closed"}`}
      role="dialog"
      aria-label="Agent Console"
      aria-hidden={!open}
      {...(!open ? { inert: "" } as Record<string, string> : {})}
    >
      <header
        style={{
          // Close stays pinned top-right; the controls wrap instead of overflowing the fixed-width panel
          // (they pushed the symbol/model chips and the ✕ off-screen at any window size).
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          gap: "var(--ot-space-2)",
          padding: "var(--ot-space-2) var(--ot-space-3)",
          borderBottom: "1px solid var(--ot-color-border-default)",
          fontWeight: "var(--ot-font-weight-semibold)", color: "var(--ot-color-text-primary)",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--ot-space-2)", rowGap: 6, flex: 1, minWidth: 0 }}>
          <AgentAvatar busy={running} size={24} />
          <span>Agent</span>
          <select aria-label="Agent panel layout" value={view} onChange={(e) => setView(e.target.value as typeof view)} className="rounded border border-terminal-border bg-terminal-panel px-2 py-1 text-xs">
            <option value="overlay">Side panel</option><option value="docked">Dock beside research</option><option value="expanded">Expanded research</option>
          </select>
          <ModeToggle active={debate} label="Debate" onToggle={toggleDebate} title="Multi-agent debate: analyst team → bull vs bear → portfolio-manager decision" />
          <ModeToggle active={strategy} label="Strategy Lab" onToggle={toggleStrategy} title="Strategy Lab: bounded, read-only backtest iteration with out-of-sample validation" />
          <ModeToggle active={screener} label="Screener" onToggle={toggleScreener} title="Screen membership: which built-in screens this stock qualifies under" />
          <ModeToggle active={ensemble} label="Ensemble" onToggle={toggleEnsemble} title="Ensemble: multiple personas analyse a basket of symbols" />
          <div style={{ display: "flex", gap: "var(--ot-space-1)" }}>
            <button
              type="button"
              onClick={newThread}
              disabled={transportBusy}
              title="Start a new thread"
              className="rounded border border-terminal-border px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-terminal-muted hover:text-terminal-text transition-colors"
            >
              New thread
            </button>
            <button
              type="button"
              onClick={() => setShowThreads((v) => !v)}
              disabled={transportBusy}
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
              className="max-w-[16rem] truncate rounded border border-terminal-border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-terminal-muted"
            >
              {modelLabel}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close agent console"
          title="Close (Ctrl+J)"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-terminal-muted transition-colors hover:bg-terminal-bg hover:text-terminal-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-terminal-accent"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </header>

      {(context.selected_symbols?.length || context.portfolio_id || context.dossier_id) && <div className="border-b border-terminal-border px-3 py-2 text-xs text-terminal-muted">
        Context: {context.selected_symbols?.join(", ")}{context.portfolio_id ? " · Selected portfolio" : ""}{context.dossier_id ? " · Research dossier" : ""}{context.universe ? ` · ${context.universe}` : ""}
      </div>}
      {activeRunId && <div className="flex flex-wrap gap-2 border-b border-terminal-border p-2 text-xs">
        {transportBusy ? <button className="rounded border border-terminal-border px-2 py-1" onClick={() => void cancelActiveRun()}>Stop run</button> : <>
          <button className="rounded border border-terminal-border px-2 py-1" onClick={() => void reconnectRun()}>Reconnect / replay</button>
          <button className="rounded border border-terminal-border px-2 py-1" onClick={() => void reconnectRun(true)}>Resume interrupted run</button>
        </>}
        <button className="rounded border border-terminal-border px-2 py-1" onClick={async () => { try { downloadJson(await exportRun(activeRunId), `research-run-${activeRunId}.json`); } catch (e) { setActionNotice(extractApiErrorMessage(e, "Export failed.")); } }}>Export run evidence</button>
      </div>}
      {(runNotice || actionNotice) && <p role="status" className="border-b border-terminal-border p-3 text-sm">{runNotice || actionNotice}</p>}

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {showMemory && <MemoryPanel symbol={contextSymbol ?? null} />}
        <ChatThread messages={messages} proposalReplacements={(m) => {
          return m.steps
            .filter((s) => s.name.startsWith("propose_") && s.result && typeof s.result === "object")
            .map((s) => {
              const wrapped = s.result as { ok?: boolean; data?: unknown };
              const r = (wrapped.ok === true ? wrapped.data : s.result) as { proposal_id?: string; type?: string; summary?: string; payload?: unknown; status?: string; expires_at?: string };
              if (!r.proposal_id) return null as unknown as { step: typeof s; proposal: { proposal_id: string; type: string; summary: string; payload: unknown; status: string; expires_at: string } };
              return { step: s, proposal: { ...r, type: r.type || s.name.replace(/^propose_/, ""), payload: r.payload || {}, status: r.status || "pending", expires_at: r.expires_at || "" } } as { step: typeof s; proposal: { proposal_id: string; type: string; summary: string; payload: unknown; status: string; expires_at: string } };
            })
            .filter(Boolean) as { step: typeof m.steps[number]; proposal: { proposal_id: string; type: string; summary: string; payload: unknown; status: string; expires_at: string } }[];
        }} />
        <ArtifactCanvas artifacts={artifacts} />
        {latestAnswer && !transportBusy && <div className="border-t border-terminal-border p-3">
          <button className="rounded border border-terminal-border px-3 py-2 text-sm" onClick={() => { setSaveResearch(!saveResearch); setResearchSymbol(contextSymbol || context.selected_symbols?.[0] || ""); setResearchTitle(`Research: ${contextSymbol || "company"}`); }}>Save answer to research dossier</button>
          {savedDossierId && <a className="ml-3 text-sm text-terminal-accent underline" href={`/equity/research-dossiers?id=${encodeURIComponent(savedDossierId)}`}>Open saved dossier</a>}
          {saveResearch && <form className="mt-3 space-y-3" onSubmit={async (event) => {
            event.preventDefault(); setSaveBusy(true);
            try {
              const dossier = await createDossier({ ...emptyDossier(), title: researchTitle, symbol: researchSymbol, market: dossierMarket(context.market), thesis: latestAnswer.content,
                linked_run_ids: activeRunId ? [activeRunId] : [],
                evidence: (latestAnswer.grounding?.sources || []).map((source) => ({ id: source.id, claim: `Evidence returned by ${source.tool}`, stance: "neutral", source_title: `${source.provider} · ${source.quality}`, observed_at: source.as_of || undefined })),
              });
              setSavedDossierId(dossier.id); setSaveResearch(false); setActionNotice("Answer saved as a draft thesis. Review its assumptions and evidence.");
            } catch (e) { setActionNotice(extractApiErrorMessage(e, "Unable to save research.")); }
            finally { setSaveBusy(false); }
          }}>
            <label className="block text-xs">Research title<input required className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg p-2 text-sm" value={researchTitle} onChange={(e) => setResearchTitle(e.target.value)} /></label>
            <label className="block text-xs">Symbol<input required className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg p-2 text-sm" value={researchSymbol} onChange={(e) => setResearchSymbol(e.target.value.toUpperCase())} /></label>
            <button disabled={saveBusy} className="rounded border border-terminal-border px-3 py-2 text-sm">{saveBusy ? "Saving…" : "Save draft thesis"}</button>
          </form>}
        </div>}
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
        {/* The beam runs along the composer while the agent works on the request. */}
        <AiWorkingBeam active={running} className="min-w-0 flex-1">
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
              width: "100%", background: "var(--ot-color-canvas-elevated)",
              border: "1px solid var(--ot-color-border-default)", borderRadius: "var(--ot-radius-sm)",
              color: "var(--ot-color-text-primary)", fontFamily: "var(--ot-font-ui)",
              padding: "var(--ot-space-2)",
            }}
          />
        </AiWorkingBeam>
        <button
          type="button"
          onClick={submit}
          disabled={running || transportBusy}
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
