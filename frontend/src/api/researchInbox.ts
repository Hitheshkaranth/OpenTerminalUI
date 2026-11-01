import { api } from './base';
export type ReviewStatus = 'needs_review' | 'reviewed' | 'snoozed';
export type ReviewBucket = 'needs_review' | 'upcoming' | 'reviewed';
export interface ResearchEvent {
  id: string; kind: string; symbol: string; title: string; reason: string; priority: string;
  occurred_at: string | null; source_url: string; dossier_id?: string;
  changes: Array<Record<string, unknown>>; upcoming: boolean; status: ReviewStatus;
  bucket: ReviewBucket; snoozed_until: string | null;
}
export interface ResearchInbox {
  items: ResearchEvent[]; counts: Record<ReviewBucket, number>;
  coverage: { dossiers: number; enabled: number; checked: number; awaiting_check: number; disabled: number; last_checked_at: string | null; scope: string; source_fetch_enabled?: number; source_fetch_issues?: Array<{ dossier_id: string; symbol: string; status?: string; message?: string }>; screen_schedules: number; recently_checked?: number; check_freshness_minutes?: number; screen_enabled?: number; screen_checked?: number; screen_awaiting_check?: number; screen_failed?: number; screen_partial?: number; screen_overdue?: number; screen_evaluated?: number; screen_requested?: number };
}
export interface ExposureHolding {
  symbol: string; weight_pct: number | null; business_share_pct: number | null;
  basis: string; citation: Record<string, unknown> | null; observed_at?: string;
  condition?: { label: string; operator: string; threshold: number; unit: string };
  dossiers: Array<{ id: string; title: string }>;
  quote_provenance?: { source: string; quality: string; as_of: string | null; currency: string | null; eligible: boolean; reasons: string[] };
}
export interface ExposureGroup { id: string; name: string; kind: string; holding_count: number; portfolio_weight_pct: number | null; holdings: ExposureHolding[] }
export interface PortfolioImpact {
  portfolio_name: string; items: ExposureGroup[];
  coverage: { holdings: number; with_cited_relationships: number; unknown_symbols: string[]; quote_gaps: string[]; weights_complete: boolean };
  weight_basis: string; interpretation: string; currency: string;
}
export const fetchResearchInbox = async (): Promise<ResearchInbox> => (await api.get('/research/inbox')).data;
export const reviewResearchEvent = async (id: string, status: ReviewStatus, snoozed_until?: string): Promise<void> => { await api.patch(`/research/inbox/events/${encodeURIComponent(id)}`, { status, snoozed_until }); };
export const fetchResearchPortfolios = async (): Promise<Array<{ id: string; name: string; currency: string }>> => (await api.get('/research/inbox/portfolios')).data.items;
export const fetchPortfolioImpact = async (id: string): Promise<PortfolioImpact> => (await api.get(`/research/inbox/portfolios/${encodeURIComponent(id)}/impact`)).data;
