import { useQuery } from "@tanstack/react-query";

import { api } from "./base";

export type EventItem = {
  id: string;
  type: "earnings" | "dividend" | "split" | "bonus" | "rights" | "corporate" | "expiry" | "macro";
  symbol: string | null;
  title: string;
  date: string;
  time: string | null;
  impact: "high" | "medium" | "low" | "neutral";
  source: string;
  detail: Record<string, unknown>;
};

export type EventsHubResponse = {
  as_of: string;
  days: number;
  symbols: string[];
  items: EventItem[];
  errors: Array<{ source: string; reason: string }>;
};

export async function fetchUpcomingEvents(params: {
  symbols?: string[];
  days?: number;
  types?: EventItem["type"][] | string[];
}): Promise<EventsHubResponse> {
  const searchParams = new URLSearchParams();
  if (params.symbols && params.symbols.length > 0) {
    searchParams.set("symbols", params.symbols.join(","));
  }
  if (params.days != null) {
    searchParams.set("days", String(params.days));
  }
  if (params.types && params.types.length > 0) {
    searchParams.set("types", params.types.join(","));
  }
  const { data } = await api.get<EventsHubResponse>(`/events-hub/upcoming?${searchParams.toString()}`);
  return data;
}

export function useUpcomingEvents(
  symbols: string[],
  days = 30,
  types?: string[],
) {
  return useQuery({
    queryKey: ["events-hub", symbols.join(","), days, (types ?? []).join(",")],
    queryFn: () => fetchUpcomingEvents({ symbols, days, types }),
    staleTime: 5 * 60 * 1000,
    enabled: symbols.length > 0 || (types ?? []).some((t) => t === "macro" || t === "expiry"),
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

export function daysUntil(dateISO: string, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Parse "YYYY-MM-DD" as a LOCAL calendar date. `new Date("YYYY-MM-DD")` is UTC
  // midnight, which lands on the previous local day anywhere west of UTC.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateISO);
  const target = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(dateISO);
  const targetDate = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const diffMs = targetDate.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}