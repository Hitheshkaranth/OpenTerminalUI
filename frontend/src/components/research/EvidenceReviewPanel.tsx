import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { Link } from 'react-router-dom';
import type { ResearchEvent, ReviewStatus } from '../../api/researchInbox';

export function safeSource(value: unknown): string | undefined {
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : undefined;
}
const obj = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function display(value: unknown): string {
  if (Array.isArray(value)) return value.map(display).join('; ');
  return value === null || value === undefined ? 'Unavailable' : typeof value === 'object' ? Object.entries(obj(value)).map(([key, v]) => `${key.replace(/_/g, ' ')}: ${display(v)}`).join(' · ') : String(value);
}
function SourceEvidence({ evidence }: { evidence: Record<string, unknown> }) {
  const citation = obj(evidence.citation);
  const source = safeSource(evidence.source_url ?? citation.source_url);
  const quote = evidence.quote ?? citation.quote;
  return <>{typeof quote === 'string' && quote ? <blockquote>{quote}</blockquote> : <p className="review-muted">No source passage attached to this observation.</p>}
    <div className="review-source">{source && <a href={source} target="_blank" rel="noreferrer">{String(evidence.source_title || citation.document_title || citation.title || 'Open source document')}</a>}{(evidence.page ?? citation.page ?? citation.page_start) != null && <span>Page {String(evidence.page ?? citation.page ?? citation.page_start)}</span>}{evidence.published_at != null && <time>{String(evidence.published_at).slice(0, 10)}</time>}</div></>;
}
export function EvidenceChange({ change }: { change: Record<string, unknown> }) {
  const after = obj(change.after);
  const before = obj(change.before);
  const condition = obj(after.condition);
  const evidence = obj(after.evidence ?? change.evidence ?? after);
  const unit = String(after.unit ?? condition.unit ?? evidence.unit ?? '');
  const previousUnit = String(before.unit ?? obj(before.condition).unit ?? unit);
  const period = after.period ?? evidence.period;
  const previous = before.value ?? after.previous_value;
  const metrics = Array.isArray(after.metrics) ? after.metrics.map(obj) : [];
  return <article className="review-evidence">
    <h3>{change.symbol != null && `${String(change.symbol)}: `}{String(change.reason ?? change.label ?? condition.label ?? 'Observation')}</h3>
    {('value' in before || 'value' in after) && <dl className="review-comparison"><div><dt>Previous observation</dt><dd>{display(previous)} {previousUnit}</dd></div><div><dt>Current observation</dt><dd>{display(after.value)} {unit}</dd></div></dl>}
    {condition.threshold != null && <p>Assumption: {String(condition.label ?? condition.metric ?? '')} {({ gte: '≥', lte: '≤', gt: '>', lt: '<', eq: '=' } as Record<string, string>)[String(condition.operator)] ?? String(condition.operator ?? '')} {display(condition.threshold)} {unit}</p>}
    {typeof after.status === 'string' && <p className="review-status">{after.status.replace(/_/g, ' ')}</p>}
    {typeof period === 'string' && <p>Period: {period}</p>}
    {change.kind === 'entered' || change.kind === 'exited' ? <><p>{String(change.kind)} saved screen</p><dl className="review-comparison"><div><dt>Previous values</dt><dd>{display(before)}</dd></div><div><dt>Current values</dt><dd>{display(after)}</dd></div></dl><p>Changed conditions: {display(change.rules)}</p>{change.source != null && <p>{String(change.source)}{change.data_observed_at != null && ` · Data observed ${new Date(String(change.data_observed_at)).toLocaleString()}`}</p>}</> : null}
    {metrics.length > 0 ? <>{metrics.map((metric, index) => {
      const metricUnit = String(metric.unit ?? '');
      const actual = typeof metric.actual === 'number' ? metric.actual : null;
      const expected = typeof metric.expected === 'number' ? metric.expected : null;
      return <section key={String(metric.metric ?? index)} aria-label={String(metric.label ?? metric.metric ?? 'Earnings metric')}><h4>{String(metric.label ?? metric.metric)}</h4><dl className="review-comparison"><div><dt>Your expectation</dt><dd>{display(expected)} {metricUnit}</dd></div><div><dt>Reported actual</dt><dd>{display(actual)} {metricUnit}</dd></div><div><dt>Management guidance</dt><dd>{metric.guidance_low == null && metric.guidance_high == null ? 'Unavailable' : `${display(metric.guidance_low)} to ${display(metric.guidance_high)} ${metricUnit}`}</dd></div><div><dt>Difference from expectation</dt><dd>{actual !== null && expected !== null ? `${Number((actual - expected).toPrecision(12))} ${metricUnit}` : 'Unavailable'}</dd></div></dl>
        <SourceEvidence evidence={metric}/>{metric.guidance_quote != null && String(metric.guidance_quote) && <><h4>Guidance source</h4><SourceEvidence evidence={{ quote: metric.guidance_quote, source_url: metric.guidance_source_url }}/></>}</section>;
    })}{typeof after.notes === 'string' && after.notes && <p>{after.notes}</p>}</> : <SourceEvidence evidence={evidence}/>}
  </article>;
}
export function EvidenceReviewPanel({ event, onClose, onReview, pending, error }: { event: ResearchEvent | null; onClose: () => void; onReview: (status: ReviewStatus) => void; pending: boolean; error?: string }) {
  return <Dialog open={!!event} onClose={onClose} className="review-dialog"><div className="review-backdrop" aria-hidden="true"/><DialogPanel className="review-drawer">
    {event && <><header><div><p className="review-muted">{event.symbol} · {event.kind}</p><DialogTitle>{event.title}</DialogTitle></div><button type="button" onClick={onClose} aria-label="Close evidence review">Close</button></header>
    <div className="review-drawer-body"><p className="review-reason">{event.reason}</p><p className="review-muted">Observed {event.occurred_at ? new Date(event.occurred_at).toLocaleString() : 'at an unknown time'}</p>
    {event.changes.map((change, index) => <EvidenceChange key={index} change={change}/>)}
    {!event.changes.length && <p>Open the dossier to compare your saved expectations with reported results.</p>}
    <Link to={event.source_url} className="review-link">{event.dossier_id ? 'Open dossier and revise assumptions' : 'Open saved screen'}</Link>
    <p className="review-muted">Marking this event reviewed acknowledges it. Your thesis and saved evidence remain unchanged.</p>
    {error && <p role="alert">{error}</p>}</div>
    <footer><button type="button" disabled={pending} onClick={() => onReview(event.status === 'reviewed' ? 'needs_review' : 'reviewed')}>{pending ? 'Saving…' : event.status === 'reviewed' ? 'Reopen review' : 'Mark reviewed'}</button><button type="button" disabled={pending} onClick={() => onReview('snoozed')}>Snooze for 24 hours</button></footer></>}
  </DialogPanel></Dialog>;
}
