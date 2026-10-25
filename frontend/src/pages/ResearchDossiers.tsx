import { useEffect, useState } from "react";
import "./ResearchDossiers.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { createDossier, deleteDossier, dossierDraft, dossierRevisions, emptyDossier, exportDossier, listDossiers, monitorDossier, readSharedDossier, revokeDossierShare, shareDossier, updateDossier, type DossierDraft, type DossierEvidence, type ResearchDossier } from "../api/researchDossiers";
import { extractApiErrorMessage } from "../api/base";
import { downloadJson } from "../lib/downloadJson";
import { useWorkspaceContextStore } from "../agent/workspaceContextStore";
import { ResearchExperiments } from "../components/research/ResearchExperiments";
import { DossierEvidenceSearch } from "../components/research/DossierEvidenceSearch";
import { useAgentStore } from "../agent/agentStore";

const field = "dossier-field";
const button = "dossier-button";
const lines = (value: string) => value.split("\n").map((v) => v.trim()).filter(Boolean);
const safeUrl = (url?: string | null) => { try { const parsed = new URL(url ?? ""); return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : null; } catch { return null; } };

function EvidenceList({ evidence }: { evidence: DossierEvidence[] }) {
  if (!evidence.length) return <div className="dossier-evidence-empty"><p>No evidence attached yet.</p><span>Add a source below or search your ingested documents to test this thesis.</span></div>;
  return <ul className="dossier-evidence-list">{evidence.map((item) => <li className="dossier-evidence-row" key={item.id}>
    <div className="dossier-evidence-heading"><strong>{item.claim}</strong><span className={`dossier-stance dossier-stance--${item.stance}`}>{item.stance === "neutral" ? "Needs review" : item.stance === "supporting" ? "Supporting" : "Opposing"}</span></div>
    {item.quote && <blockquote className="dossier-quotation">“{item.quote}”</blockquote>}
    <div className="dossier-source-line">
      {safeUrl(item.source_url) ? <a href={safeUrl(item.source_url)!} target="_blank" rel="noreferrer">{item.source_title || "View source"}<span aria-hidden="true"> ↗</span></a> : <span>{item.source_title || "Source not attached"}</span>}
      {item.published_at && <time dateTime={item.published_at}>Published {item.published_at.slice(0, 10)}</time>}
      {item.metric && <span className="dossier-metric">{item.metric}: {item.value ?? "Unavailable"} {item.unit}</span>}
    </div>
  </li>)}</ul>;
}

export function ResearchDossiersPage() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("id");
  const query = useQuery({ queryKey: ["research-dossiers"], queryFn: listDossiers });
  const selected = query.data?.find((d) => d.id === selectedId);
  const [draft, setDraft] = useState<DossierDraft>(emptyDossier);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState<number | undefined>();
  const [showHistory, setShowHistory] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [newEvidence, setNewEvidence] = useState({ claim: "", source_url: "", source_title: "", quote: "", published_at: "", stance: "neutral" as DossierEvidence["stance"] });
  const history = useQuery({ queryKey: ["dossier-revisions", selectedId], queryFn: () => dossierRevisions(selectedId!), enabled: !!selectedId && showHistory });
  useEffect(() => {
    if (selected && !editing) { setDraft(dossierDraft(selected)); setRevision(selected.revision); }
    setShareUrl("");
  }, [selected, editing]);
  useEffect(() => {
    if (selected) useWorkspaceContextStore.getState().setContext({ dossier_id: selected.id, selected_symbols: [selected.symbol], portfolio_id: selected.portfolio_id || undefined }, window.location.pathname);
    return () => useWorkspaceContextStore.getState().clearContext();
  }, [selected?.id, selected?.symbol, selected?.portfolio_id]);
  const perform = useMutation({
    mutationFn: async (action: () => Promise<void>) => action(),
    onError: (error) => setNotice(extractApiErrorMessage(error, "The research action failed.")),
  });
  const run = (action: () => Promise<void>) => { setNotice(""); perform.mutate(action); };
  const refresh = () => client.invalidateQueries({ queryKey: ["research-dossiers"] });
  const save = () => run(async () => {
    const saved = selectedId ? await updateDossier(selectedId, { ...draft, expected_revision: revision }) : await createDossier(draft);
    await refresh(); setParams({ id: saved.id }); setEditing(false); setNotice("Research saved.");
    void client.invalidateQueries({ queryKey: ["dossier-revisions", saved.id] });
  });
  const patch = <K extends keyof DossierDraft>(key: K, value: DossierDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  return <main className="dossier-page">
    <header className="dossier-page-header">
      <div><h1>Research dossiers</h1><p>Build a thesis. Keep the evidence in view.</p></div>
      <div className="dossier-page-actions"><Link className={button} to="/equity/research">Research library</Link><button className={`${button} dossier-button--primary`} onClick={() => { setParams({}); setDraft(emptyDossier()); setEditing(true); setRevision(undefined); setNotice(""); }}>New dossier</button></div>
    </header>
    {notice && <p role="status" className="dossier-notice">{notice}</p>}
    {query.isError && <p role="alert">Unable to load research. <button className={button} onClick={() => void query.refetch()}>Retry</button></p>}
    {query.isLoading && <div role="status" className="dossier-loading"><span>Loading research…</span><div aria-hidden="true" className="dossier-skeleton" /></div>}
    <div className="dossier-layout">
      <nav aria-label="Saved research" className="dossier-navigation"><div className="dossier-navigation-heading"><h2>Saved research</h2><span>{query.data?.length ?? 0}</span></div><div className="dossier-navigation-items">
        {query.data?.map((d) => <button key={d.id} aria-current={selectedId === d.id ? "page" : undefined} onClick={() => { setParams({ id: d.id }); setEditing(false); }} className="dossier-navigation-item">
          <span className="dossier-navigation-meta"><span className="dossier-symbol">{d.symbol}</span><span>Rev {d.revision}</span></span><strong>{d.title}</strong>{d.monitoring_enabled && <span className="dossier-monitoring"><span aria-hidden="true" />Monitoring filings</span>}
        </button>)}
        {query.data?.length === 0 && <p className="text-sm text-terminal-muted">Create a dossier or save an agent answer to begin.</p>}
      </div></nav>
      <section className="dossier-content">
        {editing ? <form className="dossier-editor" onSubmit={(event) => { event.preventDefault(); save(); }}>
          <div className="dossier-editor-heading"><h2>{selectedId ? "Edit research" : "Start a research dossier"}</h2><p>Record your view, then define what would change your mind.</p></div><label className="block text-sm">Title<input required maxLength={200} className={field} value={draft.title} onChange={(e) => patch("title", e.target.value)} /></label>
          <div className="grid grid-cols-2 gap-4"><label className="text-sm">Symbol<input required className={field} value={draft.symbol} onChange={(e) => patch("symbol", e.target.value.toUpperCase())} /></label>
          <label className="text-sm">Market<select className={field} value={draft.market} onChange={(e) => patch("market", e.target.value)}><option value="US">United States</option><option value="IN">India</option></select></label></div>
          <label className="block text-sm">Thesis<textarea aria-label="Thesis" required rows={5} className={field} value={draft.thesis} onChange={(e) => patch("thesis", e.target.value)} /></label>
          {([['assumptions', 'Assumptions'], ['catalysts', 'Catalysts'], ['invalidation_conditions', 'What would invalidate this thesis?']] as const).map(([key, label]) => <label key={key} className="block text-sm">{label} <span className="text-terminal-muted">(one per line)</span><textarea rows={3} className={field} value={draft[key].join("\n")} onChange={(e) => patch(key, e.target.value.split("\n"))} onBlur={() => patch(key, lines(draft[key].join("\n")))} /></label>)}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.monitoring_enabled} onChange={(e) => patch("monitoring_enabled", e.target.checked)} />Monitor changes in ingested filings</label>
          <label className="block text-sm">Material metric change (%)<input type="number" min={0} max={100} step={1} className={field} value={draft.materiality_threshold} onChange={(e) => patch("materiality_threshold", Number(e.target.value))} /></label>
          <div className="dossier-editor-actions"><button disabled={perform.isPending} className={`${button} dossier-button--primary`} type="submit">{perform.isPending ? "Saving…" : "Save research"}</button><button type="button" className={button} onClick={() => setEditing(false)}>Cancel editing</button></div>
        </form> : selected ? <>
          <div className="dossier-document-header"><div><div className="dossier-document-meta"><span className="dossier-symbol">{selected.symbol}</span><span>{selected.market}</span><span>Revision {selected.revision}</span></div><h2>{selected.title}</h2><p className="dossier-updated">Updated {new Date(selected.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p></div>
          <div className="dossier-document-actions"><button className={button} onClick={() => setEditing(true)}>Edit thesis</button><button className={button} disabled={perform.isPending} onClick={() => run(async () => { const result = await monitorDossier(selected.id); await refresh(); setNotice(`${result.changes.length} evidence changes found. Review them before changing your thesis.`); })}>Check changes</button>
          <button className={button} onClick={() => { useAgentStore.getState().setOpen(true); void useAgentStore.getState().startRun(`Review my research dossier ${selected.id} for ${selected.symbol}. Thesis: ${selected.thesis}. Identify supporting and opposing evidence; distinguish facts from assumptions.`); }}>Ask agent</button></div></div>
          <section className="dossier-thesis"><h3>Investment thesis</h3><p>{selected.thesis}</p></section><div className="dossier-thesis-notes">
          {([['assumptions', 'Assumptions'], ['catalysts', 'Catalysts'], ['invalidation_conditions', 'Invalidation conditions']] as const).map(([key, label]) => <div key={key} className="dossier-thesis-note"><h3>{label}</h3>{selected[key].length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{selected[key].map((v, i) => <li key={i}>{v}</li>)}</ul> : <p className="text-sm text-terminal-muted">None recorded.</p>}</div>)}
          </div><div className="dossier-evidence-section"><div className="dossier-section-heading"><h3>Evidence ({selected.evidence.length})</h3><span>Sources behind the thesis</span></div><EvidenceList evidence={selected.evidence} /></div>
          <details className="dossier-add-evidence"><summary>Add sourced evidence</summary><form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => { await updateDossier(selected.id, { expected_revision: selected.revision, evidence: [...selected.evidence, { ...newEvidence, published_at: newEvidence.published_at ? new Date(`${newEvidence.published_at}T00:00:00Z`).toISOString() : undefined, id: crypto.randomUUID(), observed_at: new Date().toISOString() }] }); await refresh(); setNewEvidence({ claim: "", source_url: "", source_title: "", quote: "", published_at: "", stance: "neutral" }); setNotice("Evidence saved and compared with the previous revision."); }); }}>
            <label className="block text-sm">Claim<input required className={field} value={newEvidence.claim} onChange={(e) => setNewEvidence({ ...newEvidence, claim: e.target.value })} /></label>
            <label className="block text-sm">Source URL<input type="url" required className={field} value={newEvidence.source_url} onChange={(e) => setNewEvidence({ ...newEvidence, source_url: e.target.value })} /></label>
            <label className="block text-sm">Source title<input className={field} value={newEvidence.source_title} onChange={(e) => setNewEvidence({ ...newEvidence, source_title: e.target.value })} /></label>
            <label className="block text-sm">Published date <span className="text-terminal-muted">(optional)</span><input type="date" aria-label="Published date" className={field} value={newEvidence.published_at} onChange={(e) => setNewEvidence({ ...newEvidence, published_at: e.target.value })} /></label>
            <label className="block text-sm">Source quotation<textarea className={field} value={newEvidence.quote} onChange={(e) => setNewEvidence({ ...newEvidence, quote: e.target.value })} /></label>
            <label className="block text-sm">Relationship to thesis<select className={field} value={newEvidence.stance} onChange={(e) => setNewEvidence({ ...newEvidence, stance: e.target.value as DossierEvidence["stance"] })}><option value="neutral">Neutral / needs review</option><option value="supporting">Supporting</option><option value="opposing">Opposing</option></select></label>
            <button disabled={perform.isPending} className={button}>Save evidence</button>
          </form></details>
          <ResearchExperiments key={`experiment-${selected.id}`} dossierId={selected.id} symbol={selected.symbol} />
          <DossierEvidenceSearch key={selected.id} dossier={selected} onSaved={() => { void refresh(); }} />
          <div className="dossier-secondary-actions">
            <button className={button} onClick={() => run(async () => downloadJson(await exportDossier(selected.id), `${selected.symbol}-research.json`))}>Export evidence snapshot</button>
            <button className={button} onClick={() => setShowHistory(!showHistory)}>Revision history</button>
            <button className={button} onClick={() => run(async () => { const shared = await shareDossier(selected.id); setShareUrl(`${window.location.origin}/research/shared/${encodeURIComponent(shared.token)}`); setNotice("Anyone with this link can read the shared research snapshot. Private portfolio and run details are excluded."); })}>Create read-only link</button>
            <button className={button} onClick={() => run(async () => { await revokeDossierShare(selected.id); setShareUrl(""); setNotice("Shared access revoked."); })}>Revoke shared link</button>
            <button className={button} onClick={() => { if (window.confirm(`Delete ${selected.title} and its research history?`)) run(async () => { await deleteDossier(selected.id); setParams({}); await refresh(); }); }}>Delete dossier</button>
          </div>
          {shareUrl && <label className="mt-3 block text-sm">Read-only research link<input readOnly className={field} value={shareUrl} onFocus={(e) => e.target.select()} /></label>}
          {showHistory && <div className="mt-4"><h3 className="font-semibold">Saved revisions</h3>{history.isLoading ? <p>Loading revisions…</p> : history.isError ? <p role="alert">Unable to load revisions.</p> : <ol className="divide-y divide-terminal-border">{history.data?.map((entry) => <li key={entry.revision} className="py-3"><strong className="text-sm">Revision {entry.revision}</strong><time className="ml-3 text-xs text-terminal-muted">{new Date(entry.created_at).toLocaleString()}</time><ul className="mt-2 space-y-2 text-sm">{entry.changes.map((change, index) => <li key={index}>{change.reason || (change.field ? `Updated ${change.field.replace(/_/g, " ")}` : "Research created")}{change.material === true && <span className="ml-2 text-terminal-accent">Review needed</span>}{change.after && typeof change.after === "object" && "claim" in change.after ? <EvidenceList evidence={[change.after as DossierEvidence]} /> : null}</li>)}</ul><details className="mt-2 text-sm"><summary className="cursor-pointer">Read saved thesis</summary><p className="mt-2 whitespace-pre-wrap">{entry.snapshot.thesis}</p></details></li>)}</ol>}</div>}
        </> : !editing && !query.isLoading && <div className="dossier-empty"><span className="dossier-empty-mark" aria-hidden="true">↗</span><h2>{query.data?.length ? "Your next decision starts here" : "Give your research a place to grow"}</h2><p>{query.data?.length ? "Select research to review its thesis and evidence." : "Create a dossier to capture an investment thesis, attach sources, and track what changes."}</p><p className="dossier-empty-hint">Use New dossier above, or save a research answer from the agent.</p></div>}
      </section>
    </div>
  </main>;
}

export function SharedResearchPage() {
  const { token = "" } = useParams();
  const query = useQuery({ queryKey: ["shared-research", token], queryFn: () => readSharedDossier(token), retry: false });
  const dossier = query.data;
  return <main className="dossier-page dossier-shared"><h1 className="text-2xl font-semibold">Shared research</h1>
    {query.isLoading && <p>Loading research…</p>}{query.isError && <p role="alert">This link is unavailable or has been revoked.</p>}
    {dossier && <><h2 className="mt-6 text-xl">{dossier.title}</h2><p className="text-sm text-terminal-muted">{dossier.symbol} · Read-only snapshot</p><p className="my-6 whitespace-pre-wrap leading-7">{dossier.thesis}</p><EvidenceList evidence={dossier.evidence} /></>}
  </main>;
}
