import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discardInstrumentNoteDraft, instrumentReviewStorageKey, readInstrumentReviewStatus,
  saveInstrumentReviewStatus, useInstrumentNoteDraft, useInstrumentReviewStatuses, writeInstrumentNoteDraft,
} from "../instrumentNotesStore";

describe("account-scoped instrument review state", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("isolates accounts and exact instrument identities", () => {
    expect(saveInstrumentReviewStatus("alice", "aapl", "researching").error).toBeNull();
    expect(readInstrumentReviewStatus("alice", "AAPL").status).toBe("researching");
    expect(readInstrumentReviewStatus("bob", "AAPL").status).toBe("unreviewed");
    expect(readInstrumentReviewStatus("alice", "NASDAQ:AAPL").status).toBe("unreviewed");
    expect(instrumentReviewStorageKey("alice:aapl", "TCS")).not.toBe(instrumentReviewStorageKey("alice", "AAPL:TCS"));
  });

  it.each(["not JSON", "[]", JSON.stringify({ version: 2, status: "ready" }), "x".repeat(1025)])("recovers corrupt or oversized status without silently deleting it", (raw) => {
    const key = instrumentReviewStorageKey("alice", "AAPL")!;
    localStorage.setItem(key, raw);
    expect(readInstrumentReviewStatus("alice", "AAPL").error).toBeTruthy();
    expect(localStorage.getItem(key)).toBe(raw);
    expect(saveInstrumentReviewStatus("alice", "AAPL", "watching").error).toBeNull();
    expect(readInstrumentReviewStatus("alice", "AAPL").status).toBe("watching");
  });

  it("rejects invalid context before accessing storage", () => {
    const read = vi.spyOn(localStorage, "getItem");
    const write = vi.spyOn(localStorage, "setItem");
    expect(readInstrumentReviewStatus(undefined, "AAPL").error).toBeTruthy();
    expect(readInstrumentReviewStatus("a".repeat(257), "AAPL").error).toBeTruthy();
    expect(saveInstrumentReviewStatus("alice", "bad symbol", "ready").error).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("reports unavailable storage without claiming success", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("QuotaExceeded"); });
    const result = saveInstrumentReviewStatus("alice", "AAPL", "ready");
    expect(result.error).toMatch(/could not be saved/);
    expect(result.updatedAt).toBeNull();
  });

  it("refreshes the list after same-tab saves and account switches", () => {
    const { result, rerender } = renderHook(({ account }) => useInstrumentReviewStatuses(account, ["AAPL", "TCS"]), { initialProps: { account: "alice" } });
    act(() => { saveInstrumentReviewStatus("alice", "AAPL", "watching"); });
    expect(result.current.AAPL).toBe("watching");
    rerender({ account: "bob" });
    expect(result.current.AAPL).toBe("unreviewed");
    act(() => { saveInstrumentReviewStatus("alice", "AAPL", "archived"); });
    expect(result.current.AAPL).toBe("unreviewed");
  });

  it("retains drafts by account and instrument and protects a newer draft from an old save", () => {
    const { result, rerender } = renderHook(({ account, symbol }) => useInstrumentNoteDraft(account, symbol), { initialProps: { account: "draft-alice", symbol: "AAPL" } });
    act(() => { writeInstrumentNoteDraft("draft-alice", "AAPL", { kind: "thesis", content: "Original" }); });
    rerender({ account: "draft-alice", symbol: "TCS" });
    expect(result.current.content).toBe("");
    rerender({ account: "draft-bob", symbol: "AAPL" });
    expect(result.current.content).toBe("");
    rerender({ account: "draft-alice", symbol: "AAPL" });
    expect(result.current).toEqual({ kind: "thesis", content: "Original" });
    act(() => { writeInstrumentNoteDraft("draft-alice", "AAPL", { kind: "note", content: "Newer" }); });
    act(() => { discardInstrumentNoteDraft("draft-alice", "AAPL", { kind: "thesis", content: "Original" }); });
    expect(result.current.content).toBe("Newer");
    act(() => { discardInstrumentNoteDraft("draft-alice", "AAPL"); });
  });

  it("bounds draft size and count without evicting existing drafts", () => {
    expect(writeInstrumentNoteDraft("capacity", "AAPL", { kind: "note", content: "x".repeat(2001) })).toMatch(/2,000/);
    for (let index = 0; index < 50; index++) expect(writeInstrumentNoteDraft("capacity", `SYM${index}`, { kind: "note", content: "Retain me" })).toBeNull();
    expect(writeInstrumentNoteDraft("capacity", "EXTRA", { kind: "note", content: "Next" })).toMatch(/50 unsaved/);
    expect(writeInstrumentNoteDraft("capacity", "SYM0", { kind: "note", content: "Updated existing" })).toBeNull();
    for (let index = 0; index < 50; index++) discardInstrumentNoteDraft("capacity", `SYM${index}`);
  });

  it("does not count empty note-type choices as unsaved drafts", () => {
    for (let index = 0; index < 60; index++) expect(writeInstrumentNoteDraft("empty-types", `SYM${index}`, { kind: "thesis", content: "" })).toBeNull();
    expect(writeInstrumentNoteDraft("empty-types", "AAPL", { kind: "thesis", content: "First real note" })).toBeNull();
    discardInstrumentNoteDraft("empty-types", "AAPL");
  });
});
