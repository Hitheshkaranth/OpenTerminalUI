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
    expect(buttons[0].textContent).toBe("Confirm paper order");
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

  it("shows rebalance quantities, marks and costs before paper confirmation", () => {
    render(<ProposalCard proposal={makeFixture({ type: "rebalance", payload: {
      deltas: [{ symbol: "AAPL", current_weight: 0.4, target_weight: 0.6, implied_delta_qty: 12.5, price_used: 200 }],
      cash_reserve: 100, valued_at: "2026-10-25T12:00:00Z", execution_profile: { slippage_bps: 5, commission_bps: 5, max_price_drift_pct: 1 },
    } })} />);
    expect(screen.getByText("Paper portfolio only. No live broker orders.")).toBeInTheDocument();
    expect(screen.getByText("12.5")).toBeInTheDocument(); expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText(/Cash reserve: 100/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm paper rebalance" })).toBeEnabled();
  });

  it("hydrates incomplete tool proposals before enabling confirmation", async () => {
    const fixture = makeFixture({ type: "journal_entry", payload: { body: "Review the source evidence" } });
    const get = vi.spyOn(agentExtras, "getProposal").mockResolvedValue(fixture);
    render(<ProposalCard proposal={{ ...fixture, expires_at: "", payload: {} }} />);
    expect(screen.queryByRole("button", { name: "Save research note" })).toBeNull();
    await waitFor(() => expect(get).toHaveBeenCalledWith("p-1"));
    expect(await screen.findByRole("button", { name: "Save research note" })).toBeEnabled();
    expect(screen.getByText("Review the source evidence")).toBeInTheDocument();
  });

  it("shows backend failure reason without a success result", async () => {
    vi.spyOn(agentExtras, "confirmProposal").mockResolvedValue({ id: "p-1", status: "failed", result: { error: "Quote moved beyond the reviewed price" } });
    render(<ProposalCard proposal={makeFixture()} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm paper order" }));
    expect(await screen.findByText(/Quote moved beyond the reviewed price/)).toBeInTheDocument();
    expect(screen.queryByText(/completed/)).toBeNull();
  });
});
