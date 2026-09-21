import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "../api/base";
import {
  listThreads,
  getThread,
  deleteThread,
  listNotes,
  addNote,
  deleteNote,
  runReflections,
  listProposals,
  confirmProposal,
  rejectProposal,
  listSignals,
  evaluateSignals,
  getScorecard,
} from "../api/agentExtras";

function mockGet(path: string, data: unknown) {
  vi.spyOn(api, "get").mockResolvedValue({ data, status: 200, statusText: "OK", headers: {}, config: {} } as any);
  return path;
}

function mockPost(path: string, data: unknown) {
  vi.spyOn(api, "post").mockResolvedValue({ data, status: 200, statusText: "OK", headers: {}, config: {} } as any);
  return path;
}

function mockDelete(path: string, data: unknown) {
  vi.spyOn(api, "delete").mockResolvedValue({ data, status: 200, statusText: "OK", headers: {}, config: {} } as any);
  return path;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agentExtras API", () => {
  describe("threads (C12)", () => {
    it("listThreads calls GET /agent/threads", async () => {
      mockGet("/agent/threads", { items: [] });
      await listThreads();
      expect(api.get).toHaveBeenCalledWith("/agent/threads");
    });

    it("getThread calls GET /agent/threads/:id", async () => {
      mockGet("/agent/threads/t1", { thread_id: "t1", messages: [] });
      await getThread("t1");
      expect(api.get).toHaveBeenCalledWith("/agent/threads/t1");
    });

    it("deleteThread calls DELETE /agent/threads/:id", async () => {
      mockDelete("/agent/threads/t1", { status: "deleted" });
      await deleteThread("t1");
      expect(api.delete).toHaveBeenCalledWith("/agent/threads/t1");
    });
  });

  describe("notes (C13)", () => {
    it("listNotes calls GET /agent/notes with symbol param", async () => {
      mockGet("/agent/notes", { items: [] });
      await listNotes("AAPL");
      expect(api.get).toHaveBeenCalledWith("/agent/notes", { params: { symbol: "AAPL" } });
    });

    it("listNotes calls GET /agent/notes without params when symbol is undefined", async () => {
      mockGet("/agent/notes", { items: [] });
      await listNotes();
      expect(api.get).toHaveBeenCalledWith("/agent/notes", { params: {} });
    });

    it("addNote calls POST /agent/notes", async () => {
      const payload = { symbol: "AAPL", kind: "note" as const, content: "test" };
      mockPost("/agent/notes", { id: "n1", ...payload, source: "user", created_at: "2025-01-01T00:00:00Z" });
      await addNote(payload);
      expect(api.post).toHaveBeenCalledWith("/agent/notes", payload);
    });

    it("deleteNote calls DELETE /agent/notes/:id", async () => {
      mockDelete("/agent/notes/n1", { status: "deleted" });
      await deleteNote("n1");
      expect(api.delete).toHaveBeenCalledWith("/agent/notes/n1");
    });

    it("runReflections calls POST /agent/reflections/run", async () => {
      mockPost("/agent/reflections/run", { created: 2, skipped: 1 });
      await runReflections(0);
      expect(api.post).toHaveBeenCalledWith("/agent/reflections/run", null, { params: { benchmark_days: 0 } });
    });
  });

  describe("proposals (C14)", () => {
    it("listProposals calls GET /agent/proposals", async () => {
      mockGet("/agent/proposals", { items: [] });
      await listProposals("pending");
      expect(api.get).toHaveBeenCalledWith("/agent/proposals", { params: { status: "pending" } });
    });

    it("confirmProposal calls POST /agent/proposals/:id/confirm", async () => {
      mockPost("/agent/proposals/p1/confirm", { id: "p1", status: "confirmed", result: null });
      await confirmProposal("p1");
      expect(api.post).toHaveBeenCalledWith("/agent/proposals/p1/confirm");
    });

    it("rejectProposal calls POST /agent/proposals/:id/reject", async () => {
      mockPost("/agent/proposals/p1/reject", { status: "ok" });
      await rejectProposal("p1");
      expect(api.post).toHaveBeenCalledWith("/agent/proposals/p1/reject");
    });
  });

  describe("signals (C15)", () => {
    it("listSignals calls GET /agent/signals", async () => {
      mockGet("/agent/signals", { items: [] });
      await listSignals({ symbol: "AAPL", limit: 50 });
      expect(api.get).toHaveBeenCalledWith("/agent/signals", { params: { symbol: "AAPL", limit: 50 } });
    });

    it("evaluateSignals calls POST /agent/signals/evaluate", async () => {
      mockPost("/agent/signals/evaluate", { evaluated: 3, skipped: 0 });
      await evaluateSignals(10);
      expect(api.post).toHaveBeenCalledWith("/agent/signals/evaluate", null, { params: { horizon_days: 10 } });
    });

    it("getScorecard calls GET /agent/signals/scorecard", async () => {
      mockGet("/agent/signals/scorecard", { personas: [], as_of: "2025-01-01T00:00:00Z" });
      await getScorecard();
      expect(api.get).toHaveBeenCalledWith("/agent/signals/scorecard");
    });
  });
});