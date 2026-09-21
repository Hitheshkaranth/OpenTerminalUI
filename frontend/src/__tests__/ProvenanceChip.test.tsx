import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProvenanceChip } from "../components/common/ProvenanceChip";

vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: () => ({ selectedMarket: "NSE" }),
}));

describe("ProvenanceChip", () => {
  it("renders nothing for null", () => {
    const { container } = render(<ProvenanceChip provenance={null} />);
    expect(container.children.length).toBe(0);
    expect(screen.queryByTestId("provenance-chip")).not.toBeInTheDocument();
  });

  it("renders nothing for undefined", () => {
    const { container } = render(<ProvenanceChip provenance={undefined} />);
    expect(container.children.length).toBe(0);
  });

  it('renders "SYNTHETIC" with data-quality="synthetic"', () => {
    render(<ProvenanceChip provenance={{ source: "mock", quality: "synthetic", as_of: null, latency_ms: null, note: null }} />);
    const chip = screen.getByTestId("provenance-chip");
    expect(chip).toHaveAttribute("data-quality", "synthetic");
    expect(chip).toHaveTextContent("SYNTHETIC");
  });

  it('renders "DELAYED · YAHOO" for delayed/yahoo', () => {
    render(<ProvenanceChip provenance={{ source: "yahoo", quality: "delayed", as_of: "2024-01-15T10:30:00Z", latency_ms: 250, note: "Yahoo 15m delayed" }} />);
    const chip = screen.getByTestId("provenance-chip");
    expect(chip).toHaveAttribute("data-quality", "delayed");
    expect(chip).toHaveTextContent("DELAYED · YAHOO");
  });

  it("compact mode omits the source suffix", () => {
    render(<ProvenanceChip provenance={{ source: "yahoo", quality: "delayed", as_of: null, latency_ms: null, note: null }} compact />);
    const chip = screen.getByTestId("provenance-chip");
    expect(chip).toHaveTextContent("DELAYED");
    expect(chip).not.toHaveTextContent("YAHOO");
  });

  it("title includes the note", () => {
    render(<ProvenanceChip provenance={{ source: "yahoo", quality: "delayed", as_of: "2024-01-15T10:30:00Z", latency_ms: 250, note: "Yahoo 15m delayed" }} />);
    const chip = screen.getByTestId("provenance-chip");
    expect(chip).toHaveAttribute("title", "Yahoo 15m delayed · as of 2024-01-15T10:30:00Z · 250ms");
  });
});