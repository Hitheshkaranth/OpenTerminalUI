# Filings Intelligence — RAG over company reports

Turns primary documents (annual reports, 10-K/10-Q/8-K, concall transcripts, investor
presentations, order-win / USFDA announcements) into a cited view of a company's
**growth engines** and **headwinds**. Every finding carries a verbatim quote that is
verified against the stored source text, plus document + page, so nothing is asserted
without evidence.

## Pipeline

```
 import ──► parse ──► chunk ──► index ──► retrieve per driver ──► extract ──► verify ──► score
 upload     pypdf     ~1.2k     TF-IDF    driver query bank       LLM (JSON)   quote must    growth vs
 SEC/NSE    bs4       chars,    1-2gram   + keyword boost         or lexical   appear in     headwind
 URL        text      pages     per sym   top-k chunks            fallback     the chunk     scorecard
```

1. **Import** (`backend/filings_rag/sources.py`)
   - Upload: PDF / HTML / TXT (multipart).
   - SEC EDGAR (US): latest 10-K, 10-Qs and earnings 8-Ks via `data.sec.gov` submissions.
   - NSE (India): annual reports (`/api/annual-reports`) and announcement attachments filtered
     to concall transcripts, investor presentations, results, order wins and USFDA updates.
   - De-duplicated by SHA-256 of extracted text per symbol.
2. **Parse + chunk** (`parse.py`): page-aware extraction, whitespace/boilerplate cleanup,
   paragraph-packed chunks (~1,200 chars, 1-paragraph overlap) that keep `page_start/page_end`
   and the nearest section heading (MD&A, Risk Factors, Directors' Report…).
3. **Index + retrieve** (`retrieve.py`): per-symbol TF-IDF (unigram+bigram, sublinear tf)
   with a regex keyword boost per driver. Pluggable: a dense-embedding retriever can be added
   behind the same interface without schema changes.
4. **Extract** (`analyze.py`): for each driver in the taxonomy, the top-k chunks go to the
   configured LLM (`backend.services.llm`) with a strict JSON schema. Without an LLM, a
   lexical extractor pulls matching sentences and numbers (lower confidence, flagged).
5. **Verify**: a finding survives only if its `quote` is found (whitespace/case-normalised,
   ≥ 85% token overlap) in the cited chunk. Unverified LLM output is dropped.
6. **Score**: growth score and headwind score (0–100) from finding magnitude × confidence,
   per-driver summaries, and a net stance.

## Driver taxonomy (`taxonomy.py`)

Growth engines: order book / backlog, new client wins, capacity expansion & capex,
new products & launches, regulatory approvals (FDA / ANDA / EIR / CE), market & geographic
expansion, pricing power & margin expansion, guidance raise, strategic deals (M&A /
partnerships / licensing), operating leverage & efficiency.

Headwinds: client / revenue concentration, order slowdown or cancellations, adverse
regulatory action (warning letter / Form 483 / import alert / OAI), margin pressure
(input costs, wages, pricing), working-capital stress (receivable / inventory days),
leverage & refinancing, governance (related-party, pledges, auditor remarks, KMP exits),
litigation & contingent liabilities, guidance cut / demand weakness, competition & price
erosion, FX / geopolitical / supply-chain exposure.

## API contract (`/api/filings-rag`)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/{symbol}/documents` | – | `{symbol, documents: Document[]}` |
| POST | `/{symbol}/documents/upload` | multipart `file`, form `doc_type?`, `title?`, `period?` | `Document` |
| POST | `/{symbol}/documents/fetch` | `{sources?: ("sec"\|"nse")[], limit?: int}` | `{symbol, imported: Document[], skipped: {title, reason}[]}` |
| DELETE | `/{symbol}/documents/{doc_id}` | – | `{deleted: true}` |
| POST | `/{symbol}/analyze` | `{use_llm?: bool, drivers?: string[]}` | `Analysis` |
| GET | `/{symbol}/analysis` | – | `Analysis` or 404 |
| POST | `/{symbol}/ask` | `{question: string, k?: int}` | `{answer, engine, citations: Citation[]}` |
| GET | `/taxonomy` | – | `{growth: Driver[], headwind: Driver[]}` |

```ts
type Document = {
  id: number; symbol: string; doc_type: "annual_report"|"quarterly_filing"|"concall_transcript"
    |"investor_presentation"|"press_release"|"regulatory"|"other";
  title: string; period: string|null; source: "upload"|"sec"|"nse"|"url"; source_url: string|null;
  filed_at: string|null; pages: number; chunks: number; chars: number; created_at: string;
};
type Citation = { doc_id: number; title: string; page_start: number; page_end: number;
  section: string|null; quote: string; source_url: string|null };
type Finding = { claim: string; metric: string|null; value: number|null; unit: string|null;
  period: string|null; magnitude: "high"|"medium"|"low"; confidence: number /*0..1*/;
  citation: Citation };
type DriverResult = { id: string; label: string; kind: "growth"|"headwind";
  summary: string; strength: number /*0..100*/; findings: Finding[] };
type Analysis = { symbol: string; created_at: string; engine: "llm"|"lexical";
  model: string|null; documents_used: number;
  scores: { growth: number; headwind: number; net: number /* growth-headwind */ };
  stance: "constructive"|"balanced"|"cautious"|"insufficient_evidence";
  growth: DriverResult[]; headwinds: DriverResult[];  // only drivers with findings, strongest first
  coverage: { driver_id: string; chunks_searched: number }[]; warnings: string[] };
type Driver = { id: string; label: string; kind: "growth"|"headwind"; description: string };
```

## How this compares to professional terminals

| Capability | Bloomberg | FactSet / CapIQ / AlphaSense | Screener.in / Tijori (IN) | OpenTerminalUI before | With Filings Intelligence |
|---|---|---|---|---|---|
| Filing & transcript search | `CF`, `DS`, `BI` | AlphaSense smart search | Concall links | headline-only NSE/SEC fetch | full-text, cited, per company |
| Growth-driver extraction | BI analyst notes (human) | AlphaSense Smart Summaries | manual notes | keyword sentiment | per-driver LLM extraction + verification |
| Order book / backlog tracking | via BI / company KPIs | KPI datasets | some | none | extracted with value/unit/period |
| Regulatory (FDA 483/WL/OAI) | `NI` news + BI | AlphaSense / news | announcements | none | dedicated growth + headwind drivers |
| Governance red flags | ESG / BI | partial | pledge data | partial (insider tab) | related-party, pledges, auditor, KMP exits |
| Evidence traceability | document links | snippets | – | – | verbatim quote + doc + page, verified |
| Self-hosted / local LLM | – | – | – | – | yes (OpenRouter / LM Studio / lexical) |

Gaps that remain versus Bloomberg/FactSet: licensed consensus estimates depth, segment and
KPI time-series databases, supply-chain graph (`SPLC`), transcript coverage beyond what
companies file publicly, and human analyst research.
