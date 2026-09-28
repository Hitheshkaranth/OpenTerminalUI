import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LaunchpadResearchNotesPanel } from "../components/layout/ResearchNotesPanel";
import { addNote, deleteNote, listNotes, type NoteItem } from "../api/agentExtras";

vi.mock("../api/agentExtras", () => ({
  listNotes: vi.fn(),
  addNote: vi.fn(),
  deleteNote: vi.fn(),
}));

const listNotesMock = vi.mocked(listNotes);
const addNoteMock = vi.mocked(addNote);
const deleteNoteMock = vi.mocked(deleteNote);

function note(overrides: Partial<NoteItem> = {}): NoteItem {
  return {
    id: "note-1",
    symbol: "AAPL",
    kind: "note",
    content: "Watch gross margin after earnings.",
    source: "user",
    created_at: "2026-09-27T10:00:00Z",
    ...overrides,
  };
}

function renderPanel(symbol?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <LaunchpadResearchNotesPanel
        panel={{ id: "notes", type: "research-notes", title: "Research Notes", symbol, x: 0, y: 0, w: 12, h: 4 }}
      />
    </QueryClientProvider>,
  );
  return { client, invalidateSpy };
}

describe("LaunchpadResearchNotesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading then the general-notes empty state", async () => {
    let resolveNotes: ((value: { items: NoteItem[] }) => void) | undefined;
    listNotesMock.mockReturnValue(new Promise((resolve) => { resolveNotes = resolve; }));

    renderPanel();
    expect(screen.getByText("Loading notes…")).toBeInTheDocument();
    expect(screen.getByText("General research notes")).toBeInTheDocument();

    resolveNotes?.({ items: [] });
    expect(await screen.findByText("No research notes yet.")).toBeInTheDocument();
    expect(listNotesMock).toHaveBeenCalledWith(undefined);
  });

  it("normalizes the linked symbol and creates a trimmed note", async () => {
    const user = userEvent.setup();
    listNotesMock.mockResolvedValue({ items: [] });
    addNoteMock.mockResolvedValue(note());

    renderPanel("  aapl ");
    await screen.findByText("No research notes yet.");
    await user.type(screen.getByLabelText("Note content"), "  Check guidance  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(addNoteMock).toHaveBeenCalledWith({ symbol: "AAPL", kind: "note", content: "Check guidance" });
    });
    expect(screen.getByText("Linked · AAPL")).toBeInTheDocument();
  });

  it("filters by kind and keeps reflections read-only", async () => {
    const user = userEvent.setup();
    listNotesMock.mockResolvedValue({
      items: [
        note(),
        note({ id: "thesis-1", kind: "thesis", content: "Services growth supports the rerating." }),
        note({ id: "reflection-1", kind: "reflection", content: "The entry ignored event risk.", source: "reflection" }),
      ],
    });

    renderPanel("AAPL");
    expect(await screen.findByText("Watch gross margin after earnings.")).toBeInTheDocument();
    expect(screen.getByText("Read only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete reflection/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Thesis" }));
    expect(screen.getByText("Services growth supports the rerating.")).toBeInTheDocument();
    expect(screen.queryByText("Watch gross margin after earnings.")).not.toBeInTheDocument();
  });

  it("deletes a user note and invalidates the shared notes query", async () => {
    const user = userEvent.setup();
    listNotesMock.mockResolvedValue({ items: [note()] });
    deleteNoteMock.mockResolvedValue({ status: "deleted" });
    const { invalidateSpy } = renderPanel("AAPL");

    await user.click(await screen.findByRole("button", { name: "Delete note note from user" }));
    await waitFor(() => expect(deleteNoteMock).toHaveBeenCalledWith("note-1"));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["agent", "notes", "AAPL"] });
  });

  it("shows API failures without replacing the composer", async () => {
    listNotesMock.mockRejectedValue(new Error("Notes service unavailable"));
    renderPanel("AAPL");

    expect(await screen.findByText("Notes service unavailable")).toBeInTheDocument();
    expect(screen.getByLabelText("Note content")).toBeEnabled();
  });
});
