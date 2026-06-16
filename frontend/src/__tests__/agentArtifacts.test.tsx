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
