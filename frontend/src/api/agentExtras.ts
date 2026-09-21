import { api } from "./base";

// ── C12: Threads ────────────────────────────────────────────────────────────

export interface ThreadItem {
  thread_id: string;
  title: string;
  updated_at: string;
  message_count: number;
}

export interface ThreadDetail {
  thread_id: string;
  messages: {
    id: string;
    role: "user" | "assistant";
    content: string;
    run_id: string | null;
    created_at: string;
  }[];
}

export function listThreads(): Promise<{ items: ThreadItem[] }> {
  return api.get("/agent/threads").then((r) => r.data);
}

export function getThread(threadId: string): Promise<ThreadDetail> {
  return api.get(`/agent/threads/${threadId}`).then((r) => r.data);
}

export function deleteThread(threadId: string): Promise<{ status: string }> {
  return api.delete(`/agent/threads/${threadId}`).then((r) => r.data);
}

// ── C13: Memory notes ───────────────────────────────────────────────────────

export interface NoteItem {
  id: string;
  symbol: string | null;
  kind: "note" | "thesis" | "reflection";
  content: string;
  source: "user" | "agent" | "reflection";
  created_at: string;
}

export interface NotesResponse {
  items: NoteItem[];
}

export interface CreateNotePayload {
  symbol: string | null;
  kind: "note" | "thesis";
  content: string;
}

export interface ReflectionResult {
  created: number;
  skipped: number;
}

export function listNotes(symbol?: string): Promise<NotesResponse> {
  const params: Record<string, string> = {};
  if (symbol) params.symbol = symbol;
  return api.get("/agent/notes", { params }).then((r) => r.data);
}

export function addNote(payload: CreateNotePayload): Promise<NoteItem> {
  return api.post("/agent/notes", payload).then((r) => r.data);
}

export function deleteNote(id: string): Promise<{ status: string }> {
  return api.delete(`/agent/notes/${id}`).then((r) => r.data);
}

export function runReflections(benchmarkDays = 0): Promise<ReflectionResult> {
  return api.post("/agent/reflections/run", null, { params: { benchmark_days: benchmarkDays } }).then((r) => r.data);
}

// ── C14: Proposals ──────────────────────────────────────────────────────────

export interface ProposalItem {
  proposal_id: string;
  type: "paper_order" | "alert" | "watchlist_add";
  summary: string;
  payload: Record<string, unknown>;
  status: "pending" | "confirmed" | "rejected" | "expired" | "failed";
  expires_at: string;
  created_at?: string;
  rationale?: string;
  result?: Record<string, unknown> | null;
}

export interface ProposalsResponse {
  items: ProposalItem[];
}

export interface ConfirmResponse {
  id: string;
  status: "confirmed" | "failed";
  result: Record<string, unknown> | null;
}

export function listProposals(status?: string): Promise<ProposalsResponse> {
  const params: Record<string, string> = {};
  if (status) params.status = status;
  return api.get("/agent/proposals", { params }).then((r) => r.data);
}

export function confirmProposal(id: string): Promise<ConfirmResponse> {
  return api.post(`/agent/proposals/${id}/confirm`).then((r) => r.data);
}

export function rejectProposal(id: string): Promise<{ status: string }> {
  return api.post(`/agent/proposals/${id}/reject`).then((r) => r.data);
}

// ── C15: Signals & scorecard ────────────────────────────────────────────────

export interface SignalItem {
  id: string;
  symbol: string;
  persona: string;
  signal: "bullish" | "bearish" | "neutral";
  confidence: number;
  reason: string;
  price_at_signal: number | null;
  created_at: string;
  evaluated_at: string | null;
  horizon_days: number | null;
  realized_return_pct: number | null;
  benchmark_return_pct: number | null;
  correct: boolean | null;
}

export interface SignalsResponse {
  items: SignalItem[];
}

export interface EvaluateSignalsResult {
  evaluated: number;
  skipped: number;
}

export interface ScorecardPersona {
  id: string;
  label: string;
  evaluated: number;
  accuracy: number | null;
  avg_return_pct: number | null;
}

export interface ScorecardResponse {
  personas: ScorecardPersona[];
  as_of: string;
}

export function listSignals(params?: { symbol?: string; persona?: string; limit?: number }): Promise<SignalsResponse> {
  return api.get("/agent/signals", { params }).then((r) => r.data);
}

export function evaluateSignals(horizonDays = 10): Promise<EvaluateSignalsResult> {
  return api.post("/agent/signals/evaluate", null, { params: { horizon_days: horizonDays } }).then((r) => r.data);
}

export function getScorecard(): Promise<ScorecardResponse> {
  return api.get("/agent/signals/scorecard").then((r) => r.data);
}