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
  document_id?: number | null;
  page?: number | null;
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
  catalysts: string[];
  invalidation_conditions: string[];
  evidence: DossierEvidence[];
  linked_run_ids: string[];
  portfolio_id?: string | null;
  monitoring_enabled: boolean;
  materiality_threshold: number;
  revision: number;
  created_at: string;
  updated_at: string;
}
export type DossierDraft = Omit<ResearchDossier, "id" | "revision" | "created_at" | "updated_at">;
const base = "/research/dossiers";
export const listDossiers = async (): Promise<ResearchDossier[]> => (await api.get<{ items: ResearchDossier[] }>(base)).data.items;
export const createDossier = async (draft: DossierDraft): Promise<ResearchDossier> => (await api.post(base, draft)).data;
export const updateDossier = async (id: string, draft: Partial<DossierDraft> & { expected_revision?: number }): Promise<ResearchDossier> => (await api.patch(`${base}/${encodeURIComponent(id)}`, draft)).data;
export const deleteDossier = async (id: string): Promise<void> => { await api.delete(`${base}/${encodeURIComponent(id)}`); };
export const monitorDossier = async (id: string, evidence?: DossierEvidence[]): Promise<{ dossier: ResearchDossier; changes: unknown[]; revision: number }> => (await api.post(`${base}/${encodeURIComponent(id)}/monitor`, evidence ? { evidence } : {})).data;
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
  invalidation_conditions: [], evidence: [], linked_run_ids: [], monitoring_enabled: false,
  materiality_threshold: 5,
});
