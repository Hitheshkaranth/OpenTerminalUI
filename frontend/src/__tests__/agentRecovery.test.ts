import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentStore } from "../agent/agentStore";
import { cancelRun, createRun, getRun, streamRun } from "../agent/agentApi";
import { getThread } from "../api/agentExtras";

vi.mock("../agent/agentApi", () => ({ createRun: vi.fn(), getRun: vi.fn(), streamRun: vi.fn(), cancelRun: vi.fn(), resumeRun: vi.fn() }));
vi.mock("../api/agentExtras", () => ({ getThread: vi.fn() }));
vi.mock("../agent/screenContext", () => ({ buildScreenContext: () => ({ route: "/" }) }));
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const state = () => useAgentStore.getState();
const key = (owner: string) => `ot:agent:recovery:v1:${owner}`;

beforeEach(async () => {
  await state().setAuthenticatedUser(null);
  sessionStorage.clear();
  vi.resetAllMocks();
  await state().setAuthenticatedUser("alice");
  state().newThread();
});

describe("agent lifecycle ownership", () => {
  it("ignores an old stream callback and finally after cancel followed by a new run", async () => {
    const first = deferred<void>(); const second = deferred<void>();
    vi.mocked(createRun).mockResolvedValueOnce("one").mockResolvedValueOnce("two");
    vi.mocked(streamRun).mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    vi.mocked(cancelRun).mockResolvedValue(undefined);
    const a = state().startRun("first"); await vi.waitFor(() => expect(streamRun).toHaveBeenCalledTimes(1));
    const oldCallback = vi.mocked(streamRun).mock.calls[0][1];
    await state().cancelActiveRun();
    const b = state().startRun("second"); await vi.waitFor(() => expect(streamRun).toHaveBeenCalledTimes(2));
    oldCallback({ type: "final", content: "stale" }); first.resolve(); await a;
    expect(state().activeRunId).toBe("two"); expect(state().transportBusy).toBe(true);
    expect(state().messages.at(-1)?.content).toBe("");
    vi.mocked(streamRun).mock.calls[1][1]({ type: "final", content: "fresh" }); second.resolve(); await b;
    expect(state().messages.at(-1)?.content).toBe("fresh");
  });
  it("does not display or stream a create response belonging to a previous user", async () => {
    const create = deferred<string>(); vi.mocked(createRun).mockReturnValue(create.promise);
    const run = state().startRun("private prompt");
    await state().setAuthenticatedUser("bob"); create.resolve("alice-run"); await run;
    expect(streamRun).not.toHaveBeenCalled(); expect(state().messages).toEqual([]);
    expect(state().activeRunId).toBeNull(); expect(state().transportBusy).toBe(false);
  });
  it("keeps the latest selected thread when earlier requests finish late", async () => {
    const older = deferred<any>(); vi.mocked(getThread).mockReturnValueOnce(older.promise).mockResolvedValueOnce({ messages: [{ id: "b", role: "user", content: "new" }] } as any);
    const a = state().loadThread("old"); await state().loadThread("new");
    older.resolve({ messages: [{ id: "a", role: "user", content: "old" }] }); await a;
    expect(state().threadId).toBe("new"); expect(state().messages[0].content).toBe("new");
  });
  it("stores only account-scoped recovery identifiers and revalidates before restoring", async () => {
    vi.mocked(createRun).mockResolvedValue("saved-run"); vi.mocked(streamRun).mockResolvedValue(undefined);
    await state().startRun("private prompt");
    expect(sessionStorage.getItem(key("alice"))).toContain("saved-run");
    expect(sessionStorage.getItem(key("alice"))).not.toContain("private prompt");
    await state().setAuthenticatedUser("bob"); expect(getRun).not.toHaveBeenCalled();
    vi.mocked(getRun).mockResolvedValue({ run_id: "saved-run", thread_id: "thread", prompt: "private prompt", final: null, status: "interrupted" });
    await state().setAuthenticatedUser("alice");
    expect(getRun).toHaveBeenCalledWith("saved-run"); expect(state().eventCursor).toBe(0);
    expect(state().messages[0].content).toBe("private prompt");
  });
  it("discards restoration responses after the authenticated account changes", async () => {
    await state().setAuthenticatedUser(null);
    sessionStorage.setItem(key("alice"), JSON.stringify({ version: 1, owner: "alice", runId: "secret", threadId: "t" }));
    const restored = deferred<any>(); vi.mocked(getRun).mockReturnValue(restored.promise);
    const a = state().setAuthenticatedUser("alice"); await state().setAuthenticatedUser("bob");
    restored.resolve({ run_id: "secret", prompt: "secret", status: "running" }); await a;
    expect(state().messages).toEqual([]); expect(state().authenticatedUserId).toBe("bob");
  });
});
