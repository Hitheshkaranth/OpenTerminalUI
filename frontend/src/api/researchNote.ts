// One-click research note export — API + note builder (agent P).
//
// Gathers the per-company data sets consumed by a research note in parallel and
// renders them as a cited Markdown note (buildResearchNote) or a print-ready
// HTML document (toPrintHtml). Fetchers are intentionally self-contained: each
// one is small and duplicated here rather than imported from other agents'
// (possibly unfinished) api files.

import { api, extractApiErrorMessage } from "./base";

// ── Shared filings types (see docs/FILINGS_INTELLIGENCE.md) ──────────────────

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
  summary: string;
  strength: number; // 0..100
  findings: Finding[];
};

export type AnalysisStance = "constructive" | "balanced" | "cautious" | "insufficient_evidence";

export type Analysis = {
  symbol: string;
  created_at: string;
  engine: "llm" | "lexical";
  model: string | null;
  documents_used: number;
  scores: { growth: number; headwind: number; net: number };
  stance: AnalysisStance;
  growth: DriverResult[];
  headwinds: DriverResult[];
  coverage: { driver_id: string; chunks_searched: number }[];
  warnings: string[];
};

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

export type GuidanceStatus = "new" | "reiterated" | "raised" | "lowered" | "met" | "missed" | "unknown";

export type GuidanceItem = {
  metric: string;
  statement: string;
  target: string | null;
  period: string | null;
  said_in: { doc_id: number; title: string; period: string | null };
  status: GuidanceStatus;
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

// ── Business metrics (agent D) ────────────────────────────────────────────────

export type KpiCategory = "order_book" | "capacity" | "operational" | "customers" | "financial";
export type KpiPoint = { period: string; value: number; citation: Citation | null };
export type KpiSeries = {
  key: string;
  label: string;
  unit: string | null;
  category: KpiCategory;
  points: KpiPoint[];
};
export type MixDimension = "segment" | "geography" | "product" | "customer";
export type MixItem = { name: string; value: number | null; unit: string | null; share_pct: number | null };
export type MixSnapshot = {
  period: string;
  dimension: MixDimension;
  items: MixItem[];
  citation: Citation | null;
};
export type ShareSeries = {
  market: string;
  points: { period: string; share_pct: number; citation: Citation | null }[];
};
export type BusinessMetrics = {
  symbol: string;
  updated_at: string | null;
  engine: "llm" | "lexical" | null;
  kpis: KpiSeries[];
  revenue_mix: MixSnapshot[];
  market_share: ShareSeries[];
  warnings: string[];
};

// ── Value chain (agent E) ─────────────────────────────────────────────────────

export type ChainRelation = "customer" | "supplier" | "competitor";
export type ChainOrigin = "filings" | "peers" | "curated";
export type ChainNode = {
  name: string;
  symbol: string | null;
  relation: ChainRelation;
  detail: string | null;
  share_pct: number | null;
  origin: ChainOrigin;
  citation: Citation | null;
};
export type RawMaterial = {
  name: string;
  commodity_symbol: string | null;
  price: number | null;
  currency: string | null;
  change_1m_pct: number | null;
  change_1y_pct: number | null;
  cost_share_pct: number | null;
  origin: "filings" | "curated";
  citation: Citation | null;
};
export type ValueChain = {
  symbol: string;
  sector: string | null;
  industry: string | null;
  customers: ChainNode[];
  suppliers: ChainNode[];
  competitors: ChainNode[];
  raw_materials: RawMaterial[];
  updated_at: string | null;
  warnings: string[];
};

// ── Reverse DCF (agent F) ─────────────────────────────────────────────────────

export type ReverseDcfVerdict = "priced_for_perfection" | "demanding" | "reasonable" | "undemanding" | "not_meaningful";
export type ReverseDcfBasis = "fcf" | "net_income";
export type ReverseDcf = {
  symbol: string;
  currency: string | null;
  price: number | null;
  market_cap: number | null;
  net_debt: number | null;
  basis: ReverseDcfBasis;
  base_cash_flow: number | null;
  discount_rate: number;
  terminal_growth: number;
  years: number;
  implied_growth_pct: number | null;
  historical: {
    revenue_cagr_3y: number | null;
    revenue_cagr_5y: number | null;
    profit_cagr_3y: number | null;
    profit_cagr_5y: number | null;
  };
  verdict: ReverseDcfVerdict;
  sensitivity: {
    discount_rates: number[];
    terminal_growths: number[];
    implied_growth_pct: (number | null)[][];
  };
  notes: string[];
};

// ── Results tracker (agent M) ─────────────────────────────────────────────────

export type ResultsQuarter = {
  period: string;
  period_end: string | null;
  revenue: number | null;
  ebitda: number | null;
  net_income: number | null;
  eps: number | null;
  ebitda_margin_pct: number | null;
  net_margin_pct: number | null;
  revenue_yoy_pct: number | null;
  revenue_qoq_pct: number | null;
  profit_yoy_pct: number | null;
  profit_qoq_pct: number | null;
  eps_estimate: number | null;
  eps_surprise_pct: number | null;
};
export type ResultsScorecard = "strong" | "steady" | "weak" | "mixed" | "insufficient_data";
export type ResultsHistory = {
  symbol: string;
  currency: string | null;
  quarters: ResultsQuarter[]; // newest first
  scorecard: { label: ResultsScorecard; reasons: string[] };
  warnings: string[];
};

// ── Peer KPIs (agent L) ────────────────────────────────────────────────────────

export type PeerKpiCell = { value: number | null; unit: string | null; period: string | null; citation: Citation | null };
export type PeerKpiRow = {
  key: string;
  label: string;
  unit: string | null;
  higher_is_better: boolean | null;
  values: Record<string, PeerKpiCell>; // symbol → cell
};
export type PeerKpiTable = {
  symbol: string;
  peers: string[];
  rows: PeerKpiRow[];
  financial_rows: PeerKpiRow[];
  missing: string[];
  warnings: string[];
};

// ── Stock (agent: marketData endpoint) ─────────────────────────────────────────

export type Stock = {
  symbol: string;
  ticker: string;
  company_name?: string | null;
  sector?: string | null;
  industry?: string | null;
  current_price?: number | null;
  market_cap?: number | null;
  currency?: string | null;
  provenance?: { as_of?: string | null } | null;
};

// ── The assembled data set the note is built from ────────────────────────────

export type ResearchNoteData = {
  symbol: string;
  stock: Stock | null;
  analysis: Analysis | null;
  knowledge: Knowledge | null;
  business: BusinessMetrics | null;
  valuation: ReverseDcf | null;
  valueChain: ValueChain | null;
  results: ResultsHistory | null;
  peers: PeerKpiTable | null;
};

// ── Fetchers ──────────────────────────────────────────────────────────────────

const FILINGS_RAG = "/filings-rag"; // api baseURL already adds /api

async function withFallback<T>(fn: () => Promise<T>, message: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new Error(extractApiErrorMessage(error, message));
  }
}

export function fetchStock(symbol: string, market: string): Promise<Stock> {
  return withFallback(
    () => api.get<Stock>(`/stocks/${encodeURIComponent(symbol)}`, { params: { market } }).then((r) => r.data),
    "Price unavailable",
  );
}

export function fetchAnalysis(symbol: string): Promise<Analysis | null> {
  return withFallback(
    async () => {
      const res = await api.get<Analysis>(`${FILINGS_RAG}/${encodeURIComponent(symbol)}/analysis`, {
        validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
      });
      return res.status === 404 ? null : res.data;
    },
    "Analysis unavailable",
  );
}

export function fetchKnowledge(symbol: string): Promise<Knowledge | null> {
  return withFallback(
    async () => {
      const res = await api.get<Knowledge>(`${FILINGS_RAG}/${encodeURIComponent(symbol)}/knowledge`, {
        validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
      });
      return res.status === 404 ? null : res.data;
    },
    "Knowledge unavailable",
  );
}

export function fetchBusinessMetrics(symbol: string): Promise<BusinessMetrics> {
  return withFallback(
    () => api.get<BusinessMetrics>(`/business/${encodeURIComponent(symbol)}/metrics`).then((r) => r.data),
    "Business metrics unavailable",
  );
}

export function fetchReverseDcf(symbol: string): Promise<ReverseDcf> {
  return withFallback(
    () => api.get<ReverseDcf>(`/valuation/${encodeURIComponent(symbol)}/reverse-dcf`).then((r) => r.data),
    "Valuation unavailable",
  );
}

export function fetchValueChain(symbol: string): Promise<ValueChain> {
  return withFallback(
    () => api.get<ValueChain>(`/value-chain/${encodeURIComponent(symbol)}`).then((r) => r.data),
    "Value chain unavailable",
  );
}

export function fetchResults(symbol: string): Promise<ResultsHistory> {
  return withFallback(
    () =>
      api
        .get<ResultsHistory>(`/results/${encodeURIComponent(symbol)}`, { params: { quarters: 8 } })
        .then((r) => r.data),
    "Results unavailable",
  );
}

export function fetchPeerKpis(symbol: string): Promise<PeerKpiTable> {
  return withFallback(
    () => api.get<PeerKpiTable>(`/peer-kpis/${encodeURIComponent(symbol)}`).then((r) => r.data),
    "Peer KPIs unavailable",
  );
}

// ── Gather (parallel, fault-tolerant) ─────────────────────────────────────────

type Settled<T> = PromiseSettledResult<T>;

function isFulfilled<T>(s: Settled<T>): s is PromiseFulfilledResult<T> {
  return s.status === "fulfilled";
}

function take<T>(s: Settled<T>): T | null {
  return isFulfilled(s) ? s.value : null;
}

/**
 * Gather every data set the note needs. Optional sources are requested in
 * parallel; any that fail resolve to null and render as "Not available" in the
 * note rather than throwing.
 */
export function gatherResearchData(symbol: string, market = "NSE"): Promise<ResearchNoteData> {
  const m = market || "NSE";
  return Promise.allSettled([
    fetchStock(symbol, m),
    fetchAnalysis(symbol),
    fetchKnowledge(symbol),
    fetchBusinessMetrics(symbol),
    fetchReverseDcf(symbol),
    fetchValueChain(symbol),
    fetchResults(symbol),
    fetchPeerKpis(symbol),
  ]).then(([sStock, sAnalysis, sKnowledge, sBusiness, sValuation, sChain, sResults, sPeers]) => ({
    symbol,
    stock: take(sStock),
    analysis: take(sAnalysis),
    knowledge: take(sKnowledge),
    business: take(sBusiness),
    valuation: take(sValuation),
    valueChain: take(sChain),
    results: take(sResults),
    peers: take(sPeers),
  }));
}

// ── Formatting helpers ────────────────────────────────────────────────────────

const NA = "—";

function nullish(n: number | null | undefined): string {
  return n == null || Number.isNaN(n) ? NA : Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function pct(n: number | null | undefined): string {
  return n == null || Number.isNaN(n) ? NA : `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

// Reverse-DCF rates and historical CAGRs are fractions (0.10 = 10%); implied_growth_pct is already percent.
function pctFrac(n: number | null | undefined): string {
  return n == null || Number.isNaN(n) ? NA : pct(n * 100);
}

function esc(value: unknown): string {
  const str = value == null ? "" : String(value);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function currency(symbol: string): string {
  const base = symbol.toUpperCase();
  return base.endsWith("IN") || ["NSE", "BSE"].includes(symbol.toUpperCase()) ? "₹" : "$";
}

// ── Citation labelling ────────────────────────────────────────────────────────

function citationPages(citation: Citation): string {
  const start = citation.page_start;
  const end = citation.page_end;
  if (start == null && end == null) return "";
  if (start == null || end == null) return `p.${start ?? end}`;
  return start === end ? `p.${start}` : `p.${start}–${end}`;
}

/** Markdown label ending each citation bullet, e.g. "[Annual Report FY24, p.12–13]". */
export function citationLabel(citation: Citation | null | undefined): string {
  if (!citation) return "";
  const page = citationPages(citation);
  const title = esc(citation.title);
  return page ? `[${title}, ${page}]` : `[${title}]`;
}

// ── Note building ─────────────────────────────────────────────────────────────

/** Strongest finding first, for a single driver. */
function strongFindings(driver: DriverResult): Finding[] {
  return [...driver.findings].sort((a, b) => b.confidence - a.confidence);
}

/** Build top-N citation bullets for a list of drivers. */
function driverBullets(drivers: DriverResult[] | undefined, limit = 3): string[] {
  if (!drivers || !drivers.length) return [];
  return drivers
    .sort((a, b) => b.strength - a.strength)
    .slice(0, limit)
    .map((driver) => {
      const findings = strongFindings(driver);
      const finding = findings[0];
      const text = (finding?.claim || driver.summary).trim();
      return `- **${esc(driver.label)}** — ${esc(text)} ${citationLabel(finding?.citation)}`.replace(/\s+/g, " ").trim();
    });
}

function header(data: ResearchNoteData): string {
  const stock = data.stock;
  const name = stock?.company_name ? ` — ${esc(stock.company_name)}` : "";
  const lines = [`# Research note — ${esc(data.symbol)}${name}`, ""];

  const cur = currency(data.symbol);
  const price = stock?.current_price != null ? `$${nullish(stock.current_price)}` : NA;
  const cap = stock?.market_cap != null ? `$${nullish(stock.market_cap)}` : NA;
  const asOf = stock?.provenance?.as_of || data.analysis?.created_at || NA;
  lines.push(`**Price:** ${price}${cur === "$" ? "" : " "}${cur}  ·  **Market cap:** ${cap}${cur === "$" ? "" : " "}${cur}  ·  **As of:** ${esc(asOf)}`, "");

  const provenance: string[] = [];
  if (data.analysis) provenance.push("filings analysis");
  if (data.knowledge) provenance.push("concall summaries");
  if (data.business) provenance.push("business KPIs");
  if (data.valuation) provenance.push("valuation");
  if (data.valueChain) provenance.push("value chain");
  if (data.results) provenance.push("quarterly results");
  if (data.peers) provenance.push("peer comparison");
  if (stock) provenance.unshift("exchange quote");
  lines.push(`**Data provenance:** ${provenance.length ? provenance.join(", ") : NA}`, "---", "");

  return lines.join("\n");
}

function investmentSummary(data: ResearchNoteData): string {
  if (!data.analysis) return "## Investment summary\n\n- Not available";
  const { scores, stance } = data.analysis;
  const lines = [
    "## Investment summary",
    "",
    `**Stance:** ${esc(stance)}  ·  **Net score:** ${scores.net >= 0 ? "+" : ""}${nullish(scores.net)}`,
    `**Growth score:** ${nullish(scores.growth)}/100  ·  **Headwind score:** ${nullish(scores.headwind)}/100`,
    "",
  ];

  const growth = driverBullets(data.analysis.growth);
  const headwinds = driverBullets(data.analysis.headwinds);
  lines.push("**Top growth engines:**");
  if (growth.length) lines.push(...growth);
  else lines.push("- Not available");
  lines.push("", "**Top headwinds:**");
  if (headwinds.length) lines.push(...headwinds);
  else lines.push("- Not available");

  return lines.join("\n");
}

function businessSection(data: ResearchNoteData): string {
  if (!data.business) return "## Business\n\n- Not available";
  const b = data.business;
  const lines = ["## Business", ""];

  lines.push("**Key performance indicators:**");
  if (b.kpis.length) {
    for (const series of b.kpis) {
      const latest = series.points[series.points.length - 1];
      const value = latest ? `${nullish(latest.value)} ${series.unit ? `(${series.unit})` : ""}`.trim() : NA;
      const period = latest?.period ? ` as of ${esc(latest.period)}` : "";
      lines.push(`- **${esc(series.label)}** — ${esc(value)}${period} ${citationLabel(latest?.citation)}`);
    }
  } else {
    lines.push("- Not available");
  }
  lines.push("", "**Revenue mix:**");
  if (b.revenue_mix.length) {
    const latest = b.revenue_mix[b.revenue_mix.length - 1];
    const asOf = latest.period ? ` as of ${esc(latest.period)}` : "";
    if (latest.items.length) {
      const parts = latest.items
        .map((item) => `${esc(item.name)} ${item.share_pct != null ? `${pct(item.share_pct)}` : NA}`)
        .join(", ");
      lines.push(`- ${parts}${asOf}`);
    } else {
      lines.push("- Not available");
    }
  } else {
    lines.push("- Not available");
  }

  return lines.join("\n");
}

function resultsSection(data: ResearchNoteData): string {
  if (!data.results) return "## Results — last 4 quarters\n\n- Not available";
  const quarters = data.results.quarters.slice(0, 4);
  const lines = ["## Results — last 4 quarters", ""];
  lines.push("| Quarter | Period end | Revenue | EPS | Rev YoY | Profit YoY |");
  lines.push("|---|---|---|---|---|---|");
  if (quarters.length) {
    for (const q of quarters) {
      lines.push(
        `| ${esc(q.period)} | ${esc(q.period_end || NA)} | ${nullish(q.revenue)} | ${nullish(q.eps)} | ${pct(q.revenue_yoy_pct)} | ${pct(q.profit_yoy_pct)} |`,
      );
    }
  } else {
    lines.push("| — | — | — | — | — | — |");
  }
  return lines.join("\n");
}

function valuationSection(data: ResearchNoteData): string {
  const v = data.valuation;
  if (!v) return "## Valuation\n\n- Not available";
  const lines = [
    "## Valuation",
    "",
    `**Reverse DCF:** implied growth ${pct(v.implied_growth_pct)}/yr over next ${nullish(v.years)} yr` +
      ` ·  discount ${pctFrac(v.discount_rate)} · terminal growth ${pctFrac(v.terminal_growth)}`,
    "",
    `**Historical revenue CAGR:** 3y ${pctFrac(v.historical.revenue_cagr_3y)} · 5y ${pctFrac(v.historical.revenue_cagr_5y)}`,
    `**Historical profit CAGR:** 3y ${pctFrac(v.historical.profit_cagr_3y)} · 5y ${pctFrac(v.historical.profit_cagr_5y)}`,
    "",
    `**Verdict:** ${esc(v.verdict)}`,
  ];
  if (v.notes.length) {
    lines.push("", "**Notes:**");
    for (const note of v.notes) lines.push(`- ${esc(note)}`);
  }
  return lines.join("\n");
}

function guidanceSection(data: ResearchNoteData): string {
  const knowledge = data.knowledge;
  if (!knowledge || !knowledge.guidance.length) return "## Management guidance\n\n- Not available";
  const guidance = knowledge.guidance;
  const lines = ["## Management guidance", ""];
  lines.push("| Metric | Statement | Target | Status | Source |");
  lines.push("|---|---|---|---|---|");
  for (const item of guidance) {
    lines.push(
      `| ${esc(item.metric)} | ${esc(item.statement)} | ${esc(item.target || NA)} | ${esc(item.status)} | ${citationLabel(item.citation)} |`,
    );
  }
  return lines.join("\n");
}

function valueChainSection(data: ResearchNoteData): string {
  const vc = data.valueChain;
  if (!vc) return "## Value chain\n\n- Not available";
  const lines = ["## Value chain", ""];
  const groups: { title: string; nodes: ChainNode[] }[] = [
    { title: "Customers", nodes: vc.customers },
    { title: "Suppliers", nodes: vc.suppliers },
    { title: "Competitors", nodes: vc.competitors },
  ];
  for (const group of groups) {
    lines.push(`**${esc(group.title)}:**`);
    if (group.nodes.length) {
      for (const node of group.nodes) {
        const rel = node.detail ? ` — ${esc(node.detail)}` : "";
        lines.push(`- **${esc(node.name)}**${rel} ${citationLabel(node.citation)}`);
      }
    } else {
      lines.push("- Not available");
    }
  }
  if (vc.raw_materials.length) {
    lines.push("", "**Raw materials:**");
    for (const material of vc.raw_materials) {
      const price = `${material.currency ? material.currency : ""}${material.price != null ? nullish(material.price) : NA}`.trim();
      lines.push(`- **${esc(material.name)}** — price ${price} ${citationLabel(material.citation)}`);
    }
  }
  return lines.join("\n");
}

function sourcesSection(data: ResearchNoteData): string {
  const citations = collectCitations(data);
  const lines = ["## Sources", ""];
  if (!citations.length) {
    lines.push("- None cited");
    return lines.join("\n");
  }
  citations.forEach((citation, index) => {
    const pages = citationPages(citation);
    const source = citation.source_url ? ` · [view source](${escapeAttr(citation.source_url)})` : "";
    lines.push(`${index + 1}. **${esc(citation.title)}**${pages ? ` (${pages})` : ""}${source}`);
  });
  return lines.join("\n");
}

function disclaimer(): string {
  return "---\n\n*Generated from company filings; not investment advice.*";
}

function collectCitations(data: ResearchNoteData): Citation[] {
  const seen = new Map<string, Citation>();
  const add = (citation: Citation | null | undefined) => {
    if (!citation) return;
    const key = `${citation.title}|${citation.page_start}|${citation.page_end}`;
    if (!seen.has(key)) seen.set(key, citation);
  };

  if (data.analysis) {
    for (const driver of [...data.analysis.growth, ...data.analysis.headwinds]) {
      for (const finding of driver.findings) add(finding.citation);
    }
  }
  if (data.knowledge) {
    for (const concall of data.knowledge.concalls) {
      for (const citation of concall.citations) add(citation);
    }
    for (const item of data.knowledge.guidance) add(item.citation);
  }
  if (data.business) {
    for (const series of data.business.kpis) {
      for (const point of series.points) add(point.citation);
    }
    for (const snapshot of data.business.revenue_mix) add(snapshot.citation);
    for (const share of data.business.market_share) {
      for (const point of share.points) add(point.citation);
    }
  }
  if (data.valueChain) {
    for (const node of [...data.valueChain.customers, ...data.valueChain.suppliers, ...data.valueChain.competitors]) add(node.citation);
    for (const material of data.valueChain.raw_materials) add(material.citation);
  }
  if (data.peers) {
    for (const row of [...data.peers.rows, ...data.peers.financial_rows]) {
      for (const cell of Object.values(row.values)) add(cell.citation);
    }
  }

  return [...seen.values()];
}

/** Pure function: turn gathered data into a cited Markdown research note. */
export function buildResearchNote(data: ResearchNoteData): string {
  const sections = [
    header(data),
    investmentSummary(data),
    businessSection(data),
    resultsSection(data),
    valuationSection(data),
    guidanceSection(data),
    valueChainSection(data),
    sourcesSection(data),
    disclaimer(),
  ];
  return sections.filter((s) => s.length > 0).join("\n\n") + "\n";
}

// ── Markdown → print-ready HTML ───────────────────────────────────────────────

/** Escape a value for use inside an HTML attribute. */
function escapeAttr(value: unknown): string {
  const str = value == null ? "" : String(value);
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Inline conversions (bold + links) for already-escaped markdown text. */
function inline(md: string): string {
  let out = md.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, label, url) => `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  out = out.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  return out;
}

/**
 * Convert a note's Markdown to HTML for the print window. The note text is
 * already HTML-escaped by buildResearchNote, so this only converts block and
 * inline Markdown syntax (headings, lists, tables, hr, blockquote, bold, links).
 */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Table: consume a run of rows separated by blank lines.
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|");
        rows.push(cells.map((c) => c.trim()));
        i++;
      }
      blocks.push(renderTable(rows));
      continue;
    }

    // Unordered list.
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      blocks.push(`<ul>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</ul>`);
      continue;
    }

    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(`<ol>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</ol>`);
      continue;
    }

    // Heading.
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^(-{3,}|\*{3,})\s*$/.test(line.trim())) {
      blocks.push("<hr/>");
      i++;
      continue;
    }

    // Blockquote.
    if (/^>\s?/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        items.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(`<blockquote>${items.map((it) => `<p>${inline(it)}</p>`).join("")}</blockquote>`);
      continue;
    }

    // Paragraph (single line is sufficient; the note emits one line per paragraph).
    blocks.push(`<p>${inline(line)}</p>`);
    i++;
  }

  return blocks.join("\n");
}

function renderTable(rows: string[][]): string {
  if (!rows.length) return "";
  const isSep = (row: string[]) => row.every((cell) => /^[-:]+$/.test(cell.trim()));
  const head = rows[0];
  const body = rows.slice(1).filter((row) => !isSep(row));
  return `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map(
    (row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`,
  ).join("")}</tbody></table>`;
}

const PRINT_STYLES = `
  * { box-sizing: border-box; }
  body { margin: 0; color: #1a1a1a; background: #fff; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .print-note { max-width: 820px; margin: 0 auto; padding: 24px 32px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  h2 { font-size: 16px; margin: 24px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e5e5e5; }
  h3 { font-size: 14px; margin: 16px 0 6px; }
  p { margin: 6px 0; }
  ul, ol { margin: 6px 0; padding-left: 22px; }
  li { margin: 3px 0; }
  a { color: #0b5ab8; text-decoration: none; }
  blockquote { margin: 8px 0; padding: 4px 12px; border-left: 3px solid #e5e5e5; color: #555; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 12px; }
  th, td { border: 1px solid #ddd; padding: 5px 8px; text-align: left; }
  thead th { background: #f4f4f4; }
  hr { border: none; border-top: 1px solid #e5e5e5; margin: 20px 0; }
  em { color: #555; }
  @media print { .no-print { display: none; } body { print-color-adjust: exact; } }
`;

/** Print-ready HTML document. Accepts either the note Markdown or raw data. */
export function toPrintHtml(source: string | ResearchNoteData): string {
  const markdown = typeof source === "string" ? source : buildResearchNote(source);
  const body = markdownToHtml(markdown);
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">
<title>Research note</title>
<style>${PRINT_STYLES}</style>
</head><body>
<div class="print-note">${body}</div>
</body></html>`;
}

// ── Export actions (used by the button component) ─────────────────────────────

export function researchNoteFilename(symbol: string): string {
  return `${symbol.replace(/[^\w]+/g, "_").toLowerCase()}-research-note.md`;
}

export function downloadMarkdown(symbol: string, data: ResearchNoteData): void {
  const text = buildResearchNote(data);
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = researchNoteFilename(symbol);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function openPrintWindow(source: string | ResearchNoteData): void {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(toPrintHtml(source));
  win.document.close();
  setTimeout(() => {
    try {
      win.print();
    } catch {
      /* print not available — window stays open */
    }
  }, 250);
}