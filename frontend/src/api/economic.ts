import { api } from "./base";
import type {
  EconomicEvent,
  MacroIndicatorsResponse,
} from "../types";

export async function fetchEconomicCalendar(from: string, to: string): Promise<EconomicEvent[]> {
  const { data } = await api.get<EconomicEvent[] | { items: EconomicEvent[] }>("/economics/calendar", { params: { from, to } });
  return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
}

export async function fetchMacroIndicators(country = "IN"): Promise<MacroIndicatorsResponse> {
  const { data } = await api.get<MacroIndicatorsResponse>("/economics/indicators", { params: { country } });
  return data;
}
