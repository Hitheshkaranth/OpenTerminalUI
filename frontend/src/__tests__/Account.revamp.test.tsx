import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountPage } from "../pages/Account";

const navigateSpy = vi.fn();
const logoutSpy = vi.fn();
const setSelectedCountrySpy = vi.fn();
const setSelectedMarketSpy = vi.fn();
const setDisplayCurrencySpy = vi.fn();
const createObjectURLSpy = vi.fn();
const revokeObjectURLSpy = vi.fn();
const linkClickSpy = vi.fn();

let mockUser:
  | {
      id: string;
      email: string;
      role: "admin" | "trader" | "viewer";
    }
  | null = {
  id: "u-1",
  email: "trader@openterminal.dev",
  role: "trader",
};

const settingsState = {
  selectedCountry: "US" as const,
  selectedMarket: "NASDAQ" as const,
  displayCurrency: "USD" as const,
  realtimeMode: "ws" as const,
  themeVariant: "terminal-noir" as const,
  hudOverlayEnabled: false,
  setSelectedCountry: setSelectedCountrySpy,
  setSelectedMarket: setSelectedMarketSpy,
  setDisplayCurrency: setDisplayCurrencySpy,
};

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({
    user: mockUser,
    logout: logoutSpy,
  }),
}));

vi.mock("../store/settingsStore", () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AccountPage />
    </MemoryRouter>,
  );
}

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob payload."));
    reader.readAsText(blob);
  });
}

function seedLocalState() {
  localStorage.setItem(
    "ot.account.profile",
    JSON.stringify({
      firstName: "Taylor",
      lastName: "Vega",
      displayName: "Taylor Vega",
      dateOfBirth: "1990-04-18",
      phone: "+1 415 555 0188",
      timezone: "America/Los_Angeles",
      location: "San Francisco, CA",
      deskFocus: "Momentum Desk",
      riskProfile: "aggressive",
      tradingStyle: "hybrid",
      notificationMode: "priority",
      securityTier: "restricted",
      bio: "Runs multi-session momentum with event overlays.",
      avatarDataUrl: "data:image/png;base64,avatar",
    }),
  );
  localStorage.setItem(
    "ot.account.connected",
    JSON.stringify({
      brokerName: "PrimeFlow",
      accountAlias: "US Growth",
      preferredCountry: "US",
      preferredExchange: "NASDAQ",
      defaultCurrency: "USD",
    }),
  );
  localStorage.setItem(
    "ot.account.aggregators",
    JSON.stringify({
      marketDataApiKey: "md-key",
      executionApiKey: "exec-key",
      newsApiKey: "news-key",
      webhookUrl: "https://hooks.example.dev/account",
    }),
  );
}

beforeEach(() => {
  mockUser = {
    id: "u-1",
    email: "trader@openterminal.dev",
    role: "trader",
  };
  localStorage.clear();
  navigateSpy.mockReset();
  logoutSpy.mockReset();
  setSelectedCountrySpy.mockReset();
  setSelectedMarketSpy.mockReset();
  setDisplayCurrencySpy.mockReset();
  createObjectURLSpy.mockReset();
  revokeObjectURLSpy.mockReset();
  linkClickSpy.mockReset();

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURLSpy.mockReturnValue("blob:ot-account"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURLSpy,
  });
  Object.defineProperty(HTMLAnchorElement.prototype, "click", {
    configurable: true,
    value: linkClickSpy,
  });
});

describe("AccountPage revamp", () => {
  it("renders the unauthenticated fallback without crashing", () => {
    mockUser = null;

    renderPage();

    expect(screen.getByText("No authenticated user.")).toBeInTheDocument();
  });

  it("hydrates the identity dashboard from localStorage and shows completion, activity, and shortcuts", () => {
    seedLocalState();

    renderPage();

    expect(screen.getByRole("heading", { name: "Taylor Vega" })).toBeInTheDocument();
    expect(screen.getByText("Session Activity")).toBeInTheDocument();
    expect(screen.getByText("Shortcut Panel")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Momentum Desk")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Identity completion" })).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getAllByText("4/4 online").length).toBeGreaterThan(0);
  });

  it("saves typed profile and routing changes back to localStorage and settings store", async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText("First Name"), { target: { value: "Jordan" } });
    fireEvent.change(screen.getByLabelText("Last Name"), { target: { value: "Lee" } });
    fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: "Jordan Lee" } });
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Mumbai, IN" } });
    fireEvent.change(screen.getByLabelText("Desk Focus"), { target: { value: "Global Macro" } });
    fireEvent.change(screen.getByLabelText("Trading Style"), { target: { value: "systematic" } });
    fireEvent.change(screen.getByLabelText("Notification Mode"), { target: { value: "quiet" } });
    fireEvent.change(screen.getByLabelText("Security Tier"), { target: { value: "standard" } });
    fireEvent.change(screen.getByLabelText("Preferred Country"), { target: { value: "IN" } });
    fireEvent.change(screen.getByLabelText("Preferred Exchange"), { target: { value: "BSE" } });
    fireEvent.change(screen.getByLabelText("Default Currency"), { target: { value: "INR" } });
    fireEvent.change(screen.getByLabelText("Webhook URL"), { target: { value: "https://hooks.example.dev/macro" } });

    fireEvent.click(screen.getByRole("button", { name: "Save account details" }));

    const storedProfile = JSON.parse(localStorage.getItem("ot.account.profile") || "{}");
    const storedConnection = JSON.parse(localStorage.getItem("ot.account.connected") || "{}");
    const storedAggregators = JSON.parse(localStorage.getItem("ot.account.aggregators") || "{}");

    expect(storedProfile).toEqual(
      expect.objectContaining({
        firstName: "Jordan",
        lastName: "Lee",
        displayName: "Jordan Lee",
        location: "Mumbai, IN",
        deskFocus: "Global Macro",
        tradingStyle: "systematic",
        notificationMode: "quiet",
        securityTier: "standard",
      }),
    );
    expect(storedConnection).toEqual(
      expect.objectContaining({
        preferredCountry: "IN",
        preferredExchange: "BSE",
        defaultCurrency: "INR",
      }),
    );
    expect(storedAggregators).toEqual(
      expect.objectContaining({
        webhookUrl: "https://hooks.example.dev/macro",
      }),
    );
    expect(setSelectedCountrySpy).toHaveBeenCalledWith("IN");
    expect(setSelectedMarketSpy).toHaveBeenCalledWith("BSE");
    expect(setDisplayCurrencySpy).toHaveBeenCalledWith("INR");
    expect(await screen.findByText("Account details saved.")).toBeInTheDocument();
  });

  it("supports shortcut navigation plus export, reset, and logout actions", async () => {
    seedLocalState();

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Open Workstation" }));
    expect(navigateSpy).toHaveBeenCalledWith("/equity/chart-workstation");

    fireEvent.click(screen.getByRole("button", { name: "Export profile bundle" }));

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(linkClickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:ot-account");

    const exportBlob = createObjectURLSpy.mock.calls[0][0] as Blob;
    const exportText = await readBlobText(exportBlob);
    expect(exportText).toContain("\"email\": \"trader@openterminal.dev\"");
    expect(exportText).toContain("\"displayName\": \"Taylor Vega\"");

    fireEvent.click(screen.getByRole("button", { name: "Reset account draft" }));

    await waitFor(() => {
      expect(localStorage.getItem("ot.account.profile")).toBeNull();
      expect(localStorage.getItem("ot.account.connected")).toBeNull();
      expect(localStorage.getItem("ot.account.aggregators")).toBeNull();
    });
    expect(screen.getByLabelText("Display Name")).toHaveValue("");
    expect(screen.getByLabelText("Preferred Country")).toHaveValue("US");
    expect(screen.getByLabelText("Preferred Exchange")).toHaveValue("NASDAQ");
    expect(screen.getByText("Draft reset to defaults.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith("/login");
  });
});
