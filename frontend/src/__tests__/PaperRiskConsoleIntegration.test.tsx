import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentConsole } from "../agent/components/AgentConsole";
import { AuthContextRef } from "../contexts/AuthContext";
import { useAgentStore } from "../agent/agentStore";
import { api, setAccessTokenGetter } from "../api/base";
import { getAgentRiskPolicy, saveAgentRiskPolicy } from "../api/agentExtras";
import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";

const policy = { enabled: false, max_position_pct: 20, risk_budget_pct: 1,
  require_stop: true, max_quote_drift_pct: 1, max_quote_age_seconds: 3600 };

function auth(userId: string | null) {
  return { user: userId ? { id: userId, email: `${userId}@test.local`, role: "trader" as const } : null,
    accessToken: userId, isAuthenticated: !!userId, isLoading: false, isInitializing: false,
    login: vi.fn(), register: vi.fn(), logout: vi.fn(), hasRole: () => true };
}

beforeEach(() => {
  useAgentStore.setState({ open: true, running: false, messages: [], artifacts: [],
    authenticatedUserId: "user-a", transportBusy: false, activeRunId: null });
});

afterEach(() => { vi.restoreAllMocks(); setAccessTokenGetter(null); });

describe("Paper risk settings through the agent console", () => {
  it("opens from the authenticated console and persists only explicit save", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue({ data: { ...policy } });
    const put = vi.spyOn(api, "put").mockImplementation(async (_url, value) => ({ data: value }));
    render(<AuthContextRef.Provider value={auth("user-a")}><AgentConsole /></AuthContextRef.Provider>);
    const toggle = screen.getByRole("button", { name: "Paper risk limits" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(get).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    const enabled = await screen.findByLabelText("Enforce paper risk limits");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(get).toHaveBeenCalledWith("/agent/risk-policy");
    fireEvent.click(enabled);
    fireEvent.change(screen.getByLabelText("New stop-risk budget (%)"), { target: { value: "0.5" } });
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save paper risk limits" }));
    expect(await screen.findByText("Paper risk limits saved and enforced.")).toBeInTheDocument();
    expect(put).toHaveBeenCalledWith("/agent/risk-policy", { ...policy, enabled: true, risk_budget_pct: 0.5 });
  });

  it("discards unsaved drafts when closed and reloads persisted server settings", async () => {
    vi.spyOn(api, "get").mockImplementation(async () => ({ data: { ...policy } }));
    const put = vi.spyOn(api, "put").mockResolvedValue({ data: policy });
    render(<AuthContextRef.Provider value={auth("user-a")}><AgentConsole /></AuthContextRef.Provider>);
    const toggle = screen.getByRole("button", { name: "Paper risk limits" });
    fireEvent.click(toggle);
    fireEvent.click(await screen.findByLabelText("Enforce paper risk limits"));
    fireEvent.click(toggle);
    expect(screen.queryByLabelText("Enforce paper risk limits")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(await screen.findByLabelText("Enforce paper risk limits")).not.toBeChecked();
    expect(put).not.toHaveBeenCalled();
  });

  it("prevents anonymous access and removes the panel on logout", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue({ data: policy });
    const view = render(<AuthContextRef.Provider value={auth("user-a")}><AgentConsole /></AuthContextRef.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "Paper risk limits" }));
    await screen.findByLabelText("Enforce paper risk limits");
    view.rerender(<AuthContextRef.Provider value={auth(null)}><AgentConsole /></AuthContextRef.Provider>);
    await waitFor(() => expect(screen.queryByLabelText("Enforce paper risk limits")).not.toBeInTheDocument());
    // Logging out closes the console; an anonymous reopen exposes a disabled control.
    useAgentStore.setState({ open: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Paper risk limits" })).toBeDisabled());
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("uses authenticated transport and sends no caller-selected user identity", async () => {
    const requests: InternalAxiosRequestConfig[] = [];
    const originalAdapter = api.defaults.adapter;
    const adapter: AxiosAdapter = async (config) => {
      requests.push(config);
      return { data: policy, status: 200, statusText: "OK", headers: {}, config };
    };
    api.defaults.adapter = adapter;
    try {
      let token = "user-a-token";
      setAccessTokenGetter(() => token);
      await getAgentRiskPolicy();
      token = "user-b-token";
      await saveAgentRiskPolicy({ ...policy, enabled: true });
      expect(requests.map((request) => request.url)).toEqual(["/agent/risk-policy", "/agent/risk-policy"]);
      expect(requests.map((request) => request.headers.Authorization)).toEqual(["Bearer user-a-token", "Bearer user-b-token"]);
      expect(requests[0].params).toBeUndefined();
      expect(JSON.parse(requests[1].data)).toEqual({ ...policy, enabled: true });
    } finally { api.defaults.adapter = originalAdapter; }
  });
});
