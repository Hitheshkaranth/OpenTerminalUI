import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HotlistsPage } from "../pages/Hotlists";
import {
  fetchIdeasBoard,
  type IdeaCategory,
  type IdeasBoard,
} from "../api/ideasThemes";

vi.mock("../api/ideasThemes", async (importActual) => {
  const actual = await importActual<typeof import("../api/ideasThemes")>();
  return {
    ...actual,
    fetchIdeasBoard: vi.fn(),
  };
});

const fetchMock = vi.fn();
global.fetch = fetchMock;

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

let capturedSearch = "";

function LocationSpy() {
  const location = useLocation();
  capturedSearch = location.search;
  return null;
}

function buildBoard(categories: IdeaCategory[]): IdeasBoard {
  return {
    market: "IN",
    generated_at: "2026-04-02T10:00:00.000Z",
    categories,
    warnings: [],
  };
}

function renderHotlists() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={["/hotlists"]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <HotlistsPage />
        <LocationSpy />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Hotlists Ideas board", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        list_type: "gainers",
        market: "IN",
        items: [],
        updated_at: "2026-04-02T10:00:00.000Z",
      }),
    });

    (fetchIdeasBoard as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildBoard([
        {
          id: "insider_buying",
          label: "Insider Buying",
          description: "Recent insider purchases on the desk.",
          items: [
            {
              symbol: "RELIANCE",
              name: "Reliance Industries",
              headline: "MD adds shares on NSE",
              metric_label: "Holdings",
              metric_value: 12.5,
              date: "2026-04-01",
              source_url: null,
            },
          ],
        },
      ]),
    );
  });

  it("defaults to the lists view", async () => {
    renderHotlists();
    await screen.findByRole("button", { name: /ideas/i });
    expect(screen.queryByText(/insider buying/i)).not.toBeInTheDocument();
  });

  it("toggles to the ideas view and writes ?view=ideas to the URL", async () => {
    renderHotlists();
    const ideasButton = await screen.findByRole("button", { name: /ideas/i });

    fireEvent.click(ideasButton);
    await screen.findByText(/insider buying/i);
    expect(capturedSearch).toBe("?view=ideas");
    expect(screen.getByText("RELIANCE")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /lists/i }));
    expect(capturedSearch).toBe("");
    expect(screen.queryByText(/insider buying/i)).not.toBeInTheDocument();
  });
});