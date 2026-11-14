import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { fetchProvidersStatus, type ProviderStatus } from "../../api/providers";
import { createWatchlist, fetchWatchlists } from "../../api/watchlist";
import { useSettingsStore } from "../../store/settingsStore";
import { GettingStartedPage } from "../GettingStarted";
import { onboardingStorageKey, providerReadiness, providersForMarket, readOnboardingPreferences, saveOnboardingPreferences, validateWatchlistName } from "../../data/onboarding";

vi.mock("../../api/providers", () => ({ fetchProvidersStatus: vi.fn() }));
vi.mock("../../api/watchlist", () => ({ createWatchlist: vi.fn(), fetchWatchlists: vi.fn() }));

function provider(id: string, markets: string[], status: ProviderStatus["status"], configured = true): ProviderStatus {
  return { id, name: id, markets, status, configured, last_error: null, last_success_at: null, unlocks: ["Quotes"], env_keys: id === "public" ? [] : ["OPTIONAL_KEY"] };
}
const savedWatchlist = { id: "new-list", name: "Research shortlist", symbols: [], column_config: {}, created_at: "2026-11-14" };
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><GettingStartedPage /></MemoryRouter></QueryClientProvider>);
  return client;
}

describe("Getting Started readiness", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    useSettingsStore.setState({ selectedMarket: "NASDAQ" });
    vi.mocked(fetchProvidersStatus).mockResolvedValue({ checked_at: "2026-11-14T00:00:00Z", overall: "ok", providers: [provider("public", ["GLOBAL"], "ok"), provider("optional-US", ["US"], "unconfigured", false), provider("india-only", ["NSE"], "ok")] });
    vi.mocked(fetchWatchlists).mockResolvedValue([]);
  });

  it("shows actual market-relevant health and optional free data access", async () => {
    renderPage();
    expect(await screen.findByText("public")).toBeInTheDocument();
    expect(screen.getByText("optional-US")).toBeInTheDocument();
    expect(screen.queryByText("india-only")).not.toBeInTheDocument();
    expect(screen.getByText("Public source · no API key required")).toBeInTheDocument();
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    expect(screen.getByLabelText("Data access healthy")).toBeInTheDocument();
    expect(screen.getByLabelText("I reviewed a security (manual confirmation)")).not.toBeChecked();
  });

  it("does not treat configured but degraded providers as healthy", async () => {
    vi.mocked(fetchProvidersStatus).mockResolvedValue({ checked_at: "", overall: "degraded", providers: [provider("optional-US", ["US"], "degraded")] });
    renderPage();
    expect(await screen.findByText("Needs attention")).toBeInTheDocument();
    expect(screen.queryByLabelText("Data access healthy")).not.toBeInTheDocument();
    expect(screen.getByText(/Configuration alone does not confirm/)).toBeInTheDocument();
  });

  it("reflects actual saved watchlists and does not pretend research is complete", async () => {
    vi.mocked(fetchWatchlists).mockResolvedValue([savedWatchlist]);
    renderPage();
    expect(await screen.findByText("1 watchlist is available, including any default lists. Add symbols or create your own shortlist.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create watchlist" })).toBeEnabled();
    expect(screen.getByLabelText("I saved a research note (manual confirmation)")).not.toBeChecked();
  });

  it("creates a real watchlist, updates checklist and invalidates lists", async () => {
    vi.mocked(createWatchlist).mockImplementation(async () => { vi.mocked(fetchWatchlists).mockResolvedValue([savedWatchlist]); return savedWatchlist; });
    const client = renderPage();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.change(await screen.findByLabelText("Watchlist name"), { target: { value: "  Research shortlist  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create watchlist" }));
    expect(await screen.findByText("Created “Research shortlist”. Open watchlists to add your symbols.")).toBeInTheDocument();
    expect(createWatchlist).toHaveBeenCalledWith("Research shortlist", expect.anything());
    expect(screen.getByLabelText("Watchlists available")).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["watchlists"] });
  });

  it("lets a fresh account with a seeded default list create a personal watchlist", async () => {
    const defaultList = { ...savedWatchlist, id: "default", name: "Default Watchlist", symbols: ["AAPL", "MSFT", "TSLA", "GOOGL"] };
    vi.mocked(fetchWatchlists).mockResolvedValue([defaultList]);
    vi.mocked(createWatchlist).mockImplementation(async () => {
      vi.mocked(fetchWatchlists).mockResolvedValue([defaultList, savedWatchlist]);
      return savedWatchlist;
    });
    renderPage();
    expect(await screen.findByText(/1 watchlist is available, including any default lists/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Watchlist created")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Watchlist name"), { target: { value: "Research shortlist" } });
    fireEvent.click(screen.getByRole("button", { name: "Create watchlist" }));
    expect(await screen.findByText("Created “Research shortlist”. Open watchlists to add your symbols.")).toBeInTheDocument();
    expect(await screen.findByText(/2 watchlists are available, including any default lists/)).toBeInTheDocument();
    expect(createWatchlist).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Open watchlists" })).toHaveAttribute("href", "/equity/watchlist");
    expect(screen.getByRole("button", { name: "Create watchlist" })).toBeEnabled();
  });

  it("keeps the entered name and offers a retry after creation failure", async () => {
    vi.mocked(createWatchlist).mockRejectedValue(new Error("failure"));
    renderPage();
    fireEvent.change(await screen.findByLabelText("Watchlist name"), { target: { value: "Research shortlist" } });
    fireEvent.click(screen.getByRole("button", { name: "Create watchlist" }));
    expect(await screen.findByText(/The watchlist could not be created/)).toBeInTheDocument();
    expect(screen.getByLabelText("Watchlist name")).toHaveValue("Research shortlist");
    expect(screen.getByRole("button", { name: "Create watchlist" })).toBeEnabled();
  });

  it("reports loading without claiming readiness and prevents duplicate creation", async () => {
    let resolveProviders!: (value: Awaited<ReturnType<typeof fetchProvidersStatus>>) => void;
    vi.mocked(fetchProvidersStatus).mockImplementation(() => new Promise((resolve) => { resolveProviders = resolve; }));
    let resolveCreate!: (value: typeof savedWatchlist) => void;
    vi.mocked(createWatchlist).mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));
    renderPage();
    expect(screen.getByText("Checking providers…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Data access healthy")).not.toBeInTheDocument();
    const input = await screen.findByLabelText("Watchlist name");
    fireEvent.change(input, { target: { value: "Research shortlist" } });
    fireEvent.click(screen.getByRole("button", { name: "Create watchlist" }));
    expect(await screen.findByRole("button", { name: "Creating…" })).toBeDisabled();
    expect(input).toBeDisabled();
    fireEvent.submit(input.closest("form")!);
    expect(createWatchlist).toHaveBeenCalledTimes(1);
    vi.mocked(fetchWatchlists).mockResolvedValue([savedWatchlist]);
    resolveCreate(savedWatchlist);
    resolveProviders({ checked_at: "", overall: "ok", providers: [] });
    expect(await screen.findByText("Created “Research shortlist”. Open watchlists to add your symbols.")).toBeInTheDocument();
    expect(await screen.findByText(/No provider coverage is reported/)).toBeInTheDocument();
  });

  it("rejects empty watchlist names without a request", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Create watchlist" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a watchlist name.");
    expect(createWatchlist).not.toHaveBeenCalled();
  });

  it("shows API failures and can retry both readiness checks", async () => {
    vi.mocked(fetchProvidersStatus).mockRejectedValue(new Error("failed"));
    vi.mocked(fetchWatchlists).mockRejectedValue(new Error("failed"));
    renderPage();
    const retryProviders = await screen.findByRole("button", { name: "Retry provider check" });
    const retryWatchlists = await screen.findByRole("button", { name: "Retry watchlists" });
    vi.mocked(fetchProvidersStatus).mockResolvedValue({ checked_at: "", overall: "ok", providers: [provider("public", ["GLOBAL"], "ok")] });
    vi.mocked(fetchWatchlists).mockResolvedValue([savedWatchlist]);
    fireEvent.click(retryProviders);
    fireEvent.click(retryWatchlists);
    expect(await screen.findByText("public")).toBeInTheDocument();
    expect(await screen.findByLabelText("Watchlists available")).toBeInTheDocument();
  });

  it("treats an error-bearing provider payload as unverified", async () => {
    vi.mocked(fetchProvidersStatus).mockResolvedValue({ checked_at: "", overall: "ok", providers: [provider("public", ["GLOBAL"], "ok")], error: "failed" });
    renderPage();
    expect(await screen.findByRole("button", { name: "Retry provider check" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Data access healthy")).not.toBeInTheDocument();
  });

  it("changes the recommended action for each chosen goal", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Quant research" }));
    expect(screen.getByRole("link", { name: "Open Model Lab" })).toHaveAttribute("href", "/backtesting/model-lab");
    fireEvent.click(screen.getByRole("button", { name: "Macro monitoring" }));
    expect(screen.getByRole("link", { name: "Open economic terminal" })).toHaveAttribute("href", "/equity/economics");
    fireEvent.click(screen.getByLabelText("I saved a research note (manual confirmation)"));
    await waitFor(() => expect(screen.getByLabelText("I saved a research note (manual confirmation)")).toBeChecked());
  });
});

describe("onboarding helper integrity", () => {
  it("filters region and global coverage correctly", () => {
    const rows = [provider("global", ["GLOBAL"], "ok"), provider("nse", ["NSE"], "ok"), provider("us", ["US"], "ok"), provider("ai", ["AI"], "ok")];
    expect(providersForMarket(rows, "NSE").map((item) => item.id)).toEqual(["global", "nse"]);
    expect(providersForMarket(rows, "BSE").map((item) => item.id)).toEqual(["global"]);
    expect(providersForMarket(rows, "NYSE").map((item) => item.id)).toEqual(["global", "us"]);
  });

  it("requires both configuration and actual healthy status", () => {
    expect(providerReadiness([provider("unconfigured", ["US"], "ok", false)])).toBe("unavailable");
    expect(providerReadiness([provider("degraded", ["US"], "degraded")])).toBe("attention");
    expect(providerReadiness([provider("down", ["US"], "down")])).toBe("unavailable");
    expect(providerReadiness([])).toBe("unavailable");
  });

  it("keeps manual preferences scoped to account and sanitizes corrupt values", () => {
    saveOnboardingPreferences("account-A", { goal: "quant", inspectedSecurity: true, savedResearch: false });
    expect(readOnboardingPreferences("account-A").goal).toBe("quant");
    expect(readOnboardingPreferences("account-B").inspectedSecurity).toBe(false);
    expect(readOnboardingPreferences().inspectedSecurity).toBe(false);
    localStorage.setItem(onboardingStorageKey("account-B"), JSON.stringify({ goal: "javascript:alert(1)", inspectedSecurity: "true", savedResearch: 1 }));
    expect(readOnboardingPreferences("account-B")).toEqual({ goal: "research", inspectedSecurity: false, savedResearch: false });
    localStorage.setItem(onboardingStorageKey("account-B"), "malformed");
    expect(readOnboardingPreferences("account-B").goal).toBe("research");
  });

  it("validates names before mutation", () => {
    expect(validateWatchlistName(" ")).toBeTruthy();
    expect(validateWatchlistName("x".repeat(81))).toBeTruthy();
    expect(validateWatchlistName("invalid\nname")).toBeTruthy();
    expect(validateWatchlistName("Research shortlist")).toBeNull();
  });
});
