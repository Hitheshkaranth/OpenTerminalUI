import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DataProvidersPanel } from "../components/settings/DataProvidersPanel";

vi.mock("../api/providers", () => ({
  useProvidersStatus: vi.fn(),
}));

vi.mock("../api/providerKeys", () => ({
  useProviderKeys: vi.fn(),
  testProvider: vi.fn(),
}));

// Import after mock is set up
import * as ProvidersApi from "../api/providers";
import * as ProviderKeysApi from "../api/providerKeys";
vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: () => ({ selectedMarket: "NSE" }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

vi.mocked(ProviderKeysApi.useProviderKeys).mockReturnValue({
  data: undefined,
  isLoading: false,
  error: null,
  refetch: vi.fn(),
});

describe("DataProvidersPanel", () => {
  it('shows "NOT CONFIGURED" and env key text for an unconfigured provider', () => {
    vi.mocked(ProvidersApi.useProvidersStatus).mockReturnValue({
      data: {
        checked_at: "2024-01-15T12:00:00Z",
        overall: "degraded" as const,
        providers: [
          {
            id: "kite",
            name: "Zerodha Kite",
            markets: ["NSE", "BSE"],
            configured: true,
            status: "ok",
            last_success_at: "2024-01-15T11:55:00Z",
            last_error: null,
            unlocks: ["Real-time NSE ticks"],
            env_keys: ["KITE_API_KEY", "KITE_ACCESS_TOKEN"],
          },
          {
            id: "fmp",
            name: "Financial Modeling Prep",
            markets: ["US"],
            configured: false,
            status: "unconfigured",
            last_success_at: null,
            last_error: null,
            unlocks: ["US fundamental data"],
            env_keys: ["FMP_API_KEY"],
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof ProvidersApi.useProvidersStatus>);

    render(<DataProvidersPanel />);

    expect(screen.getByText("NOT CONFIGURED")).toBeInTheDocument();
    expect(screen.getByText("Set FMP_API_KEY in .env, then restart")).toBeInTheDocument();
    expect(screen.getByText("Zerodha Kite")).toBeInTheDocument();
  });

  it('shows "Checking providers…" while loading', () => {
    vi.mocked(ProvidersApi.useProvidersStatus).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof ProvidersApi.useProvidersStatus>);

    render(<DataProvidersPanel />);

    expect(screen.getByText("Checking providers…")).toBeInTheDocument();
  });

  it('shows error message on failure', () => {
    vi.mocked(ProvidersApi.useProvidersStatus).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Network error"),
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof ProvidersApi.useProvidersStatus>);

    render(<DataProvidersPanel />);

    expect(screen.getByText("Could not reach /api/providers/status")).toBeInTheDocument();
  });
});