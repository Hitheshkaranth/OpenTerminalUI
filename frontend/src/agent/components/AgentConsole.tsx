import { useEffect, useState } from "react";

import "../agentConsole.css";
import { useStockStore } from "../../store/stockStore";
import { useAgentStore } from "../agentStore";
import { buildScreenContext } from "../screenContext";
import { ArtifactCanvas } from "./ArtifactCanvas";
import { ChatThread } from "./ChatThread";

export function AgentConsole() {
  const open = useAgentStore((s) => s.open);
  const running = useAgentStore((s) => s.running);
  const debate = useAgentStore((s) => s.debate);
  const messages = useAgentStore((s) => s.messages);
  const artifacts = useAgentStore((s) => s.artifacts);
  const toggleOpen = useAgentStore((s) => s.toggleOpen);
  const setOpen = useAgentStore((s) => s.setOpen);
  const toggleDebate = useAgentStore((s) => s.toggleDebate);
  const startRun = useAgentStore((s) => s.startRun);
  // Subscribe to the active ticker so the context chip re-renders on symbol change.
  useStockStore((s) => s.ticker);
  const contextSymbol = buildScreenContext().symbol;
  const [draft, setDraft] = useState("");

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
          <button
            type="button"
            onClick={toggleDebate}
            aria-pressed={debate}
            aria-label="Toggle multi-agent debate mode"
            title="Multi-agent debate: analyst team → bull vs bear → portfolio-manager decision"
            className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide transition-colors ${
              debate
                ? "border-terminal-accent bg-terminal-accent text-terminal-bg"
                : "border-terminal-border text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
            }`}
          >
            Debate
          </button>
          {contextSymbol ? (
            <span
              title={`Default subject: ${contextSymbol} (the stock you have open)`}
              className="rounded border border-terminal-accent/50 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-terminal-accent"
            >
              ▦ {contextSymbol}
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
        <ChatThread messages={messages} />
        <ArtifactCanvas artifacts={artifacts} />
      </div>

      <div style={{ display: "flex", gap: "var(--ot-space-2)", padding: "var(--ot-space-2)", borderTop: "1px solid var(--ot-color-border-default)" }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder={
            debate
              ? `Enter a ticker for multi-agent debate${contextSymbol ? ` (default ${contextSymbol})` : ""}…`
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
