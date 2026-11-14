import type { ProviderStatus } from "../api/providers";
import type { MarketCode } from "../types/markets";
import type { ToolCategory } from "./workflowCatalog";

export type OnboardingGoal = ToolCategory;
export type OnboardingPreferences = { goal: OnboardingGoal; inspectedSecurity: boolean; savedResearch: boolean };
export const DEFAULT_ONBOARDING_PREFERENCES: OnboardingPreferences = { goal: "research", inspectedSecurity: false, savedResearch: false };
export const ONBOARDING_GOALS: Array<{ id: OnboardingGoal; label: string; description: string; action: string; path: string }> = [
  { id: "trader", label: "Trading", description: "Plan an entry, define risk, then practice with paper capital.", action: "Open chart workstation", path: "/equity/chart-workstation" },
  { id: "research", label: "Company research", description: "Inspect a company and keep a thesis with supporting evidence.", action: "Open Security Hub", path: "/equity/security" },
  { id: "portfolio", label: "Portfolio review", description: "Review holdings, allocation and portfolio risk.", action: "Review portfolio", path: "/equity/portfolio" },
  { id: "quant", label: "Quant research", description: "Test a hypothesis and inspect validation and data coverage.", action: "Open Model Lab", path: "/backtesting/model-lab" },
  { id: "macro", label: "Macro monitoring", description: "Review economic releases, rates and sector leadership.", action: "Open economic terminal", path: "/equity/economics" },
];

export function providersForMarket(providers: ProviderStatus[], market: MarketCode): ProviderStatus[] {
  const region = market === "NSE" || market === "BSE" ? "IN" : "US";
  return providers.filter((provider) => provider.markets.some((value) => value === market || value === region || value === "GLOBAL"));
}

export function providerReadiness(providers: ProviderStatus[]): "healthy" | "attention" | "unavailable" {
  if (providers.some((provider) => provider.configured && provider.status === "ok")) return "healthy";
  if (providers.some((provider) => provider.configured && provider.status === "degraded")) return "attention";
  return "unavailable";
}

export function onboardingStorageKey(accountId: string): string {
  return `ot:getting-started:v1:${encodeURIComponent(accountId)}`;
}

export function readOnboardingPreferences(accountId?: string): OnboardingPreferences {
  if (!accountId) return { ...DEFAULT_ONBOARDING_PREFERENCES };
  try {
    const value: unknown = JSON.parse(localStorage.getItem(onboardingStorageKey(accountId)) || "null");
    if (!value || typeof value !== "object") return { ...DEFAULT_ONBOARDING_PREFERENCES };
    const row = value as Partial<OnboardingPreferences>;
    return {
      goal: ONBOARDING_GOALS.some((goal) => goal.id === row.goal) ? row.goal! : "research",
      inspectedSecurity: row.inspectedSecurity === true,
      savedResearch: row.savedResearch === true,
    };
  } catch { return { ...DEFAULT_ONBOARDING_PREFERENCES }; }
}

export function saveOnboardingPreferences(accountId: string | undefined, value: OnboardingPreferences): boolean {
  if (!accountId) return true;
  try { localStorage.setItem(onboardingStorageKey(accountId), JSON.stringify(value)); return true; }
  catch { return false; }
}

export function validateWatchlistName(value: string): string | null {
  const name = value.trim();
  if (!name) return "Enter a watchlist name.";
  if (name.length > 80) return "Use 80 characters or fewer.";
  if (/[\u0000-\u001f\u007f]/.test(name)) return "Remove control characters from the name.";
  return null;
}
