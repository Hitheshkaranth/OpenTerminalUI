import { api } from "./base";

export type ScreenCoverage = { requested: number; evaluated: number; missing: string[]; stale: string[]; unknown: string[] };
export type ScreenMatch = { symbol: string; values: Record<string, number>; observed_at: string; source: string };
export type ScreenChange = { id: string; symbol: string; kind: "entered" | "exited"; observed_at: string; before: Record<string, number>; after: Record<string, number>; rules: string[]; source: string; data_observed_at: string };
export type ScreenSchedule = {
  id: string; screen_id: string; name: string; query: string; universe: string; market: "US" | "IN";
  frequency: "daily" | "weekly"; enabled: boolean; max_age_hours: number; next_run_at: string;
  last_run_at: string | null; matches: ScreenMatch[]; coverage: ScreenCoverage | null;
  refresh?: { attempted: number; refreshed: number; failed: string[]; next_cursor: number } | null;
  changes: ScreenChange[]; error: string | null; baseline: boolean;
};
export type ScheduleInput = Pick<ScreenSchedule, "screen_id" | "universe" | "market" | "frequency" | "enabled" | "max_age_hours">;
export type ScreenPreview = { name: string; universe: string; frequency: string; coverage: ScreenCoverage; matches: ScreenMatch[]; rules: string[]; policy: string; data_policy: string; delivery: string; next_run_at: string };
const base = "/screen-monitoring";
export const listScreenSchedules = async (): Promise<ScreenSchedule[]> => (await api.get(base)).data.items;
export const previewScreenSchedule = async (input: ScheduleInput): Promise<ScreenPreview> => (await api.post(`${base}/preview`, input)).data;
export const saveScreenSchedule = async (input: ScheduleInput): Promise<ScreenSchedule> => (await api.post(base, input)).data;
export const runScreenSchedule = async (id: string): Promise<ScreenSchedule> => (await api.post(`${base}/${encodeURIComponent(id)}/run`)).data;
export const patchScreenSchedule = async (id: string, input: Partial<Pick<ScreenSchedule, "enabled" | "frequency">>): Promise<ScreenSchedule> => (await api.patch(`${base}/${encodeURIComponent(id)}`, input)).data;
