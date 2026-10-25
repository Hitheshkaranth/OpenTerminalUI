import { useEffect, useState } from "react";
import type { LinkGroup } from "../../contexts/SymbolLinkContext";
import type { WorkspaceGroupContext } from "../../workspace/groupContext";
import { useLaunchpad } from "./LaunchpadContext";

export function WorkspaceGroupEditor() {
  const { activeLayout, updateGroupContext } = useLaunchpad();
  const [group, setGroup] = useState<Exclude<LinkGroup, "none">>("red");
  const [draft, setDraft] = useState<WorkspaceGroupContext>({ name: "Red group" });
  const [error, setError] = useState("");
  useEffect(() => { setDraft(activeLayout?.groups?.[group] || { name: `${group[0].toUpperCase()}${group.slice(1)} group` }); setError(""); }, [activeLayout?.id, activeLayout?.groups, group]);
  return <details className="rounded border border-terminal-border p-2 text-xs">
    <summary className="cursor-pointer py-1">Linked context groups</summary>
    <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); try { updateGroupContext(group, draft); setError(""); } catch (err) { setError(err instanceof Error ? err.message : "Invalid group context."); } }}>
      <label>Link color<select aria-label="Link color" className="block bg-terminal-bg p-2" value={group} onChange={(event) => setGroup(event.target.value as Exclude<LinkGroup, "none">)}>{["red", "blue", "green", "yellow"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Group name<input required className="block w-36 bg-terminal-bg p-2" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>Group symbol<input className="block w-28 bg-terminal-bg p-2" value={draft.symbol || ""} onChange={(event) => setDraft({ ...draft, symbol: event.target.value })} /></label>
      <label>From date<input type="date" className="block bg-terminal-bg p-2" value={draft.dateRange?.from || ""} onChange={(event) => setDraft({ ...draft, dateRange: { ...draft.dateRange, from: event.target.value } })} /></label>
      <label>To date<input type="date" className="block bg-terminal-bg p-2" value={draft.dateRange?.to || ""} onChange={(event) => setDraft({ ...draft, dateRange: { ...draft.dateRange, to: event.target.value } })} /></label>
      <label>Reporting currency<select aria-label="Reporting currency" className="block bg-terminal-bg p-2" value={draft.currency || ""} onChange={(event) => setDraft({ ...draft, currency: (event.target.value || undefined) as "INR" | "USD" | undefined })}><option value="">Source currency</option><option>INR</option><option>USD</option></select></label>
      <button type="submit" className="rounded border border-terminal-accent px-3 py-2 text-terminal-accent">Apply group context</button>
    </form>
    <p className="mt-2 text-terminal-muted">Applies to panels with this link color. Charts and performance filter available history to these dates. Other panels retain their source period. Reporting currency is a request; source values are never relabelled or converted without an FX source.</p>
    {error && <p role="alert" className="mt-2 text-terminal-neg">{error}</p>}
  </details>;
}
