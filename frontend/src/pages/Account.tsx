import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ProfileCompletionRing } from "../components/home/ProfileCompletionRing";
import { CountryFlag } from "../components/common/CountryFlag";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { useAuth } from "../contexts/AuthContext";
import { useSettingsStore } from "../store/settingsStore";
import {
  COUNTRY_MARKETS,
  type AccountAggregatorSettings,
  type AccountConnectionSettings,
  type AccountExportBundle,
  type AccountProfile,
  type AccountSessionActivityItem,
  type AccountShortcutCard,
  type AccountShortcutTone,
  type CountryCode,
  type MarketCode,
} from "../types";

const PROFILE_STORAGE_KEY = "ot.account.profile";
const CONNECTED_STORAGE_KEY = "ot.account.connected";
const AGGREGATORS_STORAGE_KEY = "ot.account.aggregators";

const INPUT_CLASS_NAME =
  "mt-1 w-full rounded-sm border border-terminal-border bg-terminal-bg px-2 py-1.5 text-xs text-terminal-text outline-none transition-colors focus:border-terminal-accent";

const COUNTRY_NAME: Record<CountryCode, string> = {
  IN: "India",
  US: "United States",
};

const COUNTRY_DEFAULT_EXCHANGE: Record<CountryCode, MarketCode> = {
  IN: "NSE",
  US: "NASDAQ",
};

const SHORTCUTS: readonly AccountShortcutCard[] = [
  {
    id: "workstation",
    label: "Workstation",
    detail: "Linked charts, replay, multi-timeframe studies.",
    keycap: "6",
    to: "/equity/chart-workstation",
    tone: "accent",
  },
  {
    id: "portfolio",
    label: "Portfolio",
    detail: "Risk, holdings, and allocation diagnostics.",
    keycap: "F3",
    to: "/equity/portfolio",
    tone: "success",
  },
  {
    id: "alerts",
    label: "Alerts",
    detail: "Channel state, routing, and trigger inventory.",
    keycap: "A",
    to: "/equity/alerts",
    tone: "info",
  },
  {
    id: "settings",
    label: "Desk Settings",
    detail: "Theme, runtime mode, and environment controls.",
    keycap: "F6",
    to: "/equity/settings",
    tone: "warn",
  },
] as const;

const PROFILE_COMPLETION_FIELDS: ReadonlyArray<{
  key: keyof AccountProfile;
  label: string;
  isComplete: (profile: AccountProfile) => boolean;
}> = [
  { key: "firstName", label: "First Name", isComplete: (profile) => Boolean(profile.firstName.trim()) },
  { key: "lastName", label: "Last Name", isComplete: (profile) => Boolean(profile.lastName.trim()) },
  { key: "displayName", label: "Display Name", isComplete: (profile) => Boolean(profile.displayName.trim()) },
  { key: "phone", label: "Phone", isComplete: (profile) => Boolean(profile.phone.trim()) },
  { key: "location", label: "Location", isComplete: (profile) => Boolean(profile.location.trim()) },
  { key: "deskFocus", label: "Desk Focus", isComplete: (profile) => Boolean(profile.deskFocus.trim()) },
  { key: "bio", label: "Bio", isComplete: (profile) => Boolean(profile.bio.trim()) },
  { key: "avatarDataUrl", label: "Avatar", isComplete: (profile) => Boolean(profile.avatarDataUrl) },
] as const;

function getLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function buildDefaultProfile(): AccountProfile {
  return {
    firstName: "",
    lastName: "",
    displayName: "",
    dateOfBirth: "",
    phone: "",
    timezone: getLocalTimezone(),
    location: "",
    deskFocus: "",
    riskProfile: "moderate",
    tradingStyle: "hybrid",
    notificationMode: "balanced",
    securityTier: "elevated",
    bio: "",
    avatarDataUrl: "",
  };
}

function buildDefaultConnected(
  selectedCountry: CountryCode,
  selectedMarket: MarketCode,
  displayCurrency: "INR" | "USD",
): AccountConnectionSettings {
  return {
    brokerName: "Primary Broker",
    accountAlias: "Main Trading",
    preferredCountry: selectedCountry,
    preferredExchange: selectedMarket,
    defaultCurrency: displayCurrency,
  };
}

function buildDefaultAggregators(): AccountAggregatorSettings {
  return {
    marketDataApiKey: "",
    executionApiKey: "",
    newsApiKey: "",
    webhookUrl: "",
  };
}

function initials(profile: AccountProfile, email: string): string {
  const first = profile.firstName.trim().charAt(0);
  const last = profile.lastName.trim().charAt(0);
  if (first || last) return `${first}${last}`.toUpperCase();
  const display = profile.displayName.trim();
  if (display) {
    const bits = display.split(/\s+/).filter(Boolean);
    if (bits.length >= 2) return `${bits[0].charAt(0)}${bits[1].charAt(0)}`.toUpperCase();
    return display.slice(0, 2).toUpperCase();
  }
  const local = email.split("@")[0] || "";
  return (local.slice(0, 2) || "U").toUpperCase();
}

function loadLocalState<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as object) } as T;
  } catch {
    return fallback;
  }
}

function toneBadgeVariant(
  tone: AccountSessionActivityItem["tone"],
): "success" | "info" | "warn" | "danger" {
  if (tone === "success") return "success";
  if (tone === "warn") return "warn";
  if (tone === "danger") return "danger";
  return "info";
}

function tonePanelClass(tone: AccountSessionActivityItem["tone"]): string {
  if (tone === "success") return "border-terminal-pos/50 bg-terminal-pos/10";
  if (tone === "warn") return "border-terminal-warn/50 bg-terminal-warn/10";
  if (tone === "danger") return "border-terminal-neg/50 bg-terminal-neg/10";
  return "border-terminal-border/70 bg-terminal-bg/45";
}

function shortcutToneClass(tone: AccountShortcutTone): string {
  if (tone === "success") return "border-terminal-pos/60 hover:border-terminal-pos hover:bg-terminal-pos/10";
  if (tone === "warn") return "border-terminal-warn/60 hover:border-terminal-warn hover:bg-terminal-warn/10";
  if (tone === "info") return "border-terminal-border hover:border-terminal-accent hover:bg-terminal-bg";
  return "border-terminal-accent/60 hover:border-terminal-accent hover:bg-terminal-accent/10";
}

function formatTimestamp(value: number | null): string {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString();
}

function deriveLatestAction(activity: {
  savedAt: number | null;
  exportedAt: number | null;
  resetAt: number | null;
}): string {
  const entries = [
    { kind: "Save", at: activity.savedAt },
    { kind: "Export", at: activity.exportedAt },
    { kind: "Reset", at: activity.resetAt },
  ].filter((entry): entry is { kind: string; at: number } => typeof entry.at === "number");

  if (!entries.length) return "Editing draft";
  entries.sort((left, right) => right.at - left.at);
  return `${entries[0].kind} @ ${new Date(entries[0].at).toLocaleTimeString()}`;
}

function configuredIntegrations(aggregators: AccountAggregatorSettings): number {
  return Object.values(aggregators).filter((value) => value.trim().length > 0).length;
}

function buildExportBundle(
  user: { email: string; role: string },
  profile: AccountProfile,
  connected: AccountConnectionSettings,
  aggregators: AccountAggregatorSettings,
): AccountExportBundle {
  return {
    exportedAt: new Date().toISOString(),
    user: {
      email: user.email,
      role: user.role,
    },
    profile,
    connected,
    aggregators,
  };
}

export function AccountPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const selectedCountry = useSettingsStore((state) => state.selectedCountry);
  const selectedMarket = useSettingsStore((state) => state.selectedMarket);
  const displayCurrency = useSettingsStore((state) => state.displayCurrency);
  const realtimeMode = useSettingsStore((state) => state.realtimeMode);
  const themeVariant = useSettingsStore((state) => state.themeVariant);
  const hudOverlayEnabled = useSettingsStore((state) => state.hudOverlayEnabled);
  const setSelectedCountry = useSettingsStore((state) => state.setSelectedCountry);
  const setSelectedMarket = useSettingsStore((state) => state.setSelectedMarket);
  const setDisplayCurrency = useSettingsStore((state) => state.setDisplayCurrency);

  const [profile, setProfile] = useState<AccountProfile>(() =>
    loadLocalState<AccountProfile>(PROFILE_STORAGE_KEY, buildDefaultProfile()),
  );
  const [connected, setConnected] = useState<AccountConnectionSettings>(() =>
    loadLocalState<AccountConnectionSettings>(
      CONNECTED_STORAGE_KEY,
      buildDefaultConnected(selectedCountry, selectedMarket, displayCurrency),
    ),
  );
  const [aggregators, setAggregators] = useState<AccountAggregatorSettings>(() =>
    loadLocalState<AccountAggregatorSettings>(AGGREGATORS_STORAGE_KEY, buildDefaultAggregators()),
  );
  const [message, setMessage] = useState<{ text: string; tone: "success" | "warn" } | null>(null);
  const [activity, setActivity] = useState<{
    savedAt: number | null;
    exportedAt: number | null;
    resetAt: number | null;
  }>({
    savedAt: null,
    exportedAt: null,
    resetAt: null,
  });
  const messageTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (messageTimerRef.current != null) {
        window.clearTimeout(messageTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const exchanges = COUNTRY_MARKETS[connected.preferredCountry];
    if (!exchanges.includes(connected.preferredExchange)) {
      setConnected((current) => ({
        ...current,
        preferredExchange: COUNTRY_DEFAULT_EXCHANGE[current.preferredCountry],
      }));
    }
  }, [connected.preferredCountry, connected.preferredExchange]);

  const setFlashMessage = (text: string, tone: "success" | "warn") => {
    if (messageTimerRef.current != null) {
      window.clearTimeout(messageTimerRef.current);
    }
    setMessage({ text, tone });
    messageTimerRef.current = window.setTimeout(() => {
      setMessage(null);
      messageTimerRef.current = null;
    }, 2500);
  };

  const updateProfile = <K extends keyof AccountProfile>(field: K, value: AccountProfile[K]) => {
    setProfile((current) => ({ ...current, [field]: value }));
  };

  const updateConnected = <K extends keyof AccountConnectionSettings>(
    field: K,
    value: AccountConnectionSettings[K],
  ) => {
    setConnected((current) => ({ ...current, [field]: value }));
  };

  const updateAggregators = <K extends keyof AccountAggregatorSettings>(
    field: K,
    value: AccountAggregatorSettings[K],
  ) => {
    setAggregators((current) => ({ ...current, [field]: value }));
  };

  if (!user) {
    return (
      <div className="space-y-3 p-3">
        <TerminalPanel title="Account" subtitle="User details">
          <div className="text-xs text-terminal-muted">No authenticated user.</div>
        </TerminalPanel>
      </div>
    );
  }

  const availableExchanges = COUNTRY_MARKETS[connected.preferredCountry];
  const identityName =
    profile.displayName.trim() ||
    [profile.firstName.trim(), profile.lastName.trim()].filter(Boolean).join(" ") ||
    user.email.split("@")[0];
  const userInitials = initials(profile, user.email);
  const missingFields = PROFILE_COMPLETION_FIELDS.filter((field) => !field.isComplete(profile)).map((field) => field.label);
  const completionSummary = {
    value: Math.round(((PROFILE_COMPLETION_FIELDS.length - missingFields.length) / PROFILE_COMPLETION_FIELDS.length) * 100),
    missingFields,
    completed: PROFILE_COMPLETION_FIELDS.length - missingFields.length,
    total: PROFILE_COMPLETION_FIELDS.length,
  };
  const integrationCount = configuredIntegrations(aggregators);
  const persistedSlots = [PROFILE_STORAGE_KEY, CONNECTED_STORAGE_KEY, AGGREGATORS_STORAGE_KEY].filter((key) =>
    Boolean(localStorage.getItem(key)),
  ).length;
  const sessionActivityItems: AccountSessionActivityItem[] = [
    {
      id: "auth",
      label: "Auth session",
      value: user.email,
      detail: `Role ${user.role.toUpperCase()} | Timezone ${profile.timezone}`,
      tone: "success",
    },
    {
      id: "desk",
      label: "Desk route",
      value: `${COUNTRY_NAME[connected.preferredCountry]} / ${connected.preferredExchange}`,
      detail: `${connected.defaultCurrency} settlement | ${connected.accountAlias || "Alias pending"}`,
      tone: "info",
    },
    {
      id: "security",
      label: "Security posture",
      value: `${profile.securityTier.toUpperCase()} | ${profile.notificationMode.toUpperCase()}`,
      detail: `${profile.tradingStyle.toUpperCase()} flow | ${profile.riskProfile.toUpperCase()} risk`,
      tone: profile.securityTier === "standard" ? "warn" : "success",
    },
    {
      id: "integrations",
      label: "Integrations",
      value: `${integrationCount}/4 online`,
      detail: aggregators.webhookUrl.trim() ? "Webhook armed for export flows" : "Webhook pending",
      tone: integrationCount >= 2 ? "success" : "warn",
    },
    {
      id: "activity",
      label: "Latest action",
      value: deriveLatestAction(activity),
      detail:
        persistedSlots > 0
          ? `${persistedSlots}/3 browser vault slots populated | Last save ${formatTimestamp(activity.savedAt)}`
          : "No browser snapshot saved yet",
      tone: activity.resetAt && (!activity.savedAt || activity.resetAt > activity.savedAt) ? "warn" : "info",
    },
  ];

  const onAvatarUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      updateProfile("avatarDataUrl", result);
    };
    reader.readAsDataURL(file);
  };

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    localStorage.setItem(CONNECTED_STORAGE_KEY, JSON.stringify(connected));
    localStorage.setItem(AGGREGATORS_STORAGE_KEY, JSON.stringify(aggregators));

    setSelectedCountry(connected.preferredCountry);
    setSelectedMarket(connected.preferredExchange);
    setDisplayCurrency(connected.defaultCurrency);

    setActivity((current) => ({ ...current, savedAt: Date.now() }));
    setFlashMessage("Account details saved.", "success");
  };

  const onExport = () => {
    if (typeof URL.createObjectURL !== "function" || typeof URL.revokeObjectURL !== "function") {
      setFlashMessage("Export is unavailable in this browser.", "warn");
      return;
    }

    const payload = buildExportBundle(user, profile, connected, aggregators);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ot-account-${payload.exportedAt.replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setActivity((current) => ({ ...current, exportedAt: Date.now() }));
    setFlashMessage("Profile bundle exported.", "success");
  };

  const onResetDraft = () => {
    localStorage.removeItem(PROFILE_STORAGE_KEY);
    localStorage.removeItem(CONNECTED_STORAGE_KEY);
    localStorage.removeItem(AGGREGATORS_STORAGE_KEY);

    setProfile(buildDefaultProfile());
    setConnected(buildDefaultConnected(selectedCountry, selectedMarket, displayCurrency));
    setAggregators(buildDefaultAggregators());
    setActivity((current) => ({ ...current, resetAt: Date.now() }));
    setFlashMessage("Draft reset to defaults.", "warn");
  };

  return (
    <form className="space-y-3 p-3 font-mono" onSubmit={onSave}>
      <header className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-terminal-border bg-terminal-panel px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-terminal-muted">
          <span>Account | Identity HQ</span>
          <TerminalBadge variant="accent">{connected.preferredExchange}</TerminalBadge>
          <TerminalBadge variant="info">{themeVariant}</TerminalBadge>
          <TerminalBadge variant={hudOverlayEnabled ? "live" : "neutral"}>
            {hudOverlayEnabled ? "HUD On" : "HUD Off"}
          </TerminalBadge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {message ? (
            <TerminalBadge variant={message.tone === "success" ? "success" : "warn"}>{message.text}</TerminalBadge>
          ) : null}
          <TerminalButton type="button" size="sm" onClick={() => navigate(-1)} aria-label="Go back">
            Back
          </TerminalButton>
          <TerminalButton type="submit" size="sm" variant="accent" aria-label="Save profile">
            Save Profile
          </TerminalButton>
        </div>
      </header>
      <div className="grid gap-3 xl:grid-cols-[1.18fr_0.82fr]">
        <TerminalPanel
          title="Identity HQ"
          subtitle="Identity, completion, and current market posture"
          actions={<TerminalBadge variant="live">Online</TerminalBadge>}
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div className="grid gap-4 md:grid-cols-[108px_minmax(0,1fr)]">
              <div className="flex items-start justify-center">
                {profile.avatarDataUrl ? (
                  <img
                    src={profile.avatarDataUrl}
                    alt="Profile"
                    className="h-24 w-24 rounded-full border border-terminal-border object-cover"
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-full border border-terminal-border bg-terminal-bg text-3xl text-terminal-accent">
                    {userInitials}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <TerminalBadge variant="accent">{user.role.toUpperCase()}</TerminalBadge>
                    <TerminalBadge variant="info">{connected.defaultCurrency}</TerminalBadge>
                    <TerminalBadge variant={realtimeMode === "ws" ? "live" : "neutral"}>
                      {realtimeMode.toUpperCase()}
                    </TerminalBadge>
                  </div>
                  <h1 className="text-2xl uppercase tracking-[0.12em] text-terminal-accent">{identityName}</h1>
                  <div className="text-sm text-terminal-text">{user.email}</div>
                  <div className="text-xs text-terminal-muted">
                    {profile.location.trim() || "Location pending"} | {profile.deskFocus.trim() || "Desk focus pending"}
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-sm border border-terminal-border/70 bg-terminal-bg/45 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-terminal-muted">Broker Alias</div>
                    <div className="mt-1 text-xs text-terminal-text">{connected.accountAlias}</div>
                  </div>
                  <div className="rounded-sm border border-terminal-border/70 bg-terminal-bg/45 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-terminal-muted">Country Route</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-terminal-text">
                      <CountryFlag countryCode={connected.preferredCountry} size="lg" />
                      <span>{COUNTRY_NAME[connected.preferredCountry]}</span>
                    </div>
                  </div>
                  <div className="rounded-sm border border-terminal-border/70 bg-terminal-bg/45 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-terminal-muted">Risk Posture</div>
                    <div className="mt-1 text-xs text-terminal-text">{profile.riskProfile.toUpperCase()}</div>
                  </div>
                  <div className="rounded-sm border border-terminal-border/70 bg-terminal-bg/45 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-terminal-muted">Local Vault</div>
                    <div className="mt-1 text-xs text-terminal-text">
                      {persistedSlots}/3 slots | {integrationCount}/4 connectors
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-sm border border-terminal-border/70 bg-terminal-bg/45 p-3">
              <ProfileCompletionRing
                value={completionSummary.value}
                size={96}
                strokeWidth={6}
                label="Identity completion"
                missingFields={completionSummary.missingFields}
              />
              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] uppercase tracking-[0.14em] text-terminal-muted">
                <div className="rounded-sm border border-terminal-border/60 bg-terminal-panel px-2 py-2">
                  <div>Completed</div>
                  <div className="mt-1 text-sm text-terminal-text">{completionSummary.completed}</div>
                </div>
                <div className="rounded-sm border border-terminal-border/60 bg-terminal-panel px-2 py-2">
                  <div>Missing</div>
                  <div className="mt-1 text-sm text-terminal-text">
                    {completionSummary.total - completionSummary.completed}
                  </div>
                </div>
              </div>
              <div className="mt-3 text-[11px] text-terminal-muted">
                Completion tracks identity fields only. Desk routing and integrations continue to use the existing save
                flow.
              </div>
            </div>
          </div>
        </TerminalPanel>

        <TerminalPanel
          title="Session Activity"
          subtitle="Active browser session, routing, and latest account actions"
          actions={<TerminalBadge variant="info">Local session</TerminalBadge>}
        >
          <div className="space-y-2">
            {sessionActivityItems.map((item) => (
              <article key={item.id} className={`rounded-sm border p-3 ${tonePanelClass(item.tone)}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-terminal-muted">{item.label}</div>
                  <TerminalBadge variant={toneBadgeVariant(item.tone)}>{item.tone.toUpperCase()}</TerminalBadge>
                </div>
                <div className="mt-2 text-sm text-terminal-text">{item.value}</div>
                <div className="mt-1 text-[11px] leading-5 text-terminal-muted">{item.detail}</div>
              </article>
            ))}
          </div>
        </TerminalPanel>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.08fr_0.92fr]">
        <TerminalPanel
          title="Profile Dossier"
          subtitle="Personal details, desk defaults, and security posture"
          actions={<TerminalBadge variant="accent">Editable</TerminalBadge>}
        >
          <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
            <label>
              First Name
              <input
                className={INPUT_CLASS_NAME}
                value={profile.firstName}
                onChange={(event) => updateProfile("firstName", event.target.value)}
              />
            </label>
            <label>
              Last Name
              <input
                className={INPUT_CLASS_NAME}
                value={profile.lastName}
                onChange={(event) => updateProfile("lastName", event.target.value)}
              />
            </label>
            <label>
              Display Name
              <input
                className={INPUT_CLASS_NAME}
                value={profile.displayName}
                onChange={(event) => updateProfile("displayName", event.target.value)}
                placeholder="Desk-visible identity"
              />
            </label>
            <label>
              Date of Birth
              <input
                type="date"
                className={INPUT_CLASS_NAME}
                value={profile.dateOfBirth}
                onChange={(event) => updateProfile("dateOfBirth", event.target.value)}
              />
            </label>
            <label>
              Phone
              <input
                className={INPUT_CLASS_NAME}
                value={profile.phone}
                onChange={(event) => updateProfile("phone", event.target.value)}
                placeholder="+1 555 123 9876"
              />
            </label>
            <label>
              Timezone
              <input
                className={INPUT_CLASS_NAME}
                value={profile.timezone}
                onChange={(event) => updateProfile("timezone", event.target.value)}
              />
            </label>
            <label>
              Location
              <input
                className={INPUT_CLASS_NAME}
                value={profile.location}
                onChange={(event) => updateProfile("location", event.target.value)}
                placeholder="San Francisco, CA"
              />
            </label>
            <label>
              Desk Focus
              <input
                className={INPUT_CLASS_NAME}
                value={profile.deskFocus}
                onChange={(event) => updateProfile("deskFocus", event.target.value)}
                placeholder="Macro, growth, event-driven"
              />
            </label>
            <label>
              Risk Profile
              <select
                className={INPUT_CLASS_NAME}
                value={profile.riskProfile}
                onChange={(event) => updateProfile("riskProfile", event.target.value as AccountProfile["riskProfile"])}
              >
                <option value="conservative">Conservative</option>
                <option value="moderate">Moderate</option>
                <option value="aggressive">Aggressive</option>
              </select>
            </label>
            <label>
              Trading Style
              <select
                className={INPUT_CLASS_NAME}
                value={profile.tradingStyle}
                onChange={(event) => updateProfile("tradingStyle", event.target.value as AccountProfile["tradingStyle"])}
              >
                <option value="discretionary">Discretionary</option>
                <option value="systematic">Systematic</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </label>
            <label>
              Notification Mode
              <select
                className={INPUT_CLASS_NAME}
                value={profile.notificationMode}
                onChange={(event) =>
                  updateProfile("notificationMode", event.target.value as AccountProfile["notificationMode"])
                }
              >
                <option value="quiet">Quiet</option>
                <option value="balanced">Balanced</option>
                <option value="priority">Priority</option>
              </select>
            </label>
            <label>
              Security Tier
              <select
                className={INPUT_CLASS_NAME}
                value={profile.securityTier}
                onChange={(event) => updateProfile("securityTier", event.target.value as AccountProfile["securityTier"])}
              >
                <option value="standard">Standard</option>
                <option value="elevated">Elevated</option>
                <option value="restricted">Restricted</option>
              </select>
            </label>
            <label className="md:col-span-2">
              Profile Image
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  accept="image/*"
                  className={`${INPUT_CLASS_NAME} max-w-full`}
                  onChange={onAvatarUpload}
                />
                <TerminalButton
                  type="button"
                  size="sm"
                  onClick={() => updateProfile("avatarDataUrl", "")}
                  aria-label="Remove profile image"
                >
                  Remove
                </TerminalButton>
              </div>
            </label>
            <label className="md:col-span-2">
              Bio
              <textarea
                className={`${INPUT_CLASS_NAME} h-24 resize-none`}
                value={profile.bio}
                onChange={(event) => updateProfile("bio", event.target.value)}
                placeholder="Trading mandate, operating style, and escalation notes."
              />
            </label>
          </div>
        </TerminalPanel>

        <div className="space-y-3">
          <TerminalPanel
            title="Shortcut Panel"
            subtitle="Fast route jumps for the desks most likely to follow profile edits"
            actions={<TerminalBadge variant="accent">Prompt map</TerminalBadge>}
          >
            <div className="grid gap-2">
              {SHORTCUTS.map((shortcut) => (
                <button
                  key={shortcut.id}
                  type="button"
                  className={`flex items-center justify-between rounded-sm border bg-terminal-bg/45 px-3 py-2 text-left transition-colors ${shortcutToneClass(shortcut.tone)}`}
                  onClick={() => navigate(shortcut.to)}
                  aria-label={`Open ${shortcut.label}`}
                >
                  <div>
                    <div className="text-xs text-terminal-text">{shortcut.label}</div>
                    <div className="mt-1 text-[11px] text-terminal-muted">{shortcut.detail}</div>
                  </div>
                  <span className="rounded-sm border border-terminal-border bg-terminal-panel px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-terminal-accent">
                    {shortcut.keycap}
                  </span>
                </button>
              ))}
            </div>
          </TerminalPanel>

          <TerminalPanel
            title="Action Deck"
            subtitle="Save, export, reset, or close the authenticated session"
            actions={<TerminalBadge variant="warn">Manual controls</TerminalBadge>}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <TerminalButton type="submit" variant="accent" aria-label="Save account details">
                Save Account Details
              </TerminalButton>
              <TerminalButton type="button" variant="success" onClick={onExport} aria-label="Export profile bundle">
                Export Bundle
              </TerminalButton>
              <TerminalButton type="button" variant="default" onClick={onResetDraft} aria-label="Reset account draft">
                Reset Draft
              </TerminalButton>
              <TerminalButton
                type="button"
                variant="danger"
                onClick={() => {
                  logout();
                  navigate("/login");
                }}
                aria-label="Logout"
              >
                Logout
              </TerminalButton>
            </div>
            <div className="mt-3 rounded-sm border border-terminal-border/70 bg-terminal-bg/45 px-3 py-2 text-[11px] leading-5 text-terminal-muted">
              Export includes the current in-browser profile, connection routing, and integration settings. Reset clears only the
              three Account localStorage slots and restores the typed defaults already used by this page.
            </div>
          </TerminalPanel>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[0.96fr_1.04fr]">
        <TerminalPanel
          title="Connection Dashboard"
          subtitle="Broker alias, market route, and settlement defaults"
          actions={<TerminalBadge variant="info">Desk routing</TerminalBadge>}
        >
          <div className="space-y-3 text-xs">
            <label>
              Broker Name
              <input
                className={INPUT_CLASS_NAME}
                value={connected.brokerName}
                onChange={(event) => updateConnected("brokerName", event.target.value)}
              />
            </label>
            <label>
              Account Alias
              <input
                className={INPUT_CLASS_NAME}
                value={connected.accountAlias}
                onChange={(event) => updateConnected("accountAlias", event.target.value)}
              />
            </label>
            <label>
              Preferred Country
              <select
                className={INPUT_CLASS_NAME}
                value={connected.preferredCountry}
                onChange={(event) => updateConnected("preferredCountry", event.target.value as CountryCode)}
              >
                <option value="IN">IN - India</option>
                <option value="US">US - United States</option>
              </select>
            </label>
            <label>
              Preferred Exchange
              <select
                className={INPUT_CLASS_NAME}
                value={connected.preferredExchange}
                onChange={(event) => updateConnected("preferredExchange", event.target.value as MarketCode)}
              >
                {availableExchanges.map((exchange) => (
                  <option key={exchange} value={exchange}>
                    {exchange}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Default Currency
              <select
                className={INPUT_CLASS_NAME}
                value={connected.defaultCurrency}
                onChange={(event) =>
                  updateConnected("defaultCurrency", event.target.value as AccountConnectionSettings["defaultCurrency"])
                }
              >
                <option value="INR">INR</option>
                <option value="USD">USD</option>
              </select>
            </label>

            <div className="rounded-sm border border-terminal-border/70 bg-terminal-bg/45 px-3 py-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-terminal-muted">Selected market profile</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-terminal-text">
                <CountryFlag countryCode={connected.preferredCountry} size="lg" />
                <span>{COUNTRY_NAME[connected.preferredCountry]}</span>
                <span className="text-terminal-muted">|</span>
                <span className="text-terminal-accent">{connected.preferredExchange}</span>
                <span className="text-terminal-muted">|</span>
                <span>{connected.defaultCurrency}</span>
              </div>
            </div>
          </div>
        </TerminalPanel>

        <TerminalPanel
          title="Integrations & Recovery"
          subtitle="API keys, webhook routing, and export readiness"
          actions={
            <TerminalBadge variant={integrationCount >= 2 ? "success" : "warn"}>{integrationCount}/4 online</TerminalBadge>
          }
        >
          <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
            <label>
              Market Data API Key
              <input
                type="password"
                className={INPUT_CLASS_NAME}
                value={aggregators.marketDataApiKey}
                onChange={(event) => updateAggregators("marketDataApiKey", event.target.value)}
                placeholder="Enter market data key"
              />
            </label>
            <label>
              Execution API Key
              <input
                type="password"
                className={INPUT_CLASS_NAME}
                value={aggregators.executionApiKey}
                onChange={(event) => updateAggregators("executionApiKey", event.target.value)}
                placeholder="Enter execution key"
              />
            </label>
            <label>
              News API Key
              <input
                type="password"
                className={INPUT_CLASS_NAME}
                value={aggregators.newsApiKey}
                onChange={(event) => updateAggregators("newsApiKey", event.target.value)}
                placeholder="Enter news key"
              />
            </label>
            <label>
              Webhook URL
              <input
                className={INPUT_CLASS_NAME}
                value={aggregators.webhookUrl}
                onChange={(event) => updateAggregators("webhookUrl", event.target.value)}
                placeholder="https://example.com/hooks/trading"
              />
            </label>
          </div>

          <div className="mt-3 rounded-sm border border-terminal-border/70 bg-terminal-bg/45 px-3 py-3 text-[11px] leading-5 text-terminal-muted">
            Browser persistence is unchanged: values stay in memory until you press save, then the page writes the same three
            Account localStorage keys and syncs the country, market, and currency selectors back into the settings store.
          </div>
        </TerminalPanel>
      </div>
    </form>
  );
}
