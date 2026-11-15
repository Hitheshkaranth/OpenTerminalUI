import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstrumentNotesPanel } from "../components/watchlist/InstrumentNotesPanel";
import { addNote, deleteNote, listNotes, type NoteItem } from "../api/agentExtras";
import { discardInstrumentNoteDraft, readInstrumentReviewStatus } from "../store/instrumentNotesStore";

const auth = vi.hoisted(() => ({ accountId: "notes-alice" as string | null }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: auth.accountId ? { id: auth.accountId } : null }) }));
vi.mock("../api/agentExtras", () => ({ listNotes: vi.fn(), addNote: vi.fn(), deleteNote: vi.fn() }));
const note = (content: string, symbol = "AAPL"): NoteItem => ({ id: "note-1", symbol, kind: "note", content, source: "user", created_at: "2026-11-14T00:00:00Z" });

function setup(symbol = "AAPL", strict = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrap = (next: string) => <QueryClientProvider client={client}>{strict ? <StrictMode><InstrumentNotesPanel symbol={next} /></StrictMode> : <InstrumentNotesPanel symbol={next} />}</QueryClientProvider>;
  const rendered = render(wrap(symbol));
  return { ...rendered, client, invalidate, switchTo: (next: string) => rendered.rerender(wrap(next)) };
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.accountId = "notes-alice";
  localStorage.clear();
  vi.mocked(listNotes).mockResolvedValue({ items: [] });
  vi.mocked(addNote).mockResolvedValue(note("Saved"));
  for (const account of ["notes-alice", "notes-bob"]) for (const symbol of ["AAPL", "TCS"]) discardInstrumentNoteDraft(account, symbol);
});
afterEach(() => vi.restoreAllMocks());

describe("linked instrument research notes", () => {
  it("saves a plain-text note through the existing owned server API", async () => {
    const { invalidate } = setup();
    await screen.findByText("No saved notes for AAPL.");
    fireEvent.change(screen.getByLabelText("Note type"), { target: { value: "thesis" } });
    fireEvent.change(screen.getByLabelText("Note for AAPL"), { target: { value: "  Inspect margins  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save note", exact: true }));
    await screen.findByText("Note saved to your account.");
    expect(addNote).toHaveBeenCalledWith({ symbol: "AAPL", kind: "thesis", content: "Inspect margins" }, { signal: expect.any(AbortSignal) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["agent", "notes", "notes-alice"] });
    expect(screen.getByLabelText("Note for AAPL")).toHaveValue("");
  });

  it("preserves unsaved AAPL text across TCS and account changes", async () => {
    const view = setup();
    fireEvent.change(screen.getByLabelText("Note for AAPL"), { target: { value: "AAPL private draft" } });
    view.switchTo("TCS");
    expect(screen.getByLabelText("Note for TCS")).toHaveValue("");
    auth.accountId = "notes-bob";
    view.switchTo("AAPL");
    expect(screen.getByLabelText("Note for AAPL")).toHaveValue("");
    auth.accountId = "notes-alice";
    view.switchTo("AAPL");
    expect(screen.getByLabelText("Note for AAPL")).toHaveValue("AAPL private draft");
    expect(addNote).not.toHaveBeenCalled();
  });

  it("keeps query caches isolated when the account changes", async () => {
    vi.mocked(listNotes).mockImplementation(async () => ({ items: [note(auth.accountId === "notes-alice" ? "Alice only" : "Bob only")] }));
    const view = setup();
    await screen.findByText("Alice only");
    auth.accountId = "notes-bob";
    view.switchTo("AAPL");
    expect(screen.queryByText("Alice only")).not.toBeInTheDocument();
    await screen.findByText("Bob only");
    expect(view.client.getQueryData(["agent", "notes", "notes-alice", "AAPL"])).toBeDefined();
  });

  it("does not clear the TCS draft or show AAPL success when an old save completes", async () => {
    let resolveSave: ((value: NoteItem) => void) | undefined;
    vi.mocked(addNote).mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    const view = setup();
    fireEvent.change(screen.getByLabelText("Note for AAPL"), { target: { value: "AAPL in flight" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note", exact: true }));
    await waitFor(() => expect(addNote).toHaveBeenCalled());
    const oldSignal = vi.mocked(addNote).mock.calls[0][1]!.signal!;
    view.switchTo("TCS");
    expect(oldSignal.aborted).toBe(true);
    fireEvent.change(screen.getByLabelText("Note for TCS"), { target: { value: "TCS separate draft" } });
    resolveSave?.(note("AAPL in flight"));
    await waitFor(() => expect(screen.getByLabelText("Note for TCS")).toHaveValue("TCS separate draft"));
    expect(screen.queryByText("Note saved to your account.")).not.toBeInTheDocument();
  });

  it("retains the draft after a failed save and allows a retry", async () => {
    vi.mocked(addNote).mockRejectedValueOnce(new Error("offline"));
    setup();
    fireEvent.change(screen.getByLabelText("Note for AAPL"), { target: { value: "Keep this" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note", exact: true }));
    await screen.findByText(/Note could not be saved/);
    expect(screen.getByLabelText("Note for AAPL")).toHaveValue("Keep this");
    fireEvent.click(screen.getByRole("button", { name: "Save note", exact: true }));
    await screen.findByText("Note saved to your account.");
  });

  it("persists review status separately and reports quota failures", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Review status"), { target: { value: "researching" } });
    fireEvent.click(screen.getByRole("button", { name: "Save status" }));
    expect(readInstrumentReviewStatus("notes-alice", "AAPL").status).toBe("researching");
    expect(addNote).not.toHaveBeenCalled();
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    fireEvent.change(screen.getByLabelText("Review status"), { target: { value: "archived" } });
    fireEvent.click(screen.getByRole("button", { name: "Save status" }));
    await screen.findByText(/Review status could not be saved/);
    expect(screen.queryByText("Review status saved in this browser.")).not.toBeInTheDocument();
  });

  it("renders saved markup as literal text and excludes another symbol's data", async () => {
    const literal = '<img src="x" onerror="alert(1)">';
    vi.mocked(listNotes).mockResolvedValue({ items: [note(literal), note("Other symbol", "TCS")] });
    const { container } = setup();
    await screen.findByText(literal);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByText("Other symbol")).not.toBeInTheDocument();
  });

  it("deletes an owned server note and refreshes only this account", async () => {
    vi.mocked(listNotes).mockResolvedValue({ items: [note("Remove me")] });
    vi.mocked(deleteNote).mockImplementation(async () => { vi.mocked(listNotes).mockResolvedValue({ items: [] }); return { status: "deleted" }; });
    const { invalidate } = setup();
    await screen.findByText("Remove me");
    fireEvent.click(screen.getByRole("button", { name: "Delete AAPL note note-1" }));
    await waitFor(() => expect(deleteNote).toHaveBeenCalledWith("note-1", expect.anything()));
    await screen.findByText("No saved notes for AAPL.");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["agent", "notes", "notes-alice"] });
  });

  it("makes no notes requests when signed out", () => {
    auth.accountId = null;
    setup();
    expect(screen.getByText(/Sign in to save instrument notes/)).toBeInTheDocument();
    expect(listNotes).not.toHaveBeenCalled();
  });

  it("can save after StrictMode rehearses effect cleanup", async () => {
    setup("AAPL", true);
    fireEvent.change(screen.getByLabelText("Note for AAPL"), { target: { value: "StrictMode note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note", exact: true }));
    await screen.findByText("Note saved to your account.");
    const signal = vi.mocked(addNote).mock.calls[0][1]!.signal!;
    expect(signal.aborted).toBe(false);
  });
});
