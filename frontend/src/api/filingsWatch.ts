import { api, extractApiErrorMessage } from "./base";

export type FilingsWatchNotifyKind = "new_document" | "adverse_regulatory" | "guidance_cut" | "stance_change";
export type FilingsWatchSymbolSource = "watchlists" | "custom";

export type FilingsWatchSettings = {
  enabled: boolean;
  symbols_source: FilingsWatchSymbolSource;
  custom_symbols: string[];
  run_hour_utc: number;
  notify_on: FilingsWatchNotifyKind[];
  sources: string[];
  import_limit: number;
};

export type FilingsWatchEvent = {
  at: string;
  symbol: string;
  kind: FilingsWatchNotifyKind;
  title: string;
  detail: string | null;
  action_url: string;
};

export const FILINGS_WATCH_NOTIFY_OPTIONS: { value: FilingsWatchNotifyKind; label: string }[] = [
  { value: "new_document", label: "New filing imported" },
  { value: "adverse_regulatory", label: "Adverse regulatory action" },
  { value: "guidance_cut", label: "Guidance cut" },
  { value: "stance_change", label: "Stance change" },
];

export async function fetchFilingsWatchSettings(): Promise<FilingsWatchSettings> {
  try {
    const { data } = await api.get<FilingsWatchSettings>("/filings-watch/settings");
    return data;
  } catch (error) {
    throw new Error(extractApiErrorMessage(error, "Failed to load filings watch settings"));
  }
}

export async function saveFilingsWatchSettings(payload: FilingsWatchSettings): Promise<FilingsWatchSettings> {
  try {
    const { data } = await api.put<FilingsWatchSettings>("/filings-watch/settings", payload);
    return data;
  } catch (error) {
    throw new Error(extractApiErrorMessage(error, "Failed to save filings watch settings"));
  }
}

export async function runFilingsWatchNow(): Promise<{ started: boolean }> {
  try {
    const { data } = await api.post<{ started: boolean }>("/filings-watch/run");
    return data;
  } catch (error) {
    throw new Error(extractApiErrorMessage(error, "Failed to run filings watch"));
  }
}

export async function fetchFilingsWatchEvents(limit = 50): Promise<FilingsWatchEvent[]> {
  try {
    const { data } = await api.get<{ items: FilingsWatchEvent[] }>("/filings-watch/events", { params: { limit } });
    return data.items || [];
  } catch (error) {
    throw new Error(extractApiErrorMessage(error, "Failed to load filings watch events"));
  }
}