import { api } from "./base";
import { countryForExchange } from "../lib/instrument";

/** Dossiers use country codes; screen context may carry an exchange instead. */
export function dossierMarket(value?: string | null): "US" | "IN" {
  const market = value?.trim().toUpperCase();
  if (market === "IN" || market === "US") return market;
  if (market === "NSE" || market === "BSE" || market === "NASDAQ" || market === "NYSE") {
    return countryForExchange(market);
  }
  return "US";
}

export interface DossierEvidence {
  id: string;
  claim: string;
  stance: "supporting" | "opposing" | "neutral";
  source_url?: string | null;
  source_title?: string | null;
  quote?: string | null;
  published_at?: string | null;
  observed_at?: string | null;
  metric?: string | null;
  value?: number | null;
  unit?: string | null;
  period?: string | null;
  document_id?: number | null;
  page?: number | null;
}
export interface ThesisCondition {
  id: string; label: string; metric: string; operator: "gte" | "lte" | "gt" | "lt" | "eq";
  threshold: number; unit: string; period?: string | null; enabled: boolean;
}
export interface ConditionStatus {
  condition: ThesisCondition; condition_id: string; status: "within_threshold" | "breached" | "unknown";
  reason: string; value: number | null; previous_value: number | null; evidence: DossierEvidence | null;
  conflicting_evidence?: DossierEvidence[];
}
export interface EarningsMetric {
  metric: string; label: string; unit: string; expected?: number | null; guidance_low?: number | null;
  guidance_high?: number | null; actual?: number | null; source_url?: string | null; quote?: string;
  published_at?: string | null; guidance_source_url?: string | null; guidance_quote?: string;
}
export interface EarningsReview {
  id: string; period: string; expected_report_date?: string | null; recorded_at?: string | null;
  reviewed_at?: string | null; metrics: EarningsMetric[]; notes: string;
}
export interface DossierRevision {
  revision: number;
  created_at: string;
  snapshot: DossierDraft;
  changes: { kind: string; field?: string; reason?: string; material?: boolean; before?: unknown; after?: unknown }[];
}
export interface FilingPassage {
  id: number;
  document_id: number;
  text: string;
  page_start?: number;
  document_title?: string;
  title?: string;
  source_url?: string;
  filed_at?: string;
  content_sha256?: string;
}
export interface ResearchDossier {
  id: string;
  title: string;
  symbol: string;
  market: string;
  thesis: string;
  assumptions: string[];
  thesis_conditions?: ThesisCondition[];
  earnings_reviews?: EarningsReview[];
  condition_status?: ConditionStatus[];
  catalysts: string[];
  invalidation_conditions: string[];
  evidence: DossierEvidence[];
  linked_run_ids: string[];
  portfolio_id?: string | null;
  monitoring_enabled: boolean;
  source_fetch_enabled?: boolean;
  source_fetch?: { status: string; message: string; attempted_at: string; imported: number; duplicates: number } | null;
  materiality_threshold: number;
  revision: number;
  created_at: string;
  updated_at: string;
}
export type DossierDraft = Omit<ResearchDossier, "id" | "revision" | "created_at" | "updated_at" | "condition_status" | "earnings_reviews" | "source_fetch">;
const base = "/research/dossiers";
export const listDossiers = async (): Promise<ResearchDossier[]> => (await api.get<{ items: ResearchDossier[] }>(base)).data.items;
export const createDossier = async (draft: DossierDraft): Promise<ResearchDossier> => (await api.post(base, draft)).data;
export const updateDossier = async (id: string, draft: Partial<DossierDraft> & { expected_revision?: number }): Promise<ResearchDossier> => (await api.patch(`${base}/${encodeURIComponent(id)}`, draft)).data;
export const deleteDossier = async (id: string): Promise<void> => { await api.delete(`${base}/${encodeURIComponent(id)}`); };
export const monitorDossier = async (id: string, evidence?: DossierEvidence[]): Promise<{ dossier: ResearchDossier; changes: unknown[]; revision: number }> => (await api.post(`${base}/${encodeURIComponent(id)}/monitor`, evidence ? { evidence } : {}, { timeout: 120000 })).data;
export const exportDossier = async (id: string): Promise<Blob> => (await api.get<Blob>(`${base}/${encodeURIComponent(id)}/export`, { responseType: "blob" })).data;
export const dossierRevisions = async (id: string): Promise<DossierRevision[]> => (await api.get(`${base}/${encodeURIComponent(id)}/revisions`)).data.items;
export const searchDossierEvidence = async (id: string, q: string, as_of?: string): Promise<FilingPassage[]> => (await api.get(`${base}/${encodeURIComponent(id)}/search`, { params: { q, as_of: as_of || undefined, hybrid: true } })).data.items;
export const shareDossier = async (id: string): Promise<{ token: string; url?: string }> => (await api.post(`${base}/${encodeURIComponent(id)}/share`)).data;
export const revokeDossierShare = async (id: string): Promise<void> => { await api.delete(`${base}/${encodeURIComponent(id)}/share`); };
export const readSharedDossier = async (token: string): Promise<ResearchDossier> => (await api.get(`${base}/shared/${encodeURIComponent(token)}`)).data.dossier;

export function dossierDraft(value: ResearchDossier): DossierDraft {
  const { id: _id, revision: _revision, created_at: _created, updated_at: _updated, ...draft } = value;
  return Object.fromEntries(Object.keys(emptyDossier()).map((key) => [key, draft[key as keyof DossierDraft]])) as unknown as DossierDraft;
}

export const emptyDossier = (): DossierDraft => ({
  title: "", symbol: "", market: "US", thesis: "", assumptions: [], catalysts: [],
  thesis_conditions: [], invalidation_conditions: [], evidence: [], linked_run_ids: [], monitoring_enabled: false, source_fetch_enabled: false,
  materiality_threshold: 5,
});

export const saveEarningsReview = async (id: string, review: EarningsReview, expected_revision: number): Promise<ResearchDossier> =>
  (await api.post(`${base}/${encodeURIComponent(id)}/earnings-reviews`, { review, expected_revision })).data;
export interface EarningsContext {
  warnings?: string[];
  results: { currency?: string; quarters: { period: string; period_end?: string; revenue?: number | null; eps?: number | null; ebitda_margin_pct?: number | null; revenue_yoy_pct?: number | null }[]; warnings?: string[] };
  guidance: { quote?: string; metric?: string; status?: string; period?: string; source_url?: string }[];
  note: string;
}
export const getEarningsContext = async (id: string): Promise<EarningsContext> =>
  (await api.get(`${base}/${encodeURIComponent(id)}/earnings-context`)).data;
