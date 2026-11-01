import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchResearchInbox, reviewResearchEvent, type ResearchEvent, type ReviewBucket, type ReviewStatus } from '../../api/researchInbox';
import { extractApiErrorMessage } from '../../api/base';
import { EvidenceReviewPanel } from './EvidenceReviewPanel';
import './ResearchReview.css';
import { InboxCoverageVisual } from './ResearchOverviewVisuals';

const tabs: Array<[ReviewBucket, string]> = [['needs_review', 'Needs review'], ['upcoming', 'Upcoming'], ['reviewed', 'Reviewed']];
export function ResearchInbox() {
  const [params, setParams] = useSearchParams();
  const bucket = tabs.some(([key]) => key === params.get('review')) ? params.get('review') as ReviewBucket : 'needs_review';
  const selectedId = params.get('event');
  const [retained, setRetained] = useState<ResearchEvent | null>(null);
  const [undo, setUndo] = useState<{ id: string; status: ReviewStatus; until?: string } | null>(null);
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['research-inbox'], queryFn: fetchResearchInbox });
  const mutation = useMutation({ mutationFn: ({ id, status, until }: { id: string; status: ReviewStatus; until?: string }) => reviewResearchEvent(id, status, until), onSuccess: () => client.invalidateQueries({ queryKey: ['research-inbox'] }) });
  const event = selectedId ? query.data?.items.find(item => item.id === selectedId) ?? (retained?.id === selectedId ? retained : null) : null;
  function select(item: ResearchEvent | null) { const next = new URLSearchParams(params); if (item) next.set('event', item.id); else next.delete('event'); setRetained(item); mutation.reset(); setParams(next, { replace: true, preventScrollReset: true }); }
  function changeStatus(status: ReviewStatus) { if (!event) return; const previous = { id: event.id, status: event.status, until: event.snoozed_until ?? undefined }; mutation.mutate({ id: event.id, status, until: status === 'snoozed' ? new Date(Date.now() + 86400000).toISOString() : undefined }, { onSuccess: () => setUndo(previous) }); }
  const coverage = query.data?.coverage;
  const pendingChecks = !!coverage && (coverage.awaiting_check > 0 || (coverage.screen_awaiting_check ?? 0) > 0);
  const incomplete = !!coverage && (pendingChecks || !!coverage.source_fetch_issues?.length || (coverage.screen_failed ?? 0) > 0 || (coverage.screen_partial ?? 0) > 0 || (coverage.screen_overdue ?? 0) > 0 || (coverage.recently_checked !== undefined && coverage.recently_checked < coverage.enabled));
  const configured = !!coverage && (coverage.enabled > 0 || coverage.screen_schedules > 0);
  const emptyTitle = bucket === 'reviewed' ? 'No reviewed events yet' : bucket === 'upcoming' ? 'No upcoming reviews' : !configured ? 'Set up your first research monitor' : pendingChecks && !(coverage?.checked || coverage?.screen_checked) ? 'Waiting for your first checks' : incomplete ? 'No recorded changes; coverage is incomplete' : 'No recorded changes need review';
  return <section className="research-review" aria-label="Research review inbox">
    <div className="review-heading"><div><h2>What changed?</h2><p>Review the evidence behind your companies and saved screens.</p></div><button type="button" disabled={query.isFetching} onClick={() => query.refetch()}>{query.isFetching ? 'Refreshing…' : 'Refresh inbox'}</button></div>
    {query.isPending && <div className="review-loading" role="status">Loading research changes…</div>}
    {query.isError && <p role="alert">{extractApiErrorMessage(query.error, 'Research changes could not be loaded.')} <button onClick={() => query.refetch()}>Retry</button></p>}
    {coverage && <div className="review-coverage"><p>Previously checked {coverage.checked} of {coverage.enabled} enabled dossiers · {coverage.awaiting_check} awaiting first check · {coverage.disabled} monitoring off</p>{coverage.recently_checked !== undefined && <p>{coverage.recently_checked} dossiers checked in the last {coverage.check_freshness_minutes ?? 30} minutes.</p>}<p>{coverage.screen_schedules} screen schedules · {coverage.screen_awaiting_check ?? 0} awaiting first check · {coverage.screen_failed ?? 0} failed · {coverage.screen_partial ?? 0} with incomplete coverage · {coverage.screen_overdue ?? 0} overdue</p>{(coverage.screen_checked ?? 0) > 0 && <p>Latest screen results evaluated {coverage.screen_evaluated ?? 0} of {coverage.screen_requested ?? 0} requested company checks. Counts may include companies in more than one screen.</p>}<p>{coverage.scope} {coverage.last_checked_at && `Latest dossier check: ${new Date(coverage.last_checked_at).toLocaleString()}.`}</p>{!!coverage.source_fetch_issues?.length && <p>Source coverage needs attention: {coverage.source_fetch_issues.map(s => `${s.symbol} (${s.status ?? "awaiting first fetch"})`).join(", ")}. Open each dossier for details.</p>}</div>}
    {coverage && <InboxCoverageVisual coverage={coverage} />}
    <nav className="review-tabs" aria-label="Review status">{tabs.map(([key, label]) => <button type="button" key={key} aria-pressed={bucket === key} onClick={() => { const next = new URLSearchParams(params); next.set('review', key); next.delete('event'); setParams(next, { replace: true, preventScrollReset: true }); }}>{label} <span>{query.data?.counts[key] ?? 0}</span></button>)}</nav>
    {undo && <div className="review-undo" role="status">Review status saved. <button disabled={mutation.isPending} onClick={() => mutation.mutate(undo, { onSuccess: () => setUndo(null) })}>Undo</button></div>}
    {query.data && <ul className="review-queue">{query.data.items.filter(item => item.bucket === bucket).map(item => <li key={item.id}><button className="review-event" type="button" onClick={() => select(item)}><span className="review-symbol">{item.symbol}</span><span><strong>{item.title}</strong><span className="review-event-reason">{item.reason}</span></span><span className={`review-priority ${item.priority === 'high' ? 'review-priority-high' : ''}`}>{item.priority === 'high' ? 'Threshold breached' : item.kind.replace(/_/g, ' ')}</span><span className="review-event-action">Review evidence →</span></button></li>)}</ul>}
    {query.data && !query.data.items.some(item => item.bucket === bucket) && <div className="review-empty"><h3>{emptyTitle}</h3><p>{bucket === 'needs_review' ? incomplete ? 'An empty queue does not establish that nothing changed. Run pending checks and resolve failed, stale or incomplete coverage.' : 'Create a dossier, add sourced observations and enable monitoring. Scheduled screens also feed this inbox.' : 'Your review history and scheduled earnings expectations will appear here.'}</p><Link to="/equity/research-dossiers">Open research dossiers</Link><Link to="/equity/screener">Open screener</Link></div>}
    <EvidenceReviewPanel event={event} onClose={() => select(null)} onReview={changeStatus} pending={mutation.isPending} error={mutation.isError ? extractApiErrorMessage(mutation.error, 'Could not save review status.') : undefined}/>
  </section>;
}
