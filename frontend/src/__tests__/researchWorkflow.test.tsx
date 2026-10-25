import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ResearchDossiersPage } from "../pages/ResearchDossiers";
import { api } from "../api/base";
import { dossierDraft, emptyDossier } from "../api/researchDossiers";
import { parseFrozenBars } from "../components/research/ResearchExperiments";
import { buildScreenContext } from "../agent/screenContext";
import { useWorkspaceContextStore } from "../agent/workspaceContextStore";
import { parseSSEBuffer } from "../agent/sse";

vi.mock("../api/base", () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }, extractApiErrorMessage: (e: Error) => e.message }));
const dossier = { ...emptyDossier(), id: "d1", title: "Margin recovery", symbol: "TCS", market: "IN", thesis: "Margins may improve", revision: 2, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };

beforeEach(() => { vi.clearAllMocks(); useWorkspaceContextStore.getState().clearContext(); vi.mocked(api.get).mockResolvedValue({ data: { items: [] } }); });

describe("research workflows", () => {
  it("creates a dossier through the visible form", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: dossier });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ResearchDossiersPage /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "New dossier" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Margin recovery" } });
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "TCS" } });
    fireEvent.change(screen.getByLabelText("Thesis"), { target: { value: "Margins may improve" } });
    fireEvent.click(screen.getByRole("button", { name: "Save research" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/research/dossiers", expect.objectContaining({ title: "Margin recovery", symbol: "TCS", thesis: "Margins may improve" })));
    expect(await screen.findByText("Research saved.")).toBeInTheDocument();
  });

  it("does not send server-owned fields back as an update", () => {
    const draft = dossierDraft(dossier);
    expect(draft).not.toHaveProperty("id"); expect(draft).not.toHaveProperty("revision");
    expect(draft.thesis).toBe(dossier.thesis);
  });

  it("edits an existing thesis with its revision and accessible label", async () => {
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: { items: url === "/research/dossiers" ? [dossier] : [] } }));
    vi.mocked(api.patch).mockResolvedValue({ data: { ...dossier, revision: 3 } });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={["/equity/research-dossiers?id=d1"]}><ResearchDossiersPage /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Edit thesis" }));
    fireEvent.change(screen.getByLabelText("Thesis", { exact: true }), { target: { value: "Revised thesis" } });
    fireEvent.click(screen.getByRole("button", { name: "Save research" }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/research/dossiers/d1", expect.objectContaining({ thesis: "Revised thesis", expected_revision: 2 })));
    expect(vi.mocked(api.patch).mock.calls[0][1]).not.toHaveProperty("id");
  });

  it("only includes selections belonging to the current route", () => {
    useWorkspaceContextStore.getState().setContext({ selected_symbols: ["AAPL"], dossier_id: "d1" }, window.location.pathname);
    expect(buildScreenContext().selected_symbols).toEqual(["AAPL"]);
    useWorkspaceContextStore.getState().setContext({ selected_symbols: ["TCS"] }, "/another-screen");
    expect(buildScreenContext().selected_symbols).toBeUndefined();
  });

  it("reads replay event ids and CRLF frames", () => {
    const result = parseSSEBuffer(': heartbeat\r\n\r\nid: 4\r\ndata: {"type":"final","content":"saved"}\r\n\r\n');
    expect(result.events).toEqual([{ type: "final", content: "saved" }]); expect(result.lastEventId).toBe(4);
  });

  it("requires publication timestamps and rejects missing numeric values", () => {
    expect(() => parseFrozenBars("date,close\n2026-01-01,100")).toThrow("available_at");
    const header = "date,available_at,open,high,low,close,volume\n";
    const rows = Array.from({ length: 10 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z,2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z,100,110,90,105,1000`).join("\n");
    expect(parseFrozenBars(header + rows)).toHaveLength(10);
    expect(() => parseFrozenBars(header + rows.replace(",100,110", ",,110"))).toThrow("missing or invalid");
  });
});
