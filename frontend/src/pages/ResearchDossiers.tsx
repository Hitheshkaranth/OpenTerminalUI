import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { createDossier, deleteDossier, dossierDraft, dossierRevisions, emptyDossier, exportDossier, listDossiers, monitorDossier, readSharedDossier, revokeDossierShare, shareDossier, updateDossier, type DossierDraft, type DossierEvidence, type ResearchDossier } from "../api/researchDossiers";
import { extractApiErrorMessage } from "../api/base";
import { downloadJson } from "../lib/downloadJson";
import { useWorkspaceContextStore } from "../agent/workspaceContextStore";
import { ResearchExperiments } from "../components/research/ResearchExperiments";
import { DossierEvidenceSearch } from "../components/research/DossierEvidenceSearch";
import { useAgentStore } from "../agent/agentStore";

const field = "w-full rounded border border-terminal-border bg-terminal-bg p-2 text-sm text-terminal-text focus:outline focus:outline-2 focus:outline-terminal-accent";
const button = "rounded border border-terminal-border px-3 py-2 text-sm hover:border-terminal-accent disabled:opacity-50";
const lines = (value: string) => value.split("\n").map((v) => v.trim()).filter(Boolean);
const safeUrl = (url?: string | null) => { try { const parsed = new URL(url ?? ""); return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : null; } catch { return null; } };

function EvidenceList({ evidence }: { evidence: DossierEvidence[] }) {
  return <ul className="divide-y divide-terminal-border">{evidence.map((item) => <li className="py-3" key={item.id}>
    <div className="flex flex-wrap justify-between gap-2"><strong>{item.claim}</strong><span className="text-xs text-terminal-muted">{item.stance}</span></div>
    {item.quote && <blockquote className="mt-2 text-sm text-terminal-muted">“{item.quote}”</blockquote>}
    <div className="mt-2 flex flex-wrap gap-3 text-xs text-terminal-muted">
      {safeUrl(item.source_url) ? <a className="text-terminal-accent underline" href={safeUrl(item.source_url)!} target="_blank" rel="noreferrer">{item.source_title || "View source"}</a> : <span>{item.source_title || "Source not attached"}</span>}
      {item.published_at && <time>Published {item.published_at.slice(0, 10)}</time>}
      {item.metric && <span>{item.metric}: {item.value ?? "Unavailable"} {item.unit}</span>}
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
  const [newEvidence, setNewEvidence] = useState({ claim: "", source_url: "", source_title: "", quote: "", stance: "neutral" as DossierEvidence["stance"] });
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
  return <main className="mx-auto max-w-7xl p-4 text-terminal-text md:p-6">
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Research dossiers</h1><p className="mt-1 text-sm text-terminal-muted">Keep your thesis, evidence, and changes together.</p></div>
      <div className="flex gap-2"><Link className={button} to="/equity/research">Research library</Link><button className={button} onClick={() => { setParams({}); setDraft(emptyDossier()); setEditing(true); setRevision(undefined); setNotice(""); }}>New dossier</button></div>
    </header>
    {notice && <p role="status" className="mb-4 rounded border border-terminal-border p-3 text-sm">{notice}</p>}
    {query.isError && <p role="alert">Unable to load research. <button className={button} onClick={() => void query.refetch()}>Retry</button></p>}
    {query.isLoading && <p role="status">Loading research…</p>}
    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <nav aria-label="Saved research" className="space-y-1">
        {query.data?.map((d) => <button key={d.id} aria-current={selectedId === d.id ? "page" : undefined} onClick={() => { setParams({ id: d.id }); setEditing(false); }} className={`w-full rounded border p-3 text-left ${selectedId === d.id ? "border-terminal-accent" : "border-terminal-border"}`}>
          <strong className="block text-sm">{d.title}</strong><span className="text-xs text-terminal-muted">{d.symbol} · Revision {d.revision}{d.monitoring_enabled ? " · Monitoring" : ""}</span>
        </button>)}
        {query.data?.length === 0 && <p className="text-sm text-terminal-muted">Create a dossier or save an agent answer to begin.</p>}
      </nav>
      <section className="min-w-0">
        {editing ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save(); }}>
          <label className="block text-sm">Title<input required maxLength={200} className={field} value={draft.title} onChange={(e) => patch("title", e.target.value)} /></label>
          <div className="grid grid-cols-2 gap-4"><label className="text-sm">Symbol<input required className={field} value={draft.symbol} onChange={(e) => patch("symbol", e.target.value.toUpperCase())} /></label>
          <label className="text-sm">Market<select className={field} value={draft.market} onChange={(e) => patch("market", e.target.value)}><option value="US">United States</option><option value="IN">India</option></select></label></div>
          <label className="block text-sm">Thesis<textarea aria-label="Thesis" required rows={5} className={field} value={draft.thesis} onChange={(e) => patch("thesis", e.target.value)} /></label>
          {([['assumptions', 'Assumptions'], ['catalysts', 'Catalysts'], ['invalidation_conditions', 'What would invalidate this thesis?']] as const).map(([key, label]) => <label key={key} className="block text-sm">{label} <span className="text-terminal-muted">(one per line)</span><textarea rows={3} className={field} value={draft[key].join("\n")} onChange={(e) => patch(key, e.target.value.split("\n"))} onBlur={() => patch(key, lines(draft[key].join("\n")))} /></label>)}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.monitoring_enabled} onChange={(e) => patch("monitoring_enabled", e.target.checked)} />Monitor changes in ingested filings</label>
          <label className="block text-sm">Material metric change (%)<input type="number" min={0} max={100} step={1} className={field} value={draft.materiality_threshold} onChange={(e) => patch("materiality_threshold", Number(e.target.value))} /></label>
          <button disabled={perform.isPending} className={button} type="submit">{perform.isPending ? "Saving…" : "Save research"}</button>
        </form> : selected ? <>
          <div className="mb-4 flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-semibold">{selected.title}</h2><p className="text-sm text-terminal-muted">{selected.symbol} · {selected.market} · Revision {selected.revision}</p></div>
          <div className="flex flex-wrap gap-2"><button className={button} onClick={() => setEditing(true)}>Edit thesis</button><button className={button} disabled={perform.isPending} onClick={() => run(async () => { const result = await monitorDossier(selected.id); await refresh(); setNotice(`${result.changes.length} evidence changes found. Review them before changing your thesis.`); })}>Check changes</button>
          <button className={button} onClick={() => { useAgentStore.getState().setOpen(true); void useAgentStore.getState().startRun(`Review my research dossier ${selected.id} for ${selected.symbol}. Thesis: ${selected.thesis}. Identify supporting and opposing evidence; distinguish facts from assumptions.`); }}>Ask agent</button></div></div>
          <p className="max-w-prose whitespace-pre-wrap text-sm leading-7">{selected.thesis}</p>
          {([['assumptions', 'Assumptions'], ['catalysts', 'Catalysts'], ['invalidation_conditions', 'Invalidation conditions']] as const).map(([key, label]) => <div key={key} className="mt-5"><h3 className="font-semibold">{label}</h3>{selected[key].length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{selected[key].map((v, i) => <li key={i}>{v}</li>)}</ul> : <p className="text-sm text-terminal-muted">None recorded.</p>}</div>)}
          <div className="mt-6"><h3 className="font-semibold">Evidence ({selected.evidence.length})</h3><EvidenceList evidence={selected.evidence} /></div>
          <details className="mt-4 rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Add sourced evidence</summary><form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => { await updateDossier(selected.id, { expected_revision: selected.revision, evidence: [...selected.evidence, { ...newEvidence, id: crypto.randomUUID(), observed_at: new Date().toISOString() }] }); await refresh(); setNewEvidence({ claim: "", source_url: "", source_title: "", quote: "", stance: "neutral" }); setNotice("Evidence saved and compared with the previous revision."); }); }}>
            <label className="block text-sm">Claim<input required className={field} value={newEvidence.claim} onChange={(e) => setNewEvidence({ ...newEvidence, claim: e.target.value })} /></label>
            <label className="block text-sm">Source URL<input type="url" required className={field} value={newEvidence.source_url} onChange={(e) => setNewEvidence({ ...newEvidence, source_url: e.target.value })} /></label>
            <label className="block text-sm">Source title<input className={field} value={newEvidence.source_title} onChange={(e) => setNewEvidence({ ...newEvidence, source_title: e.target.value })} /></label>
            <label className="block text-sm">Source quotation<textarea className={field} value={newEvidence.quote} onChange={(e) => setNewEvidence({ ...newEvidence, quote: e.target.value })} /></label>
            <label className="block text-sm">Relationship to thesis<select className={field} value={newEvidence.stance} onChange={(e) => setNewEvidence({ ...newEvidence, stance: e.target.value as DossierEvidence["stance"] })}><option value="neutral">Neutral / needs review</option><option value="supporting">Supporting</option><option value="opposing">Opposing</option></select></label>
            <button disabled={perform.isPending} className={button}>Save evidence</button>
          </form></details>
          <ResearchExperiments key={`experiment-${selected.id}`} dossierId={selected.id} symbol={selected.symbol} />
          <DossierEvidenceSearch key={selected.id} dossier={selected} onSaved={() => { void refresh(); }} />
          <div className="mt-6 flex flex-wrap gap-2">
            <button className={button} onClick={() => run(async () => downloadJson(await exportDossier(selected.id), `${selected.symbol}-research.json`))}>Export evidence snapshot</button>
            <button className={button} onClick={() => setShowHistory(!showHistory)}>Revision history</button>
            <button className={button} onClick={() => run(async () => { const shared = await shareDossier(selected.id); setShareUrl(`${window.location.origin}/research/shared/${encodeURIComponent(shared.token)}`); setNotice("Anyone with this link can read the shared research snapshot. Private portfolio and run details are excluded."); })}>Create read-only link</button>
            <button className={button} onClick={() => run(async () => { await revokeDossierShare(selected.id); setShareUrl(""); setNotice("Shared access revoked."); })}>Revoke shared link</button>
            <button className={button} onClick={() => { if (window.confirm(`Delete ${selected.title} and its research history?`)) run(async () => { await deleteDossier(selected.id); setParams({}); await refresh(); }); }}>Delete dossier</button>
          </div>
          {shareUrl && <label className="mt-3 block text-sm">Read-only research link<input readOnly className={field} value={shareUrl} onFocus={(e) => e.target.select()} /></label>}
          {showHistory && <div className="mt-4"><h3 className="font-semibold">Saved revisions</h3>{history.isLoading ? <p>Loading revisions…</p> : history.isError ? <p role="alert">Unable to load revisions.</p> : <ol className="divide-y divide-terminal-border">{history.data?.map((entry) => <li key={entry.revision} className="py-3"><strong className="text-sm">Revision {entry.revision}</strong><time className="ml-3 text-xs text-terminal-muted">{new Date(entry.created_at).toLocaleString()}</time><ul className="mt-2 space-y-2 text-sm">{entry.changes.map((change, index) => <li key={index}>{change.reason || (change.field ? `Updated ${change.field.replace(/_/g, " ")}` : "Research created")}{change.material === true && <span className="ml-2 text-terminal-accent">Review needed</span>}{change.after && typeof change.after === "object" && "claim" in change.after ? <EvidenceList evidence={[change.after as DossierEvidence]} /> : null}</li>)}</ul><details className="mt-2 text-sm"><summary className="cursor-pointer">Read saved thesis</summary><p className="mt-2 whitespace-pre-wrap">{entry.snapshot.thesis}</p></details></li>)}</ol>}</div>}
        </> : !editing && <p className="py-12 text-terminal-muted">Select research to review its thesis and evidence.</p>}
      </section>
    </div>
  </main>;
}

export function SharedResearchPage() {
  const { token = "" } = useParams();
  const query = useQuery({ queryKey: ["shared-research", token], queryFn: () => readSharedDossier(token), retry: false });
  const dossier = query.data;
  return <main className="mx-auto max-w-3xl p-6 text-terminal-text"><h1 className="text-2xl font-semibold">Shared research</h1>
    {query.isLoading && <p>Loading research…</p>}{query.isError && <p role="alert">This link is unavailable or has been revoked.</p>}
    {dossier && <><h2 className="mt-6 text-xl">{dossier.title}</h2><p className="text-sm text-terminal-muted">{dossier.symbol} · Read-only snapshot</p><p className="my-6 whitespace-pre-wrap leading-7">{dossier.thesis}</p><EvidenceList evidence={dossier.evidence} /></>}
  </main>;
}
