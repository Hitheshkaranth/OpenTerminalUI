import { create } from "zustand";

import { getThread as fetchThread } from "../api/agentExtras";
import { createRun, streamRun } from "./agentApi";
import { buildScreenContext } from "./screenContext";
import type { AgentArtifact, AgentEvent, AgentMessage } from "./types";

let seq = 0;
const nextId = () => `m${Date.now()}_${seq++}`;

interface AgentState {
  open: boolean;
  running: boolean;
  debate: boolean;
  strategy: boolean;
  screener: boolean;
  ensemble: boolean;
  threadId: string;
  messages: AgentMessage[];
  artifacts: AgentArtifact[];
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
  open: false,
  running: false,
  debate: false,
  strategy: false,
  screener: false,
  ensemble: false,
  threadId: crypto.randomUUID(),
  messages: [],
  artifacts: [],

  toggleOpen: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  toggleDebate: () => set((s) => ({ debate: !s.debate, strategy: false, screener: false, ensemble: false })),
  toggleStrategy: () => set((s) => ({ strategy: !s.strategy, debate: false, screener: false, ensemble: false })),
  toggleScreener: () => set((s) => ({ screener: !s.screener, debate: false, strategy: false, ensemble: false })),
  toggleEnsemble: () => set((s) => ({ ensemble: !s.ensemble, debate: false, strategy: false, screener: false })),

  newThread: () =>
    set({
      threadId: crypto.randomUUID(),
      messages: [],
      artifacts: [],
    }),

  loadThread: async (threadId) => {
    const data = await fetchThread(threadId);
    const messages: AgentMessage[] = [];
    for (const m of data.messages) {
      if (m.role === "user") {
        messages.push({
          id: m.id,
          role: "user",
          content: m.content,
          steps: [],
          phases: [],
          roles: [],
          pending: false,
        });
      } else {
        messages.push({
          id: m.id,
          role: "assistant",
          content: m.content,
          steps: [],
          phases: [],
          roles: [],
          pending: false,
        });
      }
    }
    set({ messages, threadId });
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
    if (!text || get().running) return;
    get().appendUserAndPending(text);
    set({ running: true });
    try {
      const debate = get().debate;
      const strategy = get().strategy;
      const screener = get().screener;
      const ensemble = get().ensemble;
      const threadId = get().threadId;
      const runRequest = {
        prompt: text,
        context: buildScreenContext(),
        thread_id: threadId,
        ...(debate ? { mode: "debate" as const, ticker: text }
          : strategy ? { mode: "strategy" as const, ticker: text }
            : screener ? { mode: "screener" as const, ticker: text }
              : ensemble ? { mode: "ensemble" as const, ticker: text }
                : {}),
      };
      const runId = await createRun(runRequest);
      await streamRun(runId, (event) => get().applyEvent(event));
    } catch (err) {
      get().applyEvent({ type: "error", message: (err as Error).message || "request failed" });
    } finally {
      if (get().running) set({ running: false });
    }
  },

  runScreenerFor: async (ticker) => {
    const t = (ticker || "").trim().toUpperCase();
    if (!t) return;
    set({ screener: true, debate: false, strategy: false, ensemble: false, open: true });
    await get().startRun(t);
  },
}));