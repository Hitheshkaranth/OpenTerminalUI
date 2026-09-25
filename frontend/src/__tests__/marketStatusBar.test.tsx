import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

let marketStatus: Record<string, unknown> = {};
vi.mock("../hooks/useStocks", () => ({ useMarketStatus: () => ({ data: marketStatus }) }));
vi.mock("../api/providers", () => ({ useProvidersStatus: () => ({ data: undefined, isLoading: true, error: null }) }));

import { MarketStatusBar } from "../components/layout/MarketStatusBar";

function renderBar() {
  return render(
    <MemoryRouter>
      <MarketStatusBar />
    </MemoryRouter>,
  );
}

describe("MarketStatusBar exchange status", () => {
  it("uses backend exchange-hours status, not NSE's raw first marketState entry", () => {
    // NSE reports "Open" on the capital market entry even before 09:15 / after close.
    marketStatus = {
      marketState: [{ market: "Capital Market", marketStatus: "Open" }],
      nseStatus: "CLOSED",
      nyseStatus: "OPEN",
    };
    renderBar();
    expect(screen.getByText("NSE: CLOSED")).toBeInTheDocument();
    expect(screen.getByText("NYSE: OPEN")).toBeInTheDocument();
  });

  it("falls back to the Capital Market segment only, with an exact OPEN match", () => {
    marketStatus = {
      marketState: [
        { market: "Currency", marketStatus: "Open" },
        { market: "Capital Market", marketStatus: "Pre-Open" },
      ],
    };
    renderBar();
    expect(screen.getByText("NSE: CLOSED")).toBeInTheDocument();
  });
});
