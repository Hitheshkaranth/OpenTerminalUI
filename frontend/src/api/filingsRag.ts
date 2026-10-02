import { api } from "./base";

// Typed client for the filings-rag API (see docs/FILINGS_INTELLIGENCE.md).
// Getters that may 404 (analysis, knowledge) return null; everything else
// throws and callers surface extractApiErrorMessage.

const BASE = "/filings-rag"; // api baseURL already adds /api

// The shared client times out at 30 s. Importing a 300-page annual report, running the per-driver
// analysis or building summaries takes minutes server-side, so these calls get their own budget.
const LONG_TIMEOUT_MS = 300_000;
const ASK_TIMEOUT_MS = 120_000;

export type DocType =
  | "annual_report"
  | "quarterly_filing"
  | "concall_transcript"
  | "investor_presentation"
  | "press_release"
  | "regulatory"
  | "other";

export type DocSource = "upload" | "sec" | "nse" | "url";

export type Document = {
  id: number;
  symbol: string;
  doc_type: DocType;
  title: string;
  period: string | null;
  source: DocSource;
  source_url: string | null;
  filed_at: string | null;
  pages: number;
  chunks: number;
  chars: number;
  created_at: string;
};

export type DocumentsList = { symbol: string; documents: Document[] };

export type Citation = {
  doc_id: number;
  title: string;
  page_start: number;
  page_end: number;
  section: string | null;
  quote: string;
  source_url: string | null;
};

export type Finding = {
  claim: string;
  metric: string | null;
  value: number | null;
  unit: string | null;
  period: string | null;
  magnitude: "high" | "medium" | "low";
  confidence: number; // 0..1
  citation: Citation;
};

export type DriverResult = {
  id: string;
  label: string;
  kind: "growth" | "headwind";
  // "lexical" = the AI call failed for this driver and keyword matches are shown instead (not scored).
  engine?: "llm" | "lexical";
  summary: string;
  strength: number; // 0..100
  findings: Finding[];
};

export type Stance = "constructive" | "balanced" | "cautious" | "insufficient_evidence";

export type Analysis = {
  symbol: string;
  created_at: string;
  engine: "llm" | "lexical";
  model: string | null;
  documents_used: number;
  scores: { growth: number; headwind: number; net: number };
  stance: Stance;
  growth: DriverResult[];
  headwinds: DriverResult[];
  coverage: { driver_id: string; chunks_searched: number }[];
  warnings: string[];
};

export type Driver = {
  id: string;
  label: string;
  kind: "growth" | "headwind";
  description: string;
};

export type Taxonomy = { growth: Driver[]; headwind: Driver[] };

// ── Documents ─────────────────────────────────────────────────────────────────

export async function fetchDocuments(symbol: string): Promise<DocumentsList> {
  return api.get<DocumentsList>(`${BASE}/${encodeURIComponent(symbol)}/documents`).then((r) => r.data);
}

export async function uploadDocument(
  symbol: string,
  file: File,
  opts: { doc_type?: string; title?: string; period?: string } = {},
): Promise<Document> {
  const form = new FormData();
  form.append("file", file);
  if (opts.doc_type) form.append("doc_type", opts.doc_type);
  if (opts.title) form.append("title", opts.title);
  if (opts.period) form.append("period", opts.period);
  const { data } = await api.post<Document>(
    `${BASE}/${encodeURIComponent(symbol)}/documents/upload`,
    form,
    { headers: { "Content-Type": "multipart/form-data" }, timeout: LONG_TIMEOUT_MS },
  );
  return data;
}

export type ImportSource = "sec" | "nse";

export type ImportResult = {
  symbol: string;
  imported: Document[];
  skipped: { title: string; reason: string }[];
};

export async function fetchAutoImport(
  symbol: string,
  sources: ImportSource[] = ["sec", "nse"],
  limit = 6,
): Promise<ImportResult> {
  const { data } = await api.post<ImportResult>(
    `${BASE}/${encodeURIComponent(symbol)}/documents/fetch`,
    { sources, limit },
    { timeout: LONG_TIMEOUT_MS },
  );
  return data;
}

export async function deleteDocument(symbol: string, docId: number): Promise<void> {
  await api.delete<unknown>(`${BASE}/${encodeURIComponent(symbol)}/documents/${docId}`);
}

// ── Analysis ──────────────────────────────────────────────────────────────────

export async function buildAnalysis(
  symbol: string,
  opts: { use_llm?: boolean; drivers?: string[] } = {},
): Promise<Analysis> {
  const { data } = await api.post<Analysis>(
    `${BASE}/${encodeURIComponent(symbol)}/analyze`,
    { use_llm: opts.use_llm ?? true, drivers: opts.drivers },
    { timeout: LONG_TIMEOUT_MS },
  );
  return data;
}

// Returns null when the backend has no analysis for the symbol (HTTP 404) — a
// normal empty state, not an error.
export async function fetchAnalysis(symbol: string): Promise<Analysis | null> {
  const response = await api.get<Analysis>(`${BASE}/${encodeURIComponent(symbol)}/analysis`, {
    validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
  });
  return response.status === 404 ? null : response.data;
}

// ── Ask ───────────────────────────────────────────────────────────────────────

export type AskResponse = {
  answer: string;
  engine: "llm" | "lexical";
  citations: Citation[];
};

export async function askFilings(
  symbol: string,
  question: string,
  k = 8,
): Promise<AskResponse> {
  const { data } = await api.post<AskResponse>(
    `${BASE}/${encodeURIComponent(symbol)}/ask`,
    { question, k },
    { timeout: ASK_TIMEOUT_MS },
  );
  return data;
}

// ── Taxonomy ──────────────────────────────────────────────────────────────────

export async function fetchTaxonomy(): Promise<Taxonomy> {
  return api.get<Taxonomy>(`${BASE}/taxonomy`).then((r) => r.data);
}

// ── Knowledge (concall summaries + guidance) ──────────────────────────────────

export type ManagementTone = "positive" | "neutral" | "negative";

export type KeyNumber = { label: string; value: number | null; unit: string | null };

export type ConcallSummary = {
  doc_id: number;
  title: string;
  period: string | null;
  filed_at: string | null;
  engine: "llm" | "lexical";
  highlights: string[];
  management_tone: ManagementTone;
  key_numbers: KeyNumber[];
  qa_themes: string[];
  citations: Citation[];
};

export type GuidanceItem = {
  metric: string;
  statement: string;
  target: string | null;
  period: string | null;
  said_in: { doc_id: number; title: string; period: string | null };
  status: "new" | "reiterated" | "raised" | "lowered" | "met" | "missed" | "unknown";
  citation: Citation;
};

export type Knowledge = {
  symbol: string;
  created_at: string;
  engine: "llm" | "lexical";
  concalls: ConcallSummary[];
  guidance: GuidanceItem[];
  warnings: string[];
};

// Returns null when the knowledge base has not been built for the symbol.
export async function fetchKnowledge(symbol: string): Promise<Knowledge | null> {
  const response = await api.get<Knowledge>(`${BASE}/${encodeURIComponent(symbol)}/knowledge`, {
    validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
  });
  return response.status === 404 ? null : response.data;
}

export async function buildKnowledge(
  symbol: string,
  use_llm = true,
): Promise<Knowledge> {
  const { data } = await api.post<Knowledge>(
    `${BASE}/${encodeURIComponent(symbol)}/knowledge/build`,
    { use_llm },
    { timeout: LONG_TIMEOUT_MS },
  );
  return data;
}