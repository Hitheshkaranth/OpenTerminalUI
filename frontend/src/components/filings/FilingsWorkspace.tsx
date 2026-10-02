// OWNER: agent H (swarm fi_v1). Placeholder wired into SecurityHub; replace the body, keep the export + props.
import { useEffect, FormEvent, useState } from "react";
import { Plus, RefreshCw, Trash2, Upload, X } from "lucide-react";

import {
askFilings,
  buildAnalysis,
  deleteDocument,
  fetchAnalysis,
  fetchAutoImport,
  fetchDocuments,
  uploadDocument,
  type Analysis,
  type Citation,
  type DocSource,
  type Document,
  type DriverResult,
  type Finding,
  type ImportResult,
} from "../../api/filingsRag";

export type Props = {
  symbol: string;
  market?: string;
};
import { DenseTable } from "../terminal/DenseTable";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalBadge } from "../terminal/TerminalBadge";
import { TerminalSelect } from "../terminal/TerminalSelect";
import { TerminalInput } from "../terminal/TerminalInput";
import { AiThinking } from "../ai/AiVisuals";
import { GuidedEmptyState } from "../dashboard/GuidedEmptyState";
import {
  formatCitationLabel,
  formatDate,
  docSourceLabel,
  formatDriverValue,
  formatPeriod,
  stanceLabel,
  stanceVariant,
  strengthPct,
} from "./presentation";

const FILE_ACCEPT = ".pdf,.html,.htm,.txt";

const DOC_TYPES: { value: string; label: string }[] = [
  { value: "annual_report", label: "Annual report" },
  { value: "quarterly_filing", label: "Quarterly filing" },
  { value: "concall_transcript", label: "Concall transcript" },
  { value: "investor_presentation", label: "Investor presentation" },
  { value: "press_release", label: "Press release" },
  { value: "regulatory", label: "Regulatory" },
  { value: "other", label: "Other" },
];

type DocRow = {
  id: number;
  title: string;
  type: string;
  period: string;
  source: DocSource;
  pages: number;
  chunks: number;
  filed: string;
};

function toDocRow(doc: Document): DocRow {
  return {
    id: doc.id,
    title: doc.title,
    type: doc.doc_type,
    period: doc.period || "",
    source: doc.source,
    pages: doc.pages,
    chunks: doc.chunks,
    filed: doc.created_at,
  };
}

function Magnitude({ magnitude }: { magnitude: Finding["magnitude"] }) {
  const variant: "success" | "neutral" | "danger" =
    magnitude === "high" ? "success" : magnitude === "low" ? "danger" : "neutral";
  return (
    <TerminalBadge variant={variant} size="sm">
      {String(magnitude ?? "unknown").toUpperCase()}
    </TerminalBadge>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const cite = finding.citation;
  const cited = formatCitationLabel(cite);
  return (
    <li className="space-y-1">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-terminal-text">{finding.claim || "—"}</span>
        <Magnitude magnitude={finding.magnitude} />
      </div>
      {formatDriverValue(finding) !== "—" ? (
        <div className="text-[11px] text-terminal-accent">{formatDriverValue(finding)}</div>
      ) : null}
      <div className="text-[11px] text-terminal-muted">
        confidence {Math.round(Math.max(0, Math.min(1, finding.confidence)) * 100)}%
      </div>
      <blockquote className="border-l-2 border-terminal-accent/60 pl-2 text-[11px] italic text-terminal-text">
        {cite?.source_url ? (
          <a
            href={/^[a-z]+:\/\//i.test(cite.source_url) ? cite.source_url : undefined}
            target="_blank"
            rel="noreferrer"
            className="hover:text-terminal-accent"
          >
            {cited}
          </a>
        ) : (
          cited
        )}
      </blockquote>
    </li>
  );
}

function DriverCard({ driver }: { driver: DriverResult }) {
  return (
    <div className="rounded-sm border border-terminal-border bg-terminal-panel/70 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-terminal-text">{driver.label || "—"}</span>
        <span className="flex items-center gap-1">
          {driver.engine === "lexical" ? (
            <span title="AI analysis failed for this driver; these are keyword matches, not scored">
              <TerminalBadge variant="warn" size="sm">keyword match</TerminalBadge>
            </span>
          ) : null}
          <span className="ot-type-data text-xs text-terminal-muted">{driver.strength ?? 0}</span>
        </span>
      </div>
      <div className="mb-2 overflow-hidden rounded-full bg-terminal-panel">
        <div className="h-1.5 rounded-full bg-terminal-accent/70" style={{ width: `${strengthPct(driver.strength)}%` }} />
      </div>
      <p className="mb-2 text-xs text-terminal-text">{driver.summary || "—"}</p>
      {driver.findings?.length ? (
        <ul className="space-y-2">
          {driver.findings.map((finding, i) => (
            <FindingCard key={`f-${driver.id}-${i}`} finding={finding} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-terminal-muted">No verified findings.</p>
      )}
    </div>
  );
}

type AskResult = {
  answer: string;
  engine: "llm" | "lexical";
  citations: Citation[];
};

export function FilingsWorkspace({ symbol }: Props) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [useLlm, setUseLlm] = useState(true);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [uploading, setUpload] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState(DOC_TYPES[0].value);
  const [period, setPeriod] = useState("");

  useEffect(() => {
    if (!symbol) return;
    let active = true;
    Promise.all([
      fetchDocuments(symbol).catch(() => null),
      fetchAnalysis(symbol).catch(() => null),
    ]).then(([docs, existing]) => {
      if (!active) return;
      if (docs) setDocuments(docs.documents ?? []);
      if (existing) setAnalysis(existing);
      setAskResult(null);
    });
    return () => {
      active = false;
    };
  }, [symbol]);

  const handleDelete = async (doc: DocRow) => {
    try {
      await deleteDocument(symbol, doc.id);
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleImport = async () => {
    try {
      const result = await fetchAutoImport(symbol, ["sec", "nse"], 6);
      setImportResult(result);
      setDocuments((prev) => [...result.imported, ...prev]);
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      if (input) input.value = "";
      setFile(null);
    } catch (err) {
      setImportResult(null);
      setUploadError(err instanceof Error ? err.message : "Auto-import failed");
    }
  };

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) return;
    setUpload(true);
    setUploadError(null);
    try {
      const uploaded = await uploadDocument(symbol, file, { doc_type: docType, period });
      setDocuments((prev) => [uploaded, ...prev]);
      setFile(null);
      setPeriod("");
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      if (input) input.value = "";
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUpload(false);
    }
  };

  const handleAnalyze = async () => {
    if (!symbol) return;
    setAnalyzeError(null);
    setAnalyzeLoading(true);
    try {
      const result = await buildAnalysis(symbol, { use_llm: useLlm });
      setAnalysis(result);
      setAskResult(null);
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzeLoading(false);
    }
  };

  const handleAsk = async () => {
    if (!symbol || !question.trim()) return;
    setAsking(true);
    try {
      const result = await askFilings(symbol, question.trim());
      setAskResult(result);
    } catch (err) {
      setAskResult(null);
    } finally {
      setAsking(false);
    }
  };

  const isEmpty = documents.length === 0;
  const scores = analysis?.scores;

  return (
    <div className="grid gap-2">
      <TerminalPanel
        title="Documents"
        subtitle={`${documents.length} document${documents.length === 1 ? "" : "s"} indexed`}
        actions={
          <TerminalButton size="sm" leftIcon={<RefreshCw size={13} />} onClick={handleImport}>
            Auto-import from SEC/NSE
          </TerminalButton>
        }
      >
        {importResult ? <ImportSummary result={importResult} /> : null}

        {documents.length ? (
          <DenseTable
            id={`filings-docs-${symbol}`}
            rows={documents.map(toDocRow)}
            columns={[
              {
                key: "title",
                title: "Title",
                type: "text",
                frozen: true,
                width: 300,
                sortable: true,
                getValue: (r) => r.title,
                render: (r) => <span className="min-w-0 truncate" title={r.title}>{r.title || "—"}</span>,
              },
              {
                key: "type",
                title: "Type",
                type: "text",
                width: 150,
                getValue: (r) => r.type,
                render: (r) => (
                  <span className="rounded-full bg-terminal-accent/10 px-2 py-0.5 text-[10px] uppercase text-terminal-accent">
                    {r.type || "other"}
                  </span>
                ),
              },
              {
                key: "period",
                title: "Period",
                type: "text",
                width: 110,
                sortable: true,
                getValue: (r) => r.period,
                render: (r) => <span className="min-w-0 truncate">{formatPeriod(r.period) || "—"}</span>,
              },
              {
                key: "source",
                title: "Source",
                type: "text",
                width: 90,
                getValue: (r) => r.source,
                render: (r) => <span className="min-w-0 truncate">{docSourceLabel(r.source) || "—"}</span>,
              },
              {
                key: "pages",
                title: "Pages",
                type: "number",
                align: "right",
                width: 70,
                sortable: true,
                getValue: (r) => r.pages,
              },
              {
                key: "chunks",
                title: "Chunks",
                type: "number",
                align: "right",
                width: 70,
                sortable: true,
                getValue: (r) => r.chunks,
              },
              {
                key: "filed",
                title: "Filed",
                type: "text",
                width: 110,
                sortable: true,
                getValue: (r) => r.filed,
                render: (r) => <span className="min-w-0 truncate">{formatDate(r.filed) || "—"}</span>,
              },
              {
                key: "actions",
                title: "",
                width: 44,
                render: (r) => (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(r);
                    }}
                    className="p-0.5 text-terminal-muted hover:text-terminal-neg"
                    title="Delete document"
                    aria-label={`Delete ${r.title}`}
                  >
                    <Trash2 size={14} />
                  </button>
                ),
              },
            ]}
            rowKey={(row) => String(row.id)}
            height={280}
          />
        ) : (
          <GuidedEmptyState
            title="No documents indexed"
            message="Import filings to get started. Drop in an annual report, earnings call transcript, 10-Q/8-K or investor presentation, or auto-import from SEC / NSE."
            icon={<Upload size={16} />}
          />
        )}
      </TerminalPanel>

      <TerminalPanel title="Import" subtitle="Upload a file to index">
        {uploadError ? (
          <div className="mb-2 rounded-sm border border-terminal-neg/40 bg-terminal-neg/10 px-2 py-1.5 text-[11px] text-terminal-neg">{uploadError}</div>
        ) : null}
        <form onSubmit={handleUpload} className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="ot-type-label text-[10px] uppercase text-terminal-muted">File (PDF / HTML / TXT)</span>
            <input
              type="file"
              accept={FILE_ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full rounded-sm border border-terminal-border bg-terminal-bg p-1.5 text-[11px] text-terminal-text"
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="ot-type-label text-[10px] uppercase text-terminal-muted">Document type</span>
            <TerminalSelect value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOC_TYPES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </TerminalSelect>
          </div>
          <div className="flex flex-col gap-1">
            <span className="ot-type-label text-[10px] uppercase text-terminal-muted">Period</span>
            <TerminalInput
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="e.g. FY25"
            />
          </div>
          <TerminalButton type="submit" disabled={!file || uploading} loading={uploading}>
            <Upload size={13} />
            Upload
          </TerminalButton>
        </form>
      </TerminalPanel>

      <TerminalPanel title="Analysis" subtitle="Growth & headwind drivers">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <TerminalButton
            disabled={isEmpty || analyzeLoading}
            loading={analyzeLoading}
            onClick={handleAnalyze}
          >
            <Plus size={13} />
            Analyze
          </TerminalButton>
          {analyzeLoading ? (
            <AiThinking activity="analyzing" label="Scoring growth engines and headwinds; this can take 1–2 minutes." />
          ) : null}
          <button
            type="button"
            onClick={() => setUseLlm((u) => !u)}
            className={`rounded-sm border px-2 py-0.5 text-[11px] uppercase tracking-wide ${
              useLlm
                ? "border-terminal-accent bg-terminal-accent/20 text-terminal-accent"
                : "border-terminal-border text-terminal-muted"
            }`}
            aria-pressed={useLlm}
          >
            Use AI model: {useLlm ? "On" : "Off"}
          </button>
        </div>

        {analyzeError ? (
          <div className="mb-3 rounded-sm border border-terminal-neg/40 bg-terminal-neg/10 px-2 py-1.5 text-[11px] text-terminal-neg">{analyzeError}</div>
        ) : null}

        {isEmpty ? (
          <GuidedEmptyState
            title="Nothing to analyze yet"
            message="Import at least one document before running an analysis."
            icon={<Upload size={16} />}
          />
        ) : !analysis ? (
          <p className="text-xs text-terminal-muted">Run an analysis to see cited growth engines and headwinds.</p>
        ) : (
          <>
            <Scorecard analysis={analysis} />
            <div className="grid gap-2 lg:grid-cols-2">
              <DriverColumn label="Growth engines" drivers={analysis.growth} />
              <DriverColumn label="Headwinds" drivers={analysis.headwinds} />
            </div>
            <AskBox symbol={symbol} result={askResult} asking={asking} question={question} setQuestion={setQuestion} onAsk={handleAsk} />
          </>
        )}
      </TerminalPanel>
    </div>
  );
}

function ImportSummary({ result }: { result: ImportResult }) {
  return (
    <div className="mb-3 grid grid-cols-1 gap-2 rounded-sm border border-terminal-border bg-terminal-bg/60 p-2 sm:grid-cols-2">
      <div className="flex items-center gap-2 text-xs text-terminal-pos">
        <RefreshCw size={13} />
        <span>Imported {result.imported?.length ?? 0} document{result.imported?.length === 1 ? "" : "s"}.</span>
      </div>
      <div className="flex items-start gap-2 text-xs text-terminal-warn">
        <X size={13} className="mt-0.5" />
        <span>
          Skipped {result.skipped?.length ?? 0}
          {result.skipped?.length ? (
            <>
              : <span className="text-terminal-muted">{result.skipped.slice(0, 3).map((s) => s.reason).join(" · ")}</span>
            </>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function Scorecard({ analysis }: { analysis: Analysis }) {
  const stance = analysis.stance ?? "balanced";
  const scores = analysis.scores;
  return (
    <div className="mb-3 rounded-sm border border-terminal-border bg-terminal-panel/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="ot-type-label text-terminal-muted">Net stance</span>
          <TerminalBadge variant={stanceVariant(stance)} dot>
            {stanceLabel(stance)}
          </TerminalBadge>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <span className="text-terminal-muted">engine: {analysis.engine}</span>
          <span className="text-terminal-muted">
            model: {analysis.model || "—"}
          </span>
          <span className="text-terminal-muted">documents: {analysis.documents_used}</span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
        <div className="flex items-end gap-1">
          <span className="text-terminal-muted">Growth</span>
          <span className="ot-type-data text-lg text-terminal-pos">{scores?.growth ?? 0}</span>
        </div>
        <div className="text-terminal-border">/</div>
        <div className="flex items-end gap-1">
          <span className="text-terminal-muted">Headwind</span>
          <span className="ot-type-data text-lg text-terminal-neg">{scores?.headwind ?? 0}</span>
        </div>
        <div className="text-terminal-border">/</div>
        <div className="flex items-end gap-1">
          <span className="text-terminal-muted">Net</span>
          <span className="ot-type-data text-lg text-terminal-text">{scores?.net ?? 0}</span>
        </div>
      </div>
      {analysis.warnings?.length ? (
        <div className="mt-2 text-[11px] text-terminal-warn">{analysis.warnings.join(" · ")}</div>
      ) : null}
    </div>
  );
}

function DriverColumn({ label, drivers }: { label: string; drivers: DriverResult[] }) {
  return (
    <div>
      <div className="mb-1.5 ot-type-label text-[10px] uppercase text-terminal-muted">{label}</div>
      <div className="space-y-2">
        {drivers?.length ? (
          drivers.map((driver) => <DriverCard key={driver.id} driver={driver} />)
        ) : (
          <p className="text-xs text-terminal-muted">No drivers for {label.toLowerCase()}.</p>
        )}
      </div>
    </div>
  );
}

function AskBox({
  symbol,
  result,
  asking,
  question,
  setQuestion,
  onAsk,
}: {
  symbol: string;
  result: AskResult | null;
  asking: boolean;
  question: string;
  setQuestion: (q: string) => void;
  onAsk: () => void;
}) {
  return (
    <div className="mt-3 rounded-sm border border-terminal-border bg-terminal-panel/70 p-3">
      <div className="mb-2 ot-type-label text-[10px] uppercase text-terminal-muted">Ask the filings</div>
      <div className="flex gap-2">
        <TerminalInput
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question about these filings…"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAsk();
            }
          }}
        />
        <TerminalButton onClick={onAsk} loading={asking} disabled={asking || !question.trim()}>
          Ask
        </TerminalButton>
      </div>
      {asking ? (
        <div className="mt-3">
          <AiThinking activity="reading" label="Searching the filings and drafting a cited answer…" />
        </div>
      ) : result ? (
        <div className="mt-3 space-y-2">
          <div className="rounded-sm bg-terminal-bg px-2 py-2 text-xs text-terminal-text">
            {result.answer || "—"}
          </div>
          {result.citations?.length ? (
            <div>
              <div className="mb-1 ot-type-label text-[10px] uppercase text-terminal-muted">Citations</div>
              <ul className="space-y-1">
                {result.citations.map((c, i) => (
                  <li key={`c-${i}`} className="flex gap-2 text-[11px] text-terminal-muted">
                    <span className="shrink-0 text-terminal-accent">{i + 1}.</span>
                    <span className="min-w-0 truncate">{c.source_url ? (
                      <a href={/^[a-z]+:\/\//i.test(c.source_url) ? c.source_url : undefined} target="_blank" rel="noreferrer" className="hover:text-terminal-accent">{formatCitationLabel(c)}</a>
                    ) : formatCitationLabel(c)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}