import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FreshnessBadge } from "../shared/chart/FreshnessBadge";

describe("FreshnessBadge", () => {
  it("shows Live when data is fresh", () => {
    const recent = new Date().toISOString();
    render(<FreshnessBadge lastUpdate={recent} exchange="NSE" />);
    const el = screen.getByText(/Live|Market closed/);
    expect(el).toBeTruthy();
  });

  it("shows stale indicator for old data", () => {
    const old = new Date(Date.now() - 300_000).toISOString();
    render(<FreshnessBadge lastUpdate={old} exchange="NYSE" />);
    const el = screen.getByText(/ago|Offline|Market closed/);
    expect(el).toBeTruthy();
  });

  it("handles null lastUpdate", () => {
    render(<FreshnessBadge lastUpdate={null} exchange="NSE" />);
    expect(screen.getByText(/Offline|Market closed/)).toBeTruthy();
  });
});
