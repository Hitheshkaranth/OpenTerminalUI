import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaperRiskPanel } from "../agent/components/PaperRiskPanel";
import { getAgentRiskPolicy, saveAgentRiskPolicy } from "../api/agentExtras";

vi.mock("../api/agentExtras", () => ({ getAgentRiskPolicy: vi.fn(), saveAgentRiskPolicy: vi.fn() }));
const policy = { enabled: false, max_position_pct: 20, risk_budget_pct: 1,
  require_stop: true, max_quote_drift_pct: 1, max_quote_age_seconds: 3600 };

beforeEach(() => { vi.resetAllMocks(); vi.mocked(getAgentRiskPolicy).mockResolvedValue(policy); });

describe("Paper risk policy settings", () => {
  it("loads saved policy and changes settings only after an explicit save", async () => {
    vi.mocked(saveAgentRiskPolicy).mockImplementation(async (value) => value);
    render(<PaperRiskPanel />);
    const enabled = await screen.findByLabelText("Enforce paper risk limits");
    expect(enabled).not.toBeChecked();
    fireEvent.click(enabled);
    fireEvent.change(screen.getByLabelText("Maximum position (%)"), { target: { value: "15" } });
    expect(saveAgentRiskPolicy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save paper risk limits" }));
    expect(await screen.findByText("Paper risk limits saved and enforced.")).toBeInTheDocument();
    expect(saveAgentRiskPolicy).toHaveBeenCalledWith({ ...policy, enabled: true, max_position_pct: 15 });
    expect(screen.getByText(/A hypothetical stop is not placed/)).toBeInTheDocument();
  });

  it("allows retry after a failed load without showing editable defaults", async () => {
    vi.mocked(getAgentRiskPolicy).mockRejectedValueOnce(new Error("offline"));
    render(<PaperRiskPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry loading limits" }));
    expect(await screen.findByLabelText("Enforce paper risk limits")).not.toBeChecked();
    expect(getAgentRiskPolicy).toHaveBeenCalledTimes(2);
  });

  it("retains draft and shows a failed save rather than claiming enforcement", async () => {
    vi.mocked(saveAgentRiskPolicy).mockRejectedValue(new Error("save failed"));
    render(<PaperRiskPanel />);
    fireEvent.click(await screen.findByLabelText("Enforce paper risk limits"));
    fireEvent.click(screen.getByRole("button", { name: "Save paper risk limits" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText("Paper risk limits saved and enforced.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Enforce paper risk limits")).toBeChecked();
    expect(screen.getByRole("button", { name: "Save paper risk limits" })).toBeEnabled();
  });
});
