import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/base", () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
  },
}));

// Import after mock is set up
import { api } from "../api/base";

afterEach(() => {
  vi.clearAllMocks();
});

describe("providerKeys API", () => {
  it("fetchProviderKeys calls GET /settings/provider-keys", async () => {
    const { fetchProviderKeys } = await import("../api/providerKeys");
    const mockData = { env_file: "/path/.env", keys: [] };
    vi.mocked(api.get).mockResolvedValue({ data: mockData });

    await fetchProviderKeys();

    expect(api.get).toHaveBeenCalledWith("/settings/provider-keys");
  });

  it("saveProviderKeys calls PUT /settings/provider-keys with { values }", async () => {
    const { saveProviderKeys } = await import("../api/providerKeys");
    const mockData = { env_file: "/path/.env", keys: [] };
    vi.mocked(api.put).mockResolvedValue({ data: mockData });

    await saveProviderKeys({ FMP_API_KEY: "secret123" });

    expect(api.put).toHaveBeenCalledWith("/settings/provider-keys", {
      values: { FMP_API_KEY: "secret123" },
    });
  });

  it("testProvider calls POST /settings/provider-keys/test/{id}", async () => {
    const { testProvider } = await import("../api/providerKeys");
    const mockData = { provider: "fmp", status: "ok" as const, last_error: null, checked_at: "2024-01-01T00:00:00Z" };
    vi.mocked(api.post).mockResolvedValue({ data: mockData });

    await testProvider("fmp");

    expect(api.post).toHaveBeenCalledWith("/settings/provider-keys/test/fmp");
  });
});