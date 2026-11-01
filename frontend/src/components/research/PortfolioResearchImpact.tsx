import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchResearchPortfolios, fetchPortfolioImpact } from '../../api/researchInbox';
import { safeSource } from './EvidenceReviewPanel';
import { extractApiErrorMessage } from '../../api/base';
import './ResearchReview.css';
import { PortfolioImpactVisual, PortfolioRelationshipMatrix } from './ResearchOverviewVisuals';
const pct = (value: number | null) => value == null || !Number.isFinite(value) ? 'Unavailable' : `${value.toFixed(1)}%`;
export function PortfolioResearchImpact() {
  const [chosen, setChosen] = useState('');
  const portfolios = useQuery({ queryKey: ['research-portfolios'], queryFn: fetchResearchPortfolios });
  const id = chosen || portfolios.data?.[0]?.id || '';
  const impact = useQuery({ queryKey: ['portfolio-research-impact', id], queryFn: () => fetchPortfolioImpact(id), enabled: !!id });
  const [graph, setGraph] = useState(false);
  const data = impact.data;
  const detailRefs = useRef(new Map<string, HTMLDetailsElement>());
  function inspect(id: string) {
    setGraph(false);
    requestAnimationFrame(() => { const node = detailRefs.current.get(id); if (node) { node.open = true; node.scrollIntoView({ block: 'nearest' }); node.querySelector('summary')?.focus(); } });
  }
  return <section className="research-review" aria-label="Portfolio research impact">
    <div className="review-heading"><div><h2>Shared research risks</h2><p>See which holdings depend on the same suppliers, customers, commodities or assumptions.</p></div></div>
    {portfolios.isPending && <p role="status">Loading portfolios…</p>}
    {portfolios.isError && <p role="alert">Could not load portfolios. <button onClick={() => portfolios.refetch()}>Retry</button></p>}
    {portfolios.data && !portfolios.data.length && <div className="review-empty"><h3>Add a portfolio to map shared risks</h3><p>Use an account-owned portfolio in Portfolio Manager, then extract company value chains from filings.</p><Link to="/equity/portfolio?view=manager">Open Portfolio Manager</Link></div>}
    {!!portfolios.data?.length && <div className="review-toolbar"><label>Portfolio <select value={id} onChange={e => setChosen(e.target.value)}>{portfolios.data.map(p => <option key={p.id} value={p.id}>{p.name} · {p.currency}</option>)}</select></label><button type="button" onClick={() => impact.refetch()} disabled={impact.isFetching}>Refresh exposure</button><button type="button" aria-pressed={graph} onClick={() => setGraph(!graph)}>{graph ? 'Show ranked list' : 'Explore relationships'}</button></div>}
    {id && impact.isPending && <p role="status">Checking research coverage and holding quotes…</p>}
    {impact.isError && <p role="alert">{extractApiErrorMessage(impact.error, 'Could not load portfolio exposure.')} <button onClick={() => impact.refetch()}>Retry</button></p>}
    {data && <><div className="review-coverage"><p>{data.coverage.with_cited_relationships} of {data.coverage.holdings} holdings have cited relationships.</p>{!!data.coverage.unknown_symbols.length && <p>Relationship coverage unknown: {data.coverage.unknown_symbols.join(', ')}.</p>}{!!data.coverage.quote_gaps.length && <p>Weights unavailable: missing comparable quotes for {data.coverage.quote_gaps.join(', ')}.</p>}<p>{data.interpretation}</p><details className="mt-2"><summary className="cursor-pointer py-2">How weights and coverage are calculated</summary><p>{data.weight_basis}</p></details></div>
      <PortfolioImpactVisual key={id} data={data} onInspect={inspect} />
      {graph && <PortfolioRelationshipMatrix data={data} />}
      {!data.items.length && <div className="review-empty"><h3>No relationships available yet</h3><p>Extract a company value chain from its filings, or add measurable thesis assumptions to a dossier for one of these holdings.</p><Link to="/equity/research-dossiers">Open research dossiers</Link></div>}
      {graph ? <ul className="review-relationships" aria-label="Relationship map">{data.items.map(group => <li key={group.id}><strong>{group.name} <span className="review-muted">({group.kind})</span></strong><ul>{group.holdings.map(h => <li key={h.symbol}><span aria-hidden="true">↳ </span><Link to={`/equity/security/${encodeURIComponent(h.symbol)}`}>{h.symbol}</Link> · {h.basis.replace(/_/g, ' ')} · quoted holdings weight {pct(h.weight_pct)}</li>)}</ul></li>)}</ul> : data.items.map(group => <details key={group.id} ref={node => { if (node) detailRefs.current.set(group.id, node); else detailRefs.current.delete(group.id); }} className="review-exposure"><summary><strong>{group.name}</strong><span>{group.kind} · {group.holding_count} holdings</span><span>{group.holdings.some(h => h.basis === 'unknown') ? 'Potentially linked holdings weight (includes unverified)' : 'Affected holdings weight'}: {pct(group.portfolio_weight_pct)}</span></summary><div>{group.holdings.map(h => { const source = safeSource(h.citation?.source_url); return <article key={h.symbol} className="review-evidence"><h3>{h.symbol} <span className="review-status">{h.basis.replace(/_/g, ' ')}</span></h3><p>Quoted holdings weight: {pct(h.weight_pct)} · Disclosed business share: {pct(h.business_share_pct)}</p>{h.quote_provenance && <p className="review-muted">Quote: {h.quote_provenance.source} · {h.quote_provenance.quality.replace(/_/g, ' ')} · {h.quote_provenance.currency || 'currency unknown'} · {h.quote_provenance.as_of ? `As of ${new Date(h.quote_provenance.as_of).toLocaleString()}` : 'Quote time unknown'}{h.quote_provenance.reasons.length > 0 && ` · ${h.quote_provenance.reasons.map(reason => reason.replace(/_/g, ' ')).join(', ')}`}</p>}{h.condition && <p>{h.condition.label}: {h.condition.operator} {h.condition.threshold}{h.condition.unit}</p>}{h.citation?.quote != null && <blockquote>{String(h.citation.quote)}</blockquote>}{source && <a href={source} target="_blank" rel="noreferrer">Read cited filing</a>}{!h.citation && h.basis !== 'user_assumption' && <p>Relationship unverified: no traceable source passage is attached. Business share remains unknown.</p>}{h.observed_at && <p className="review-muted">Snapshot: {new Date(h.observed_at).toLocaleString()}</p>}<div className="review-source">{h.dossiers.map(d => <Link key={d.id} to={`/equity/research-dossiers?id=${encodeURIComponent(d.id)}`}>Review {d.title}</Link>)}</div></article>; })}</div></details>)}
    </>}
  </section>;
}
