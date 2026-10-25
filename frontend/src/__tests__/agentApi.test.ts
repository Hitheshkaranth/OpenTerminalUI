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

it("replays each event ID once and advances the cursor per delivered frame", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => sseResponse([
    'id: 3\ndata: {"type":"token","text":"old"}\n\nid: 4\ndata: {"type":"token","text":"new"}\n\n',
    'id: 4\ndata: {"type":"token","text":"duplicate"}\n\nid: 5\ndata: {"type":"final","content":"answer"}\n\n',
  ])));
  const seen: AgentEvent[] = []; const cursors: number[] = [];
  await streamRun("r", (event) => seen.push(event), undefined, 3, (cursor) => cursors.push(cursor));
  expect(seen).toEqual([{ type: "token", text: "new" }, { type: "final", content: "answer" }]);
  expect(cursors).toEqual([4, 5]);
});

it("reports transport failures separately from persisted model errors", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("offline", { status: 503 })));
  const events = vi.fn(); const transport = vi.fn();
  await streamRun("r", events, undefined, 0, undefined, transport);
  expect(events).not.toHaveBeenCalled(); expect(transport).toHaveBeenCalledOnce();
});

it("reports a truncated final event as a transport interruption", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => sseResponse(['id: 4\ndata: {"type":"final","content":'])));
  const events = vi.fn(); const transport = vi.fn();
  await streamRun("r", events, undefined, 0, undefined, transport);
  expect(events).not.toHaveBeenCalled(); expect(transport).toHaveBeenCalledOnce();
});
