import { useState } from "react";
import { searchDossierEvidence, updateDossier, type FilingPassage, type ResearchDossier } from "../../api/researchDossiers";
import { extractApiErrorMessage } from "../../api/base";

export function DossierEvidenceSearch({ dossier, onSaved }: { dossier: ResearchDossier; onSaved: () => void }) {
  const [query, setQuery] = useState("");
  const [asOf, setAsOf] = useState("");
  const [results, setResults] = useState<FilingPassage[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  return <details className="mt-4 rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Find evidence in company filings</summary>
    <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setNotice("");
      try { const items = await searchDossierEvidence(dossier.id, query, asOf); setResults(items); if (!items.length) setNotice("No matching passages. Import company filings in the Security Hub or adjust your search."); }
      catch (error) { setNotice(extractApiErrorMessage(error, "Search failed.")); }
      finally { setBusy(false); }
    }}>
      <label className="flex-1 text-sm">Question or keywords<input required value={query} onChange={(e) => setQuery(e.target.value)} className="block w-full rounded border border-terminal-border bg-terminal-bg p-2" /></label>
      <label className="text-sm">Known by date (optional)<input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="block rounded border border-terminal-border bg-terminal-bg p-2" /></label>
      <button disabled={busy} className="rounded border border-terminal-border p-2 text-sm">{busy ? "Searching…" : "Search filings"}</button>
    </form>
    <p className="mt-2 text-xs text-terminal-muted">Historical searches exclude documents with unknown publication dates.</p>
    {notice && <p role="status" className="my-3 text-sm">{notice}</p>}
    <ul className="divide-y divide-terminal-border">{results.map((passage) => <li className="py-3" key={passage.id}>
      <p className="text-sm font-semibold">{passage.document_title || passage.title || "Company filing"}{passage.page_start ? ` · page ${passage.page_start}` : ""}</p>
      <details><summary className="cursor-pointer text-xs text-terminal-accent">Read source passage</summary><blockquote className="my-2 max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-6">{passage.text}</blockquote></details>
      <button disabled={busy || dossier.evidence.some((e) => e.id === `passage:${passage.id}`)} className="mt-2 rounded border border-terminal-border px-3 py-1 text-xs" onClick={async () => {
        setBusy(true);
        try { await updateDossier(dossier.id, { expected_revision: dossier.revision, evidence: [...dossier.evidence, { id: `passage:${passage.id}`, claim: `Source passage for: ${query}`, stance: "neutral", quote: passage.text, source_title: passage.document_title || passage.title || "Company filing", source_url: passage.source_url || undefined, document_id: passage.document_id, page: passage.page_start || undefined, observed_at: new Date().toISOString() }] }); onSaved(); setNotice("Passage added for review. Its relationship to the thesis has not been inferred."); }
        catch (error) { setNotice(extractApiErrorMessage(error, "Unable to save passage.")); }
        finally { setBusy(false); }
      }}>Add passage to evidence</button>
    </li>)}</ul>
  </details>;
}
