# Agent Console (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the global, keyboard-invokable Agent Console UI — a slide-over chat thread + live artifact canvas that streams the backend agent's SSE events and renders screener/compare/snapshot artifacts, available from any screen.

**Architecture:** A pure SSE buffer parser + a thin `fetch`-based streaming client feed a Zustand store via an `applyEvent` reducer. A single `<AgentConsole>` (slide-over) mounted in the app shell renders chat messages + artifacts from the store; a launcher button and a `Ctrl/Cmd+J` hotkey toggle it. Read-only Phase 1: tool-step trace + artifacts + final answer, no order-approval cards.

**Tech Stack:** React 18 + TypeScript, Zustand (`create`), axios (existing `api`) for the POST, native `fetch` + `ReadableStream` for the SSE GET, Vitest + @testing-library/react. Styling via existing terminal theme CSS custom properties.

**Scope note:** This is the frontend slice of design-spec Phase 1. It consumes the API contract from the backend plan (`POST /api/agent/runs` → `{run_id}`; `GET /api/agent/runs/{id}/stream` → SSE of `data: <json AgentEvent>`). Order-approval cards, the Settings "Agent" tab, durable history, and token-level streaming are deferred.

**Reference:** `docs/superpowers/specs/2026-06-16-agent-framework-design.md` §5 / §5.1, and the backend plan `docs/superpowers/plans/2026-06-16-agent-core-backend.md`.

**Verified codebase facts (do not re-derive):**
- `frontend/src/api/base.ts` exports an axios instance `api` (baseURL `/api`) with a request interceptor that injects `Authorization: Bearer <token>` from a private `accessTokenGetter`. There is NO existing exported token getter — Task 1 adds one.
- Zustand stores live in `frontend/src/store/` and use `import { create } from "zustand"`.
- The app shell is `frontend/src/App.tsx`; its `return (...)` (~line 105) mounts `<ThemeRuntime />` and `<TerminalBackground />` globally before `<Routes>`. Global overlays mount here.
- An existing global hotkey precedent is `frontend/src/components/layout/CommandBar.tsx` (uses `Ctrl/Cmd+G`). We use `Ctrl/Cmd+J` to avoid clashing.
- Theme CSS custom properties (confirmed present in `frontend/src/styles/terminal-theme.css`): `--ot-color-canvas`, `--ot-color-canvas-elevated`, `--ot-color-border-default`, `--ot-color-border-subtle`, `--ot-color-accent-primary`, `--ot-color-text-primary`, `--ot-color-text-secondary`, `--ot-color-text-muted`, `--ot-color-feedback-error`, `--ot-color-feedback-success`, `--ot-font-data` (mono), `--ot-font-ui` (sans), `--ot-radius-sm`, `--ot-radius-md`, `--ot-space-1..4`.
- Vitest test files live in `frontend/src/__tests__/`; `frontend/src/test-setup.ts` mocks localStorage. Run from `frontend/`: `npm test -- <file>`.

---

## File Structure

**Create:**
- `frontend/src/agent/types.ts` — `AgentEvent` union, `AgentMessage`, `AgentArtifact`, `RunRequest`, `RunContext`.
- `frontend/src/agent/sse.ts` — `parseSSEBuffer(buffer)` pure parser (no I/O).
- `frontend/src/agent/screenContext.ts` — `buildScreenContext()` (reads `window.location`).
- `frontend/src/agent/agentApi.ts` — `createRun()` (axios) + `streamRun()` (fetch + ReadableStream).
- `frontend/src/agent/agentStore.ts` — Zustand store: open/close, messages, artifacts, `applyEvent`, `startRun`.
- `frontend/src/agent/components/artifacts.tsx` — `ScreenerTable`, `CompareTable`, `SnapshotCard`, `ArtifactView` dispatcher.
- `frontend/src/agent/components/ChatThread.tsx` — chat messages + tool-step trace.
- `frontend/src/agent/components/ArtifactCanvas.tsx` — stacks artifacts.
- `frontend/src/agent/components/AgentConsole.tsx` — slide-over shell + hotkey + composer.
- `frontend/src/agent/components/AgentLauncher.tsx` — persistent launcher button.
- `frontend/src/agent/agentConsole.css` — slide-over layout + motion (token-based).
- Tests: `frontend/src/__tests__/agentSse.test.ts`, `agentStore.test.ts`, `agentArtifacts.test.tsx`, `AgentConsole.test.tsx`.

**Modify:**
- `frontend/src/api/base.ts` — add exported `getAccessToken()`.
- `frontend/src/App.tsx` — mount `<AgentConsole />` and `<AgentLauncher />` in the shell.

---

## Task 1: Expose the access token for fetch-based SSE

**Files:**
- Modify: `frontend/src/api/base.ts`
- Test: `frontend/src/__tests__/agentToken.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/__tests__/agentToken.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { setAccessTokenGetter, getAccessToken } from "../api/base";

describe("getAccessToken", () => {
  afterEach(() => setAccessTokenGetter(null));

  it("returns null when no getter is registered", () => {
    setAccessTokenGetter(null);
    expect(getAccessToken()).toBeNull();
  });

  it("returns the token from the registered getter", () => {
    setAccessTokenGetter(() => "tok-123");
    expect(getAccessToken()).toBe("tok-123");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npm test -- src/__tests__/agentToken.test.ts`
Expected: FAIL — `getAccessToken` is not exported.

- [ ] **Step 3: Add the getter**

In `frontend/src/api/base.ts`, just after the `setAccessTokenGetter` function, add:

```ts
export function getAccessToken(): string | null {
  return accessTokenGetter ? accessTokenGetter() : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/agentToken.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/base.ts frontend/src/__tests__/agentToken.test.ts
git commit -m "feat(agent-ui): export getAccessToken for SSE streaming"
```

---

## Task 2: Agent event types + SSE buffer parser

**Files:**
- Create: `frontend/src/agent/types.ts`, `frontend/src/agent/sse.ts`
- Test: `frontend/src/__tests__/agentSse.test.ts`

The parser is pure and the riskiest correctness piece (chunk boundaries), so it is tested in isolation.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/__tests__/agentSse.test.ts
import { describe, it, expect } from "vitest";
import { parseSSEBuffer } from "../agent/sse";

describe("parseSSEBuffer", () => {
  it("parses complete events and keeps remainder", () => {
    const buf = 'data: {"type":"token","text":"hi"}\n\ndata: {"type":"final","content":"done"}\n\ndata: {"type":"to';
    const { events, rest } = parseSSEBuffer(buf);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "token", text: "hi" });
    expect(events[1]).toEqual({ type: "final", content: "done" });
    expect(rest).toBe('data: {"type":"to');
  });

  it("returns no events when buffer has no complete frame", () => {
    const { events, rest } = parseSSEBuffer('data: {"type":"to');
    expect(events).toHaveLength(0);
    expect(rest).toBe('data: {"type":"to');
  });

  it("ignores malformed json frames but still advances", () => {
    const buf = 'data: not-json\n\ndata: {"type":"final","content":"ok"}\n\n';
    const { events, rest } = parseSSEBuffer(buf);
    expect(events).toEqual([{ type: "final", content: "ok" }]);
    expect(rest).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/agentSse.test.ts`
Expected: FAIL — cannot find module `../agent/sse`.

- [ ] **Step 3: Create the types**

```ts
// frontend/src/agent/types.ts
export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; result: unknown; is_error: boolean }
  | { type: "artifact"; kind: string; name: string; data: unknown }
  | { type: "final"; content: string }
  | { type: "error"; message: string };

export interface RunContext {
  route?: string;
  symbol?: string;
}

export interface RunRequest {
  prompt: string;
  context?: RunContext;
  provider?: string;
  model?: string;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  // Tool-step trace rows attached to an assistant turn.
  steps: { id: string; name: string; isError: boolean }[];
  pending: boolean;
}

export interface AgentArtifact {
  id: string;
  kind: string;
  name: string;
  data: unknown;
}
```

- [ ] **Step 4: Create the parser**

```ts
// frontend/src/agent/sse.ts
import type { AgentEvent } from "./types";

const FRAME_SEP = "\n\n";

/**
 * Split an accumulating SSE text buffer into complete events.
 * Returns parsed events plus the unconsumed remainder (a partial frame).
 * Malformed JSON frames are skipped, not thrown.
 */
export function parseSSEBuffer(buffer: string): { events: AgentEvent[]; rest: string } {
  const events: AgentEvent[] = [];
  let rest = buffer;

  let sep = rest.indexOf(FRAME_SEP);
  while (sep !== -1) {
    const frame = rest.slice(0, sep);
    rest = rest.slice(sep + FRAME_SEP.length);

    const line = frame.trim();
    if (line.startsWith("data:")) {
      const payload = line.slice("data:".length).trim();
      try {
        events.push(JSON.parse(payload) as AgentEvent);
      } catch {
        // skip malformed frame
      }
    }
    sep = rest.indexOf(FRAME_SEP);
  }
  return { events, rest };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/__tests__/agentSse.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/agent/types.ts frontend/src/agent/sse.ts frontend/src/__tests__/agentSse.test.ts
git commit -m "feat(agent-ui): add agent event types and SSE buffer parser"
```

---

## Task 3: Streaming API client

**Files:**
- Create: `frontend/src/agent/agentApi.ts`, `frontend/src/agent/screenContext.ts`
- Test: `frontend/src/__tests__/agentApi.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/__tests__/agentApi.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { streamRun } from "../agent/agentApi";
import { buildScreenContext } from "../agent/screenContext";
import type { AgentEvent } from "../agent/types";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

afterEach(() => vi.restoreAllMocks());

describe("streamRun", () => {
  it("invokes onEvent for each parsed SSE event across chunk boundaries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      sseResponse([
        'data: {"type":"tool_call","id":"c1","name":"screen_stocks","arguments":{}}\n\n',
        'data: {"type":"final","con',
        'tent":"AAPL"}\n\n',
      ])
    ));
    const seen: AgentEvent[] = [];
    await streamRun("run-1", (e) => seen.push(e));
    expect(seen.map((e) => e.type)).toEqual(["tool_call", "final"]);
    expect(seen[1]).toEqual({ type: "final", content: "AAPL" });
  });

  it("emits a synthetic error event when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const seen: AgentEvent[] = [];
    await streamRun("run-1", (e) => seen.push(e));
    expect(seen[seen.length - 1].type).toBe("error");
  });
});

describe("buildScreenContext", () => {
  it("captures the current pathname", () => {
    const ctx = buildScreenContext();
    expect(typeof ctx.route).toBe("string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/agentApi.test.ts`
Expected: FAIL — cannot find module `../agent/agentApi`.

- [ ] **Step 3: Create the screen-context helper**

```ts
// frontend/src/agent/screenContext.ts
import type { RunContext } from "./types";

/** Capture lightweight context about the screen the user is on. */
export function buildScreenContext(): RunContext {
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  const ctx: RunContext = { route: path };
  // Pull a symbol out of common detail routes like /stock/AAPL or /equity/AAPL.
  const match = path.match(/\/(?:stock|equity|crypto|forex|commodities)\/([A-Za-z0-9.\-&]+)/);
  if (match) ctx.symbol = decodeURIComponent(match[1]).toUpperCase();
  return ctx;
}
```

- [ ] **Step 4: Create the API client**

```ts
// frontend/src/agent/agentApi.ts
import { api, getAccessToken } from "../api/base";
import { parseSSEBuffer } from "./sse";
import type { AgentEvent, RunRequest } from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) || "/api";

/** Create a run and return its id. Uses the shared axios client (auth handled by interceptor). */
export async function createRun(req: RunRequest): Promise<string> {
  const { data } = await api.post<{ run_id: string }>("/agent/runs", req);
  return data.run_id;
}

/**
 * Open the SSE stream for a run and invoke `onEvent` per agent event.
 * Resolves when the stream ends. Never throws for transport/HTTP errors —
 * it emits a synthetic `error` event instead so the UI degrades gracefully.
 */
export async function streamRun(
  runId: string,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = getAccessToken();
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let resp: Response;
  try {
    resp = await fetch(`${API_BASE}/agent/runs/${runId}/stream`, { headers, signal });
  } catch (err) {
    onEvent({ type: "error", message: (err as Error).message || "network error" });
    return;
  }
  if (!resp.ok || !resp.body) {
    onEvent({ type: "error", message: `stream failed (HTTP ${resp.status})` });
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSSEBuffer(buffer);
    buffer = rest;
    for (const event of events) onEvent(event);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/__tests__/agentApi.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/agent/agentApi.ts frontend/src/agent/screenContext.ts frontend/src/__tests__/agentApi.test.ts
git commit -m "feat(agent-ui): add streaming agent API client + screen context"
```

---

## Task 4: Agent Zustand store

**Files:**
- Create: `frontend/src/agent/agentStore.ts`
- Test: `frontend/src/__tests__/agentStore.test.ts`

The store holds UI state + an `applyEvent` reducer. `startRun` is injectable (the API fns are passed in) so the reducer is testable without network.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/__tests__/agentStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "../agent/agentStore";

function reset() {
  useAgentStore.setState({
    open: false, running: false, messages: [], artifacts: [],
  });
}

describe("agentStore.applyEvent", () => {
  beforeEach(reset);

  it("tool_call appends a step to the pending assistant message", () => {
    const s = useAgentStore.getState();
    s.appendUserAndPending("find cheap stocks");
    s.applyEvent({ type: "tool_call", id: "c1", name: "screen_stocks", arguments: {} });
    const msgs = useAgentStore.getState().messages;
    const assistant = msgs[msgs.length - 1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.steps).toEqual([{ id: "c1", name: "screen_stocks", isError: false }]);
  });

  it("artifact event pushes an artifact", () => {
    useAgentStore.getState().appendUserAndPending("x");
    useAgentStore.getState().applyEvent({
      type: "artifact", kind: "screener_table", name: "screen_stocks",
      data: { rows: [{ ticker: "AAPL" }] },
    });
    expect(useAgentStore.getState().artifacts).toHaveLength(1);
    expect(useAgentStore.getState().artifacts[0].kind).toBe("screener_table");
  });

  it("final event fills assistant content and clears pending/running", () => {
    const s = useAgentStore.getState();
    s.appendUserAndPending("x");
    useAgentStore.setState({ running: true });
    s.applyEvent({ type: "final", content: "Top pick: AAPL" });
    const msgs = useAgentStore.getState().messages;
    expect(msgs[msgs.length - 1].content).toBe("Top pick: AAPL");
    expect(msgs[msgs.length - 1].pending).toBe(false);
    expect(useAgentStore.getState().running).toBe(false);
  });

  it("error event sets assistant content and clears running", () => {
    const s = useAgentStore.getState();
    s.appendUserAndPending("x");
    useAgentStore.setState({ running: true });
    s.applyEvent({ type: "error", message: "boom" });
    const msgs = useAgentStore.getState().messages;
    expect(msgs[msgs.length - 1].content).toContain("boom");
    expect(useAgentStore.getState().running).toBe(false);
  });

  it("toggleOpen flips open state", () => {
    expect(useAgentStore.getState().open).toBe(false);
    useAgentStore.getState().toggleOpen();
    expect(useAgentStore.getState().open).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/agentStore.test.ts`
Expected: FAIL — cannot find module `../agent/agentStore`.

- [ ] **Step 3: Implement the store**

```ts
// frontend/src/agent/agentStore.ts
import { create } from "zustand";

import { createRun, streamRun } from "./agentApi";
import { buildScreenContext } from "./screenContext";
import type { AgentArtifact, AgentEvent, AgentMessage } from "./types";

let seq = 0;
const nextId = () => `m${Date.now()}_${seq++}`;

interface AgentState {
  open: boolean;
  running: boolean;
  messages: AgentMessage[];
  artifacts: AgentArtifact[];
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  appendUserAndPending: (prompt: string) => void;
  applyEvent: (event: AgentEvent) => void;
  startRun: (prompt: string) => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  open: false,
  running: false,
  messages: [],
  artifacts: [],

  toggleOpen: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),

  appendUserAndPending: (prompt) =>
    set((s) => ({
      messages: [
        ...s.messages,
        { id: nextId(), role: "user", content: prompt, steps: [], pending: false },
        { id: nextId(), role: "assistant", content: "", steps: [], pending: true },
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
    // All other events mutate the trailing (pending) assistant message.
    set((s) => {
      const messages = s.messages.slice();
      const idx = messages.length - 1;
      if (idx < 0 || messages[idx].role !== "assistant") return s;
      const msg = { ...messages[idx], steps: messages[idx].steps.slice() };

      switch (event.type) {
        case "tool_call":
          msg.steps.push({ id: event.id, name: event.name, isError: false });
          break;
        case "tool_result": {
          const step = msg.steps.find((st) => st.id === event.id);
          if (step) step.isError = event.is_error;
          break;
        }
        case "token":
          msg.content += event.text;
          break;
        case "final":
          msg.content = event.content;
          msg.pending = false;
          break;
        case "error":
          msg.content = msg.content || `The agent hit an error: ${event.message}`;
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
      const runId = await createRun({ prompt: text, context: buildScreenContext() });
      await streamRun(runId, (event) => get().applyEvent(event));
    } catch (err) {
      get().applyEvent({ type: "error", message: (err as Error).message || "request failed" });
    } finally {
      if (get().running) set({ running: false });
    }
  },
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/agentStore.test.ts`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/agent/agentStore.ts frontend/src/__tests__/agentStore.test.ts
git commit -m "feat(agent-ui): add agent zustand store with event reducer"
```

---

## Task 5: Artifact renderers + canvas

**Files:**
- Create: `frontend/src/agent/components/artifacts.tsx`, `frontend/src/agent/components/ArtifactCanvas.tsx`
- Test: `frontend/src/__tests__/agentArtifacts.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/__tests__/agentArtifacts.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ArtifactView } from "../agent/components/artifacts";

describe("ArtifactView", () => {
  it("renders a screener table from rows", () => {
    render(
      <ArtifactView
        artifact={{
          id: "a1", kind: "screener_table", name: "screen_stocks",
          data: { rows: [{ ticker: "AAPL", pe_ratio: 18 }] },
        }}
      />,
    );
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("ticker")).toBeInTheDocument();
  });

  it("renders a snapshot card", () => {
    render(
      <ArtifactView
        artifact={{
          id: "a2", kind: "snapshot_card", name: "get_stock_snapshot",
          data: { symbol: "MSFT", last_price: 410.2, company_name: "Microsoft" },
        }}
      />,
    );
    expect(screen.getByText("Microsoft")).toBeInTheDocument();
    expect(screen.getByText(/410.2/)).toBeInTheDocument();
  });

  it("falls back to JSON for unknown kinds", () => {
    render(<ArtifactView artifact={{ id: "a3", kind: "mystery", name: "x", data: { a: 1 } }} />);
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/agentArtifacts.test.tsx`
Expected: FAIL — cannot find module `../agent/components/artifacts`.

- [ ] **Step 3: Implement the renderers**

```tsx
// frontend/src/agent/components/artifacts.tsx
import type { AgentArtifact } from "../types";

const cell: React.CSSProperties = {
  padding: "var(--ot-space-1) var(--ot-space-2)",
  borderBottom: "1px solid var(--ot-color-border-subtle)",
  fontFamily: "var(--ot-font-data)",
  fontSize: 12,
  color: "var(--ot-color-text-primary)",
  textAlign: "left",
  whiteSpace: "nowrap",
};

function RowsTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <div style={{ color: "var(--ot-color-text-muted)" }}>No rows.</div>;
  const cols = Object.keys(rows[0]);
  return (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c} style={{ ...cell, color: "var(--ot-color-text-secondary)", fontFamily: "var(--ot-font-ui)" }}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {cols.map((c) => (
              <td key={c} style={cell}>{r[c] == null ? "—" : String(r[c])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function asRows(data: unknown): Record<string, unknown>[] {
  const rows = (data as { rows?: unknown[] })?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

function SnapshotCard({ data }: { data: Record<string, unknown> }) {
  const fields = Object.entries(data).filter(([, v]) => typeof v !== "object");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--ot-space-1) var(--ot-space-3)" }}>
      {fields.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <span style={{ color: "var(--ot-color-text-muted)", fontFamily: "var(--ot-font-ui)", fontSize: 12 }}>{k}</span>
          <span style={{ color: "var(--ot-color-text-primary)", fontFamily: "var(--ot-font-data)", fontSize: 12 }}>
            {v == null ? "—" : String(v)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ArtifactView({ artifact }: { artifact: AgentArtifact }) {
  let body: React.ReactNode;
  switch (artifact.kind) {
    case "screener_table":
    case "compare_table":
      body = <RowsTable rows={asRows(artifact.data)} />;
      break;
    case "snapshot_card":
      body = <SnapshotCard data={(artifact.data as Record<string, unknown>) || {}} />;
      break;
    default:
      body = (
        <pre style={{ margin: 0, fontFamily: "var(--ot-font-data)", fontSize: 11, color: "var(--ot-color-text-secondary)", whiteSpace: "pre-wrap" }}>
          {JSON.stringify(artifact.data, null, 2)}
        </pre>
      );
  }
  return (
    <section
      style={{
        background: "var(--ot-color-canvas-elevated)",
        border: "1px solid var(--ot-color-border-default)",
        borderRadius: "var(--ot-radius-md)",
        padding: "var(--ot-space-2)",
        overflowX: "auto",
      }}
    >
      <header style={{ fontFamily: "var(--ot-font-ui)", fontSize: 11, color: "var(--ot-color-text-muted)", marginBottom: "var(--ot-space-1)", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {artifact.name}
      </header>
      {body}
    </section>
  );
}
```

- [ ] **Step 4: Implement the canvas**

```tsx
// frontend/src/agent/components/ArtifactCanvas.tsx
import { ArtifactView } from "./artifacts";
import type { AgentArtifact } from "../types";

export function ArtifactCanvas({ artifacts }: { artifacts: AgentArtifact[] }) {
  if (!artifacts.length) {
    return (
      <div style={{ color: "var(--ot-color-text-muted)", fontFamily: "var(--ot-font-ui)", fontSize: 12, padding: "var(--ot-space-3)" }}>
        Tool outputs will appear here.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--ot-space-2)", padding: "var(--ot-space-2)" }}>
      {artifacts.map((a) => (
        <ArtifactView key={a.id} artifact={a} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/__tests__/agentArtifacts.test.tsx`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/agent/components/artifacts.tsx frontend/src/agent/components/ArtifactCanvas.tsx frontend/src/__tests__/agentArtifacts.test.tsx
git commit -m "feat(agent-ui): add artifact renderers and canvas"
```

---

## Task 6: Chat thread + Console slide-over + launcher

**Files:**
- Create: `frontend/src/agent/components/ChatThread.tsx`, `frontend/src/agent/components/AgentConsole.tsx`, `frontend/src/agent/components/AgentLauncher.tsx`, `frontend/src/agent/agentConsole.css`
- Test: `frontend/src/__tests__/AgentConsole.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/__tests__/AgentConsole.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentConsole } from "../agent/components/AgentConsole";
import { useAgentStore } from "../agent/agentStore";

beforeEach(() => {
  useAgentStore.setState({ open: false, running: false, messages: [], artifacts: [] });
});

describe("AgentConsole", () => {
  it("is not visible when closed", () => {
    render(<AgentConsole />);
    expect(screen.queryByRole("dialog", { name: /agent console/i })).toBeNull();
  });

  it("renders messages and artifacts when open", () => {
    useAgentStore.setState({
      open: true,
      messages: [
        { id: "u1", role: "user", content: "find cheap stocks", steps: [], pending: false },
        { id: "a1", role: "assistant", content: "Top pick: AAPL",
          steps: [{ id: "c1", name: "screen_stocks", isError: false }], pending: false },
      ],
      artifacts: [{ id: "art1", kind: "screener_table", name: "screen_stocks", data: { rows: [{ ticker: "AAPL" }] } }],
    });
    render(<AgentConsole />);
    expect(screen.getByRole("dialog", { name: /agent console/i })).toBeInTheDocument();
    expect(screen.getByText("find cheap stocks")).toBeInTheDocument();
    expect(screen.getByText("Top pick: AAPL")).toBeInTheDocument();
    expect(screen.getByText(/screen_stocks/)).toBeInTheDocument();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
  });

  it("Ctrl/Cmd+J toggles the console open", () => {
    render(<AgentConsole />);
    expect(useAgentStore.getState().open).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", ctrlKey: true }));
    expect(useAgentStore.getState().open).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/AgentConsole.test.tsx`
Expected: FAIL — cannot find module `../agent/components/AgentConsole`.

- [ ] **Step 3: Create the stylesheet**

```css
/* frontend/src/agent/agentConsole.css */
.ot-agent-panel {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  width: min(560px, 100vw);
  display: flex;
  flex-direction: column;
  background: var(--ot-color-canvas);
  border-left: 1px solid var(--ot-color-border-default);
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.35);
  z-index: 1200;
  transform: translateX(0);
  transition: transform 180ms ease;
  font-family: var(--ot-font-ui);
}
.ot-agent-panel--closed {
  transform: translateX(100%);
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .ot-agent-panel { transition: none; }
}
.ot-agent-launcher {
  position: fixed;
  bottom: var(--ot-space-4);
  right: var(--ot-space-4);
  z-index: 1100;
  border-radius: var(--ot-radius-md);
  border: 1px solid var(--ot-color-border-default);
  background: var(--ot-color-accent-primary);
  color: var(--ot-color-text-inverse);
  font-family: var(--ot-font-ui);
  font-weight: var(--ot-font-weight-semibold);
  padding: var(--ot-space-2) var(--ot-space-3);
  cursor: pointer;
}
```

- [ ] **Step 4: Create the chat thread**

```tsx
// frontend/src/agent/components/ChatThread.tsx
import type { AgentMessage } from "../types";

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
                  {s.isError ? "✗" : "→"} ran {s.name}
                </li>
              ))}
            </ul>
          )}
          <div
            style={{
              fontFamily: "var(--ot-font-ui)", fontSize: 13, lineHeight: 1.5,
              color: "var(--ot-color-text-primary)", whiteSpace: "pre-wrap",
            }}
          >
            {m.pending && !m.content ? <span style={{ color: "var(--ot-color-text-muted)" }}>Thinking…</span> : m.content}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Create the console**

```tsx
// frontend/src/agent/components/AgentConsole.tsx
import { useEffect, useState } from "react";

import "../agentConsole.css";
import { useAgentStore } from "../agentStore";
import { ArtifactCanvas } from "./ArtifactCanvas";
import { ChatThread } from "./ChatThread";

export function AgentConsole() {
  const open = useAgentStore((s) => s.open);
  const running = useAgentStore((s) => s.running);
  const messages = useAgentStore((s) => s.messages);
  const artifacts = useAgentStore((s) => s.artifacts);
  const toggleOpen = useAgentStore((s) => s.toggleOpen);
  const setOpen = useAgentStore((s) => s.setOpen);
  const startRun = useAgentStore((s) => s.startRun);
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
        <span>Agent</span>
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
          placeholder="Ask the agent to find or analyze stocks…"
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
```

- [ ] **Step 6: Create the launcher**

```tsx
// frontend/src/agent/components/AgentLauncher.tsx
import "../agentConsole.css";
import { useAgentStore } from "../agentStore";

export function AgentLauncher() {
  const open = useAgentStore((s) => s.open);
  const toggleOpen = useAgentStore((s) => s.toggleOpen);
  if (open) return null;
  return (
    <button type="button" className="ot-agent-launcher" onClick={toggleOpen} aria-label="Open agent console (Ctrl+J)">
      Agent
    </button>
  );
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- src/__tests__/AgentConsole.test.tsx`
Expected: PASS (3 passed).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/agent/components/ChatThread.tsx frontend/src/agent/components/AgentConsole.tsx frontend/src/agent/components/AgentLauncher.tsx frontend/src/agent/agentConsole.css frontend/src/__tests__/AgentConsole.test.tsx
git commit -m "feat(agent-ui): add chat thread, slide-over console, launcher + hotkey"
```

---

## Task 7: Mount in app shell + build/test gate

**Files:**
- Modify: `frontend/src/App.tsx`
- Test: full Vitest + build

- [ ] **Step 1: Mount the console in the shell**

Read `frontend/src/App.tsx`. Add imports near the other top-level component imports (after the `ThemeRuntime`/`TerminalBackground` imports):

```tsx
import { AgentConsole } from "./agent/components/AgentConsole";
import { AgentLauncher } from "./agent/components/AgentLauncher";
```

In the `return (...)` block (~line 105), immediately after the `<TerminalBackground />` line, add:

```tsx
      <AgentConsole />
      <AgentLauncher />
```

(They are `position: fixed` overlays, so their position in the tree only needs to be inside the same top-level wrapper as `ThemeRuntime`. Do not place them inside `<Routes>`.)

- [ ] **Step 2: Run the full agent-ui test set**

Run (from `frontend/`):
`npm test -- src/__tests__/agentToken.test.ts src/__tests__/agentSse.test.ts src/__tests__/agentApi.test.ts src/__tests__/agentStore.test.ts src/__tests__/agentArtifacts.test.tsx src/__tests__/AgentConsole.test.tsx`
Expected: PASS (all).

- [ ] **Step 3: TypeScript + build check**

Run (from `frontend/`): `npm run build`
Expected: TypeScript compiles and Vite build succeeds with no errors.

- [ ] **Step 4: Run the broader frontend suite for regressions**

Run (from `frontend/`): `npm test`
Expected: No NEW failures introduced by the agent files. (If pre-existing unrelated failures exist, confirm they fail identically on the prior commit.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(agent-ui): mount global agent console in app shell"
```

---

## Self-Review Notes (spec coverage)

- **Global console invokable from any screen (spec §5):** Tasks 6-7 — fixed slide-over mounted in the shell, `Ctrl/Cmd+J` hotkey + launcher, available on every route. ✓
- **Chat thread + tool-step trace + live artifact canvas (spec §5):** Tasks 4-6 — store reducer feeds `ChatThread` (steps trace) and `ArtifactCanvas`. ✓
- **Screen-context injection (spec §5):** Task 3 `buildScreenContext()` → sent in `createRun`. ✓
- **SSE transport into a store, honoring React-loop rules (spec §5):** Tasks 3-4 — fetch reader + parser; reducer uses immutable slices and only flips `running`/`pending` on terminal events (no new-ref churn loops). ✓
- **Design language: theme tokens, mono/sans, modern restrained motion, a11y (spec §5.1):** Tasks 5-6 — all colors/fonts/spacing via `--ot-*` tokens; mono (`--ot-font-data`) for data, sans (`--ot-font-ui`) for prose; 180ms transform transition with `prefers-reduced-motion` guard; `role="dialog"`, `aria-label`, Escape-to-close, labeled controls. ✓
- **Artifact types screener/compare/snapshot (spec §5):** Task 5 — renderers keyed to `ARTIFACT_KINDS` from the backend (`screener_table`, `compare_table`, `snapshot_card`) with a JSON fallback. ✓
- **Deferred (consistent with phasing):** order-approval cards, Settings "Agent" tab, durable run history, full-page Home view, token-level streaming. Not in this plan. ✓

Type consistency check: `AgentEvent`/`AgentMessage`/`AgentArtifact`/`RunContext`/`RunRequest` (Task 2) are used unchanged in Tasks 3-6; `parseSSEBuffer` (Task 2) used in Task 3; `getAccessToken` (Task 1) used in Task 3; `createRun`/`streamRun` (Task 3) used in Task 4; `useAgentStore` shape (Task 4) consumed in Tasks 5-6 and asserted in tests; `ArtifactView` (Task 5) used in Task 6's `ArtifactCanvas`; `ARTIFACT_KINDS` strings match the backend `events.py` mapping. ✓
