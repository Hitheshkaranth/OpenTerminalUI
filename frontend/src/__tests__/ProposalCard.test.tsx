import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ProposalCard } from "../agent/components/ProposalCard";
import * as agentExtras from "../api/agentExtras";

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const makeFixture = (overrides?: Partial<agentExtras.ProposalItem>): agentExtras.ProposalItem => ({
  proposal_id: "p-1",
  type: "paper_order",
  summary: "Buy 10 shares of AAPL",
  payload: { symbol: "AAPL", side: "buy", quantity: 10 },
  status: "pending",
  expires_at: "2026-01-02T00:00:00Z",
  ...overrides,
});

describe("ProposalCard", () => {
  it("renders summary and type badge", () => {
    render(<ProposalCard proposal={makeFixture()} />);
    expect(screen.getByText("Buy 10 shares of AAPL")).toBeTruthy();
    expect(screen.getByText("paper order")).toBeTruthy();
  });

  it("renders Confirm and Reject buttons for pending proposal", () => {
    render(<ProposalCard proposal={makeFixture()} />);
    const buttons = screen.queryAllByRole("button");
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe("Confirm");
    expect(buttons[1].textContent).toBe("Reject");
  });

  it("Confirm calls confirmProposal and shows confirmed", async () => {
    const confirmSpy = vi.spyOn(agentExtras, "confirmProposal").mockResolvedValue({
      id: "p-1",
      status: "confirmed",
      result: { order_id: "ord-42" },
    });
    render(<ProposalCard proposal={makeFixture()} />);
    const buttons = screen.queryAllByRole("button");
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith("p-1"));
    await waitFor(() => {
      const el = document.querySelector('[class*="text-terminal-pos"]');
      expect(el).toBeTruthy();
      expect(el!.textContent).toContain("ord-42");
    });
  });

  it("a rejected proposal does not show action buttons", () => {
    render(<ProposalCard proposal={makeFixture({ status: "rejected" })} />);
    const buttons = screen.queryAllByRole("button");
    expect(buttons.length).toBe(0);
    expect(screen.getByText("rejected")).toBeTruthy();
  });

  it("Reject flips to rejected", async () => {
    const rejectSpy = vi.spyOn(agentExtras, "rejectProposal").mockResolvedValue({ status: "ok" });
    render(<ProposalCard proposal={makeFixture()} />);
    const buttons = screen.queryAllByRole("button");
    fireEvent.click(buttons[1]);
    await waitFor(() => expect(rejectSpy).toHaveBeenCalledWith("p-1"));
  });
});