import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentConsole } from "../agent/components/AgentConsole";
import { useAgentStore } from "../agent/agentStore";
import { createRun, getRun, streamRun } from "../agent/agentApi";
import { getThread } from "../api/agentExtras";

vi.mock("../agent/agentApi", () => ({ createRun: vi.fn(), getRun: vi.fn(), streamRun: vi.fn(), cancelRun: vi.fn(), resumeRun: vi.fn() }));
vi.mock("../api/agentExtras", () => ({ getThread: vi.fn() }));
vi.mock("../agent/screenContext", () => ({ buildScreenContext: () => ({ route: "/research", symbol: "AAPL", market: "US", portfolio_id: "current-portfolio", dossier_id: "current-dossier" }) }));
const state = () => useAgentStore.getState();

beforeEach(async () => {
  await state().setAuthenticatedUser(null);
  sessionStorage.clear();
  vi.resetAllMocks();
  await state().setAuthenticatedUser("alice");
  state().newThread();
  useAgentStore.setState({ open: true, debate: false, strategy: false, screener: false, ensemble: false });
  vi.mocked(createRun).mockResolvedValue("historic-run");
  vi.mocked(streamRun).mockImplementation(async (_run, receive) => { receive({ type: "final", content: "Historical evidence only." }); });
});

describe("Historical evidence cutoff", () => {
  it("exposes a labeled cutoff and disables current-data modes and memory", () => {
    render(<AgentConsole />);
    fireEvent.change(screen.getByLabelText("Evidence cutoff (UTC)"), { target: { value: "2025-01-31" } });
    expect(screen.getByText("Historical evidence through 2025-01-31")).toBeInTheDocument();
    for (const name of ["Debate", "Strategy Lab", "Screener", "Ensemble"]) {
      expect(screen.getByRole("button", { name: `Toggle ${name} mode` })).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Memory" })).toBeDisabled();
    expect(screen.queryByText(/Selected portfolio/)).not.toBeInTheDocument();
  });

  it("sends the historical cutoff and excludes live workspace evidence from requests", async () => {
    state().setHistoricalAsOf("2025-01-31");
    state().toggleEnsemble();
    expect(state().ensemble).toBe(false);
    await state().startRun("Research the company's margins");
    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({ mode: "standard", context: {
      symbol: "AAPL", market: "US", historical_as_of: "2025-01-31" } }));
    state().setHistoricalAsOf("2025-02-01");
    expect(state().historicalAsOf).toBe("2025-01-31");
    await state().startRun("What about revenue?");
    expect(vi.mocked(createRun).mock.calls[1][0].context?.historical_as_of).toBe("2025-01-31");
    state().newThread();
    expect(state().historicalAsOf).toBeNull();
  });

  it("locks the cutoff after sending and unlocks it only for a new thread", async () => {
    render(<AgentConsole />);
    fireEvent.change(screen.getByLabelText("Evidence cutoff (UTC)"), { target: { value: "2025-01-31" } });
    await act(async () => state().startRun("Research AAPL"));
    expect(screen.getByLabelText("Evidence cutoff (UTC)")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    expect(screen.getByLabelText("Evidence cutoff (UTC)")).toBeEnabled();
    expect(screen.getByLabelText("Evidence cutoff (UTC)")).toHaveValue("");
  });

  it("restores a saved thread cutoff and prevents replacing it with a new date", async () => {
    vi.mocked(getThread).mockResolvedValue({ thread_id: "saved", context: { historical_as_of: "2025-01-31", symbol: "MSFT", market: "US" },
      messages: [{ id: "msg", role: "user", content: "Prior question", run_id: "historic" }] });
    await state().loadThread("saved");
    expect(state().historicalAsOf).toBe("2025-01-31");
    state().setHistoricalAsOf(null);
    expect(state().historicalAsOf).toBe("2025-01-31");
    await state().startRun("What about margins?");
    expect(vi.mocked(createRun).mock.calls[0][0].context?.symbol).toBe("MSFT");
  });

  it("preserves an inherited cutoff even before a saved thread has final messages", async () => {
    vi.mocked(getThread).mockResolvedValue({ thread_id: "pending", context: { historical_as_of: "2025-01-31" }, messages: [] });
    await state().loadThread("pending");
    state().setHistoricalAsOf("2025-02-01");
    expect(state().historicalAsOf).toBe("2025-01-31");
    expect(state().historicalLocked).toBe(true);
  });

  it("restores cutoff after account-scoped run recovery", async () => {
    await state().setAuthenticatedUser(null);
    sessionStorage.setItem("ot:agent:recovery:v1:alice", JSON.stringify({ version: 1, owner: "alice", runId: "historic", threadId: "saved" }));
    vi.mocked(getRun).mockResolvedValue({ run_id: "historic", thread_id: "saved", prompt: "Past", final: null,
      status: "interrupted", context: { historical_as_of: "2025-01-31" } });
    await state().setAuthenticatedUser("alice");
    expect(state().historicalAsOf).toBe("2025-01-31");
    await state().setAuthenticatedUser("bob");
    expect(state().historicalAsOf).toBeNull();
  });

  it("rejects invalid and future dates and refuses the screener shortcut", async () => {
    for (const date of ["2025-02-30", "bad", "2999-01-01"]) {
      state().setHistoricalAsOf(date);
      expect(state().historicalAsOf).toBeNull();
    }
    state().setHistoricalAsOf("2025-01-31");
    await state().runScreenerFor("AAPL");
    expect(createRun).not.toHaveBeenCalled();
    expect(state().runNotice).toContain("new thread");
  });
});
