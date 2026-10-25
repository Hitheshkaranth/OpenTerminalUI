import { create } from "zustand";

import { getThread as fetchThread } from "../api/agentExtras";
import { cancelRun, createRun, getRun, resumeRun, streamRun } from "./agentApi";
import { buildScreenContext } from "./screenContext";
import type { AgentArtifact, AgentEvent, AgentMessage } from "./types";

let seq = 0;
let streamController: AbortController | null = null;
let generation = 0;
let operation: "stream" | "load" | "recover" | null = null;
const recoveryKey = (owner: string) => `ot:agent:recovery:v1:${encodeURIComponent(owner)}`;
function clearRecovery(owner: string | null) {
  if (!owner) return;
  try { sessionStorage.removeItem(recoveryKey(owner)); } catch { /* storage can be disabled */ }
}
function saveRecovery(owner: string | null, runId: string, threadId: string) {
  if (!owner) return;
  try { sessionStorage.setItem(recoveryKey(owner), JSON.stringify({ version: 1, owner, runId, threadId })); } catch { /* optional */ }
}
function readRecovery(owner: string): { runId: string; threadId: string } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(recoveryKey(owner)) || "null");
    return value?.version === 1 && value.owner === owner && typeof value.runId === "string" && typeof value.threadId === "string"
      ? { runId: value.runId, threadId: value.threadId } : null;
  } catch { return null; }
}
function invalidateOperation() {
  generation += 1;
  streamController?.abort();
  streamController = null;
  operation = null;
  return generation;
}
const nextId = () => `m${Date.now()}_${seq++}`;

interface AgentState {
  authenticatedUserId: string | null;
  setAuthenticatedUser: (userId: string | null) => Promise<void>;
  open: boolean;
  running: boolean;
  debate: boolean;
  strategy: boolean;
  screener: boolean;
  ensemble: boolean;
  threadId: string;
  messages: AgentMessage[];
  artifacts: AgentArtifact[];
  activeRunId: string | null;
  eventCursor: number;
  transportBusy: boolean;
  runNotice: string | null;
  cancelActiveRun: () => Promise<void>;
  reconnectRun: (resume?: boolean) => Promise<void>;
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  toggleDebate: () => void;
  toggleStrategy: () => void;
  toggleScreener: () => void;
  toggleEnsemble: () => void;
  newThread: () => void;
  loadThread: (threadId: string) => Promise<void>;
  runScreenerFor: (ticker: string) => Promise<void>;
  appendUserAndPending: (prompt: string) => void;
  applyEvent: (event: AgentEvent) => void;
  startRun: (prompt: string) => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  authenticatedUserId: null,
  setAuthenticatedUser: async (userId) => {
    if (get().authenticatedUserId === userId) return;
    const ticket = invalidateOperation();
    set({ authenticatedUserId: userId, running: false, transportBusy: false, open: false,
      messages: [], artifacts: [], activeRunId: null, eventCursor: 0, threadId: crypto.randomUUID(), runNotice: null });
    if (!userId) return;
    const saved = readRecovery(userId);
    if (!saved) return;
    operation = "recover";
    set({ transportBusy: true });
    try {
      // The server rechecks ownership before any prompt or answer is displayed.
      const run = await getRun(saved.runId);
      if (generation !== ticket || get().authenticatedUserId !== userId) return;
      const threadId = run.thread_id || saved.threadId;
      const pending = run.status === "running" || run.status === "pending";
      set({ threadId, activeRunId: run.run_id, eventCursor: 0,
        messages: [
          { id: nextId(), role: "user", content: run.prompt, steps: [], phases: [], roles: [], pending: false },
          { id: nextId(), role: "assistant", content: run.final || "", steps: [], phases: [], roles: [], pending },
        ],
        runNotice: run.status === "done" ? "Saved run restored. Replay to inspect its evidence."
          : pending ? "An unfinished run is saved. Reconnect to follow its progress."
            : "Saved run restored. Resume to continue with its recorded evidence.",
      });
      if (run.status === "done") clearRecovery(userId);
    } catch (error) {
      if (generation === ticket && get().authenticatedUserId === userId) {
        const status = (error as { response?: { status?: number } }).response?.status;
        if (status === 403 || status === 404) clearRecovery(userId);
        set({ runNotice: "The saved run could not be loaded. Reopen after reconnecting to try again." });
      }
    } finally {
      if (generation === ticket) { operation = null; set({ transportBusy: false }); }
    }
  },
  open: false,
  running: false,
  debate: false,
  strategy: false,
  screener: false,
  ensemble: false,
  threadId: crypto.randomUUID(),
  messages: [],
  artifacts: [],
  activeRunId: null,
  eventCursor: 0,
  transportBusy: false,
  runNotice: null,

  toggleOpen: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  toggleDebate: () => set((s) => ({ debate: !s.debate, strategy: false, screener: false, ensemble: false })),
  toggleStrategy: () => set((s) => ({ strategy: !s.strategy, debate: false, screener: false, ensemble: false })),
  toggleScreener: () => set((s) => ({ screener: !s.screener, debate: false, strategy: false, ensemble: false })),
  toggleEnsemble: () => set((s) => ({ ensemble: !s.ensemble, debate: false, strategy: false, screener: false })),

  newThread: () => {
    if (get().transportBusy && operation === "stream") return;
    invalidateOperation();
    clearRecovery(get().authenticatedUserId);
    set({ threadId: crypto.randomUUID(), messages: [], artifacts: [], running: false, transportBusy: false,
      activeRunId: null, eventCursor: 0, runNotice: null });
  },

  loadThread: async (threadId) => {
    if (get().transportBusy && operation === "stream") return;
    const ticket = invalidateOperation();
    const owner = get().authenticatedUserId;
    operation = "load";
    set({ transportBusy: true, runNotice: null });
    try {
      const data = await fetchThread(threadId);
      if (ticket !== generation || owner !== get().authenticatedUserId) return;
      const messages: AgentMessage[] = data.messages.map((m) => ({ id: m.id, role: m.role,
        content: m.content, steps: [], phases: [], roles: [], pending: false,
        ...(m.role === "assistant" ? { grounding: m.grounding ?? undefined } : {}),
      }));
      const latestRun = [...data.messages].reverse().find((m) => m.run_id)?.run_id;
      set({ messages, threadId, artifacts: [], running: false, activeRunId: latestRun ?? null, eventCursor: 0, runNotice: null });
    } catch (error) {
      if (ticket === generation) set({ runNotice: `Unable to load thread: ${(error as Error).message}` });
    } finally {
      if (ticket === generation) { operation = null; set({ transportBusy: false }); }
    }
  },

  appendUserAndPending: (prompt) =>
    set((s) => ({
      messages: [
        ...s.messages,
        { id: nextId(), role: "user", content: prompt, steps: [], phases: [], roles: [], pending: false },
        { id: nextId(), role: "assistant", content: "", steps: [], phases: [], roles: [], pending: true, model: undefined },
      ],
    })),

  applyEvent: (event) => {
    if (event.type === "artifact") {
      set((s) => ({
        artifacts: [
          ...s.artifacts,
          { id: nextId(), kind: event.kind, name: event.name, data: event.data },
        ],
      }));
      return;
    }
    set((s) => {
      const messages = s.messages.slice();
      const idx = messages.length - 1;
      if (idx < 0 || messages[idx].role !== "assistant") return s;
      const msg = {
        ...messages[idx],
        steps: messages[idx].steps.slice(),
        phases: messages[idx].phases.slice(),
        roles: messages[idx].roles.slice(),
      };

      switch (event.type) {
        case "model":
          msg.model = event.name;
          break;
        case "status":
          msg.status = event.text;
          break;
        case "tool_call":
          // A concrete step supersedes the transient model-layer status line.
          msg.status = undefined;
          msg.steps.push({ id: event.id, name: event.name, isError: false });
          break;
        case "tool_result": {
          // Replace the step object (don't mutate the shared prior-state object).
          const si = msg.steps.findIndex((st) => st.id === event.id);
          if (si !== -1) msg.steps[si] = { ...msg.steps[si], isError: event.is_error, result: event.result };
          break;
        }
        case "phase":
          msg.phases.push({ key: event.key, label: event.label });
          break;
        case "role_message":
          msg.roles.push({ role: event.role, content: event.content });
          break;
        case "token":
          msg.content += event.text;
          break;
        case "grounding": {
          const { type: _t, target, role_index, ...report } = event;
          if (target === "final") msg.grounding = report;
          else if (role_index != null && msg.roles[role_index]) {
            msg.roles[role_index] = { ...msg.roles[role_index], grounding: report };
          }
          break;
        }
        case "final":
          msg.content = event.content;
          msg.status = undefined;
          msg.pending = false;
          break;
        case "error":
          msg.content = msg.content || `The agent hit an error: ${event.message}`;
          msg.status = undefined;
          msg.pending = false;
          break;
      }
      messages[idx] = msg;
      const running = event.type === "final" || event.type === "error" ? false : s.running;
      return { messages, running };
    });
  },

  startRun: async (prompt) => {
    const text = prompt.trim();
    if (!text || get().running || get().transportBusy) return;
    const ticket = invalidateOperation();
    const owner = get().authenticatedUserId;
    const controller = new AbortController();
    streamController = controller;
    operation = "stream";
    const current = () => ticket === generation && streamController === controller && owner === get().authenticatedUserId;
    get().appendUserAndPending(text);
    set({ running: true, transportBusy: true, eventCursor: 0, activeRunId: null, runNotice: null });
    let sawFinal = false;
    let sawError = false;
    try {
      const { debate, strategy, screener, ensemble, threadId } = get();
      const runRequest = { prompt: text, context: buildScreenContext(), thread_id: threadId,
        ...(debate ? { mode: "debate" as const, ticker: text }
          : strategy ? { mode: "strategy" as const, ticker: text }
            : screener ? { mode: "screener" as const, ticker: text }
              : ensemble ? { mode: "ensemble" as const, ticker: text } : {}),
      };
      const runId = await createRun(runRequest);
      if (!current()) return;
      set({ activeRunId: runId });
      saveRecovery(owner, runId, threadId);
      await streamRun(runId, (event) => {
        if (!current()) return;
        sawFinal ||= event.type === "final";
        sawError ||= event.type === "error";
        get().applyEvent(event);
      }, controller.signal, 0, (eventCursor) => {
        if (current()) set({ eventCursor });
      }, (runNotice) => { if (current()) set({ runNotice }); });
      if (!current() || controller.signal.aborted) return;
      if (sawFinal && !sawError) clearRecovery(owner);
      if (!sawFinal && !get().runNotice) set({ runNotice: "Connection ended. Reconnect or resume to recover this run." });
      else if (sawError && !get().runNotice) set({ runNotice: "This run reported errors. Recorded evidence is available; resume to retry." });
    } catch (err) {
      if (current() && !controller.signal.aborted) set({ runNotice: (err as Error).message || "Connection lost. Reconnect to recover this run." });
    } finally {
      if (current()) { set({ running: false, transportBusy: false }); streamController = null; operation = null; }
    }
  },

  cancelActiveRun: async () => {
    const id = get().activeRunId;
    const ticket = generation;
    const owner = get().authenticatedUserId;
    if (!id) return;
    try {
      await cancelRun(id);
      if (ticket !== generation || id !== get().activeRunId || owner !== get().authenticatedUserId) return;
      // Invalidate before enabling another run. Old callbacks/finally cannot touch it.
      invalidateOperation();
      set((state) => ({ running: false, transportBusy: false, runNotice: "Stop requested. Completed evidence remains available.",
        messages: state.messages.map((message) => message.pending ? { ...message, pending: false, status: undefined } : message) }));
    } catch (error) {
      if (ticket === generation) set({ runNotice: `Cancellation failed: ${(error as Error).message}` });
    }
  },

  reconnectRun: async (resume = false) => {
    const id = get().activeRunId;
    if (!id || get().transportBusy) return;
    const ticket = invalidateOperation();
    const owner = get().authenticatedUserId;
    const controller = new AbortController();
    streamController = controller;
    operation = "stream";
    const current = () => ticket === generation && streamController === controller && owner === get().authenticatedUserId && get().activeRunId === id;
    set({ running: true, transportBusy: true, runNotice: null });
    let sawFinal = false;
    let sawError = false;
    try {
      if (resume) await resumeRun(id);
      if (!current()) return;
      const after = get().eventCursor;
      saveRecovery(owner, id, get().threadId);
      set((state) => ({ ...(after ? {} : { artifacts: [] }), messages: state.messages.map((message, index) =>
        index === state.messages.length - 1 && message.role === "assistant"
          ? { ...message, ...(after ? {} : { content: "", steps: [], roles: [], phases: [], grounding: undefined }), pending: true, status: undefined } : message) }));
      await streamRun(id, (event) => {
        if (!current()) return;
        sawFinal ||= event.type === "final";
        sawError ||= event.type === "error";
        get().applyEvent(event);
      }, controller.signal, after, (eventCursor) => {
        if (current()) set({ eventCursor });
      }, (runNotice) => { if (current()) set({ runNotice }); });
      if (!current() || controller.signal.aborted) return;
      if (sawFinal && !sawError) clearRecovery(owner);
      if (!sawFinal && !get().runNotice) {
        // An empty replay may mean the cursor already reached the final event.
        const run = await getRun(id);
        if (!current()) return;
        if (run.status === "done" && run.final != null) {
          get().applyEvent({ type: "final", content: run.final });
          clearRecovery(owner);
        } else set({ runNotice: "Run interrupted. Resume to continue from saved work." });
      } else if (sawError && !get().runNotice) set({ runNotice: "This run reported errors. Resume to retry with recorded evidence." });
    } catch (error) {
      if (current() && !controller.signal.aborted) set({ runNotice: (error as Error).message });
    } finally {
      if (current()) { set({ running: false, transportBusy: false }); streamController = null; operation = null; }
    }
  },

  runScreenerFor: async (ticker) => {
    const t = (ticker || "").trim().toUpperCase();
    if (!t) return;
    set({ screener: true, debate: false, strategy: false, ensemble: false, open: true });
    await get().startRun(t);
  },
}));
