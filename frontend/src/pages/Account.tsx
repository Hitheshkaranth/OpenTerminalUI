import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { CountryFlag } from "../components/common/CountryFlag";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { useAuth } from "../contexts/AuthContext";
import { useSettingsStore } from "../store/settingsStore";
import { COUNTRY_MARKETS, type CountryCode, type MarketCode } from "../types";

type ProfileForm = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
  timezone: string;
  riskProfile: "conservative" | "moderate" | "aggressive";
  bio: string;
  avatarDataUrl: string;
};

type ConnectedAccountForm = {
  brokerName: string;
  accountAlias: string;
  preferredCountry: CountryCode;
  preferredExchange: MarketCode;
  defaultCurrency: "INR" | "USD";
};

type AggregatorForm = {
  marketDataApiKey: string;
  executionApiKey: string;
  newsApiKey: string;
  webhookUrl: string;
};

const PROFILE_STORAGE_KEY = "ot.account.profile";
const CONNECTED_STORAGE_KEY = "ot.account.connected";
const AGGREGATORS_STORAGE_KEY = "ot.account.aggregators";

const COUNTRY_NAME: Record<CountryCode, string> = {
  IN: "India",
  US: "United States",
};

const COUNTRY_DEFAULT_EXCHANGE: Record<CountryCode, MarketCode> = {
  IN: "NSE",
  US: "NASDAQ",
};

function initials(firstName: string, lastName: string, email: string): string {
  const first = firstName.trim().charAt(0);
  const last = lastName.trim().charAt(0);
  if (first || last) return `${first}${last}`.toUpperCase();
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

export function AccountPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const selectedCountry = useSettingsStore((s) => s.selectedCountry);
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const setSelectedCountry = useSettingsStore((s) => s.setSelectedCountry);
  const setSelectedMarket = useSettingsStore((s) => s.setSelectedMarket);
  const setDisplayCurrency = useSettingsStore((s) => s.setDisplayCurrency);

  const [profile, setProfile] = useState<ProfileForm>(() =>
    loadLocalState<ProfileForm>(PROFILE_STORAGE_KEY, {
      firstName: "",
      lastName: "",
      dateOfBirth: "",
      phone: "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      riskProfile: "moderate",
      bio: "",
      avatarDataUrl: "",
    }),
  );
  const [connected, setConnected] = useState<ConnectedAccountForm>(() =>
    loadLocalState<ConnectedAccountForm>(CONNECTED_STORAGE_KEY, {
      brokerName: "Primary Broker",
      accountAlias: "Main Trading",
      preferredCountry: selectedCountry,
      preferredExchange: selectedMarket,
      defaultCurrency: displayCurrency,
    }),
  );
  const [aggregators, setAggregators] = useState<AggregatorForm>(() =>
    loadLocalState<AggregatorForm>(AGGREGATORS_STORAGE_KEY, {
      marketDataApiKey: "",
      executionApiKey: "",
      newsApiKey: "",
      webhookUrl: "",
    }),
  );
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    const exchanges = COUNTRY_MARKETS[connected.preferredCountry];
    if (!exchanges.includes(connected.preferredExchange)) {
      setConnected((prev) => ({
        ...prev,
        preferredExchange: COUNTRY_DEFAULT_EXCHANGE[prev.preferredCountry],
      }));
    }
  }, [connected.preferredCountry, connected.preferredExchange]);

  if (!user) {
    return (
      <div className="space-y-3 p-3">
        <TerminalPanel title="Account" subtitle="User details">
          <div className="text-xs text-terminal-muted">No authenticated user.</div>
        </TerminalPanel>
      </div>
    );
  }

  const userInitials = initials(profile.firstName, profile.lastName, user.email);
  const availableExchanges = COUNTRY_MARKETS[connected.preferredCountry];

  const completion = useMemo(() => {
    let score = 0;
    if (profile.firstName.trim()) score += 1;
    if (profile.lastName.trim()) score += 1;
    if (profile.dateOfBirth.trim()) score += 1;
    if (profile.phone.trim()) score += 1;
    if (profile.avatarDataUrl) score += 1;
    return Math.round((score / 5) * 100);
  }, [profile.avatarDataUrl, profile.dateOfBirth, profile.firstName, profile.lastName, profile.phone]);

  const onAvatarUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      setProfile((prev) => ({ ...prev, avatarDataUrl: result }));
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

    setMessage("Account details saved.");
    window.setTimeout(() => setMessage(""), 2500);
  };

  return (
    <form className="space-y-3 p-3" onSubmit={onSave}>
      <TerminalPanel title="Account Overview" subtitle="Identity, exchange preferences, and integrations">
        <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-[96px_1fr_auto]">
          <div className="flex items-center justify-center">
            {profile.avatarDataUrl ? (
              <img src={profile.avatarDataUrl} alt="Profile" className="h-20 w-20 rounded-full border border-terminal-border object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full border border-terminal-border text-2xl text-terminal-accent">
                {userInitials}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <div className="text-terminal-muted">Signed in as</div>
            <div className="text-sm text-terminal-text">{user.email}</div>
            <div className="text-terminal-muted">Role: <span className="text-terminal-accent uppercase">{user.role}</span></div>
            <div className="text-terminal-muted">Profile completion: <span className="text-terminal-text">{completion}%</span></div>
          </div>
          <div className="flex items-start gap-2">
            <button type="button" className="rounded border border-terminal-border px-3 py-1 text-terminal-text" onClick={() => navigate(-1)}>
              Back
            </button>
            <button type="submit" className="rounded border border-terminal-accent bg-terminal-accent/10 px-3 py-1 font-semibold text-terminal-accent">
              Save
            </button>
          </div>
        </div>
      </TerminalPanel>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_1fr]">
        <TerminalPanel title="Profile Details" subtitle="Personal details">
          <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
            <label>First Name
              <input className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={profile.firstName} onChange={(e) => setProfile((prev) => ({ ...prev, firstName: e.target.value }))} />
            </label>
            <label>Last Name
              <input className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={profile.lastName} onChange={(e) => setProfile((prev) => ({ ...prev, lastName: e.target.value }))} />
            </label>
            <label>Date of Birth
              <input type="date" className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={profile.dateOfBirth} onChange={(e) => setProfile((prev) => ({ ...prev, dateOfBirth: e.target.value }))} />
            </label>
            <label>Phone
              <input className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={profile.phone} onChange={(e) => setProfile((prev) => ({ ...prev, phone: e.target.value }))} placeholder="+1 555 123 9876" />
            </label>
            <label>Timezone
              <input className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={profile.timezone} onChange={(e) => setProfile((prev) => ({ ...prev, timezone: e.target.value }))} />
            </label>
            <label>Risk Profile
              <select className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 uppercase" value={profile.riskProfile} onChange={(e) => setProfile((prev) => ({ ...prev, riskProfile: e.target.value as ProfileForm["riskProfile"] }))}>
                <option value="conservative">Conservative</option>
                <option value="moderate">Moderate</option>
                <option value="aggressive">Aggressive</option>
              </select>
            </label>
            <label className="md:col-span-2">Profile Image
              <div className="mt-1 flex items-center gap-2">
                <input type="file" accept="image/*" className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" onChange={onAvatarUpload} />
                <button
                  type="button"
                  className="rounded border border-terminal-border px-2 py-1"
                  onClick={() => setProfile((prev) => ({ ...prev, avatarDataUrl: "" }))}
                >
                  Remove
                </button>
              </div>
            </label>
            <label className="md:col-span-2">Bio
              <textarea className="mt-1 h-20 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={profile.bio} onChange={(e) => setProfile((prev) => ({ ...prev, bio: e.target.value }))} />
            </label>
          </div>
        </TerminalPanel>

        <TerminalPanel title="Attached Account" subtitle="Country, exchange, and execution preference">
          <div className="space-y-2 text-xs">
            <label>Broker Name
              <input className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={connected.brokerName} onChange={(e) => setConnected((prev) => ({ ...prev, brokerName: e.target.value }))} />
            </label>
            <label>Account Alias
              <input className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={connected.accountAlias} onChange={(e) => setConnected((prev) => ({ ...prev, accountAlias: e.target.value }))} />
            </label>
            <label>Preferred Country
              <select
                className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 uppercase"
                value={connected.preferredCountry}
                onChange={(e) => setConnected((prev) => ({ ...prev, preferredCountry: e.target.value as CountryCode }))}
              >
                <option value="IN">IN - India</option>
                <option value="US">US - United States</option>
              </select>
            </label>
            <label>Preferred Exchange
              <select
                className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 uppercase"
                value={connected.preferredExchange}
                onChange={(e) => setConnected((prev) => ({ ...prev, preferredExchange: e.target.value as MarketCode }))}
              >
                {availableExchanges.map((exchange) => (
                  <option key={exchange} value={exchange}>{exchange}</option>
                ))}
              </select>
            </label>
            <label>Default Currency
              <select
                className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 uppercase"
                value={connected.defaultCurrency}
                onChange={(e) => setConnected((prev) => ({ ...prev, defaultCurrency: e.target.value as "INR" | "USD" }))}
              >
                <option value="INR">INR</option>
                <option value="USD">USD</option>
              </select>
            </label>
            <div className="rounded border border-terminal-border/50 bg-terminal-bg px-2 py-2">
              <div className="mb-1 text-terminal-muted">Selected market profile</div>
              <div className="flex items-center gap-2">
                <CountryFlag countryCode={connected.preferredCountry} size="lg" />
                <span className="text-terminal-text">{COUNTRY_NAME[connected.preferredCountry]}</span>
                <span className="text-terminal-muted">|</span>
                <span className="text-terminal-accent">{connected.preferredExchange}</span>
              </div>
            </div>
          </div>
        </TerminalPanel>
      </div>

      <TerminalPanel title="Aggregators" subtitle="API keys and integration endpoints">
        <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
          <label>Market Data API Key
            <input type="password" className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={aggregators.marketDataApiKey} onChange={(e) => setAggregators((prev) => ({ ...prev, marketDataApiKey: e.target.value }))} placeholder="Enter market data key" />
          </label>
          <label>Execution API Key
            <input type="password" className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={aggregators.executionApiKey} onChange={(e) => setAggregators((prev) => ({ ...prev, executionApiKey: e.target.value }))} placeholder="Enter execution key" />
          </label>
          <label>News API Key
            <input type="password" className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={aggregators.newsApiKey} onChange={(e) => setAggregators((prev) => ({ ...prev, newsApiKey: e.target.value }))} placeholder="Enter news key" />
          </label>
          <label>Webhook URL
            <input className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={aggregators.webhookUrl} onChange={(e) => setAggregators((prev) => ({ ...prev, webhookUrl: e.target.value }))} placeholder="https://example.com/hooks/trading" />
          </label>
        </div>
      </TerminalPanel>

      <TerminalPanel title="Bottom Actions" subtitle="Session controls">
        <div className="flex flex-wrap gap-2 text-xs">
          <button type="submit" className="rounded border border-terminal-accent bg-terminal-accent/10 px-3 py-1 font-semibold text-terminal-accent">
            Save Account Details
          </button>
          <button
            type="button"
            className="rounded border border-terminal-neg px-3 py-1 text-terminal-neg"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            Logout
          </button>
          {message ? <span className="self-center text-terminal-pos">{message}</span> : null}
        </div>
      </TerminalPanel>
    </form>
  );
}
