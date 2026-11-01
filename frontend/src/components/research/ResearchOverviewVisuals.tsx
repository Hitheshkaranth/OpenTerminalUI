import { useState } from 'react';
import type { PortfolioImpact, ResearchInbox } from '../../api/researchInbox';
import './ResearchOverviewVisuals.css';

function CoverageBar({ label, value, total }: { label: string; value: number; total: number }) {
  const valid = Number.isFinite(value) && Number.isFinite(total) && total > 0 && value >= 0 && value <= total;
  return <div className="research-coverage-bar"><div><span>{label}</span><strong>{valid ? `${value} / ${total}` : 'Not available'}</strong></div>
    <div className="research-coverage-track" role={valid ? 'meter' : undefined} aria-label={label} aria-valuemin={valid ? 0 : undefined} aria-valuemax={valid ? total : undefined} aria-valuenow={valid ? value : undefined}>
      {valid && <span style={{ width: `${value / total * 100}%` }} />}
    </div></div>;
}

export function InboxCoverageVisual({ coverage }: { coverage: ResearchInbox['coverage'] }) {
  return <figure className="research-overview-figure" aria-label="Research monitoring coverage">
    <figcaption>Monitoring coverage <span>Checked records, not a measure of evidence quality</span></figcaption>
    <div className="research-coverage-columns">
      <CoverageBar label="Dossiers checked at least once" value={coverage.checked} total={coverage.enabled} />
      <CoverageBar label="Companies evaluated in latest screen checks" value={coverage.screen_evaluated ?? 0} total={coverage.screen_requested ?? 0} />
    </div>
  </figure>;
}

export function PortfolioImpactVisual({ data, onInspect }: { data: PortfolioImpact; onInspect: (id: string) => void }) {
  const [mode, setMode] = useState<'count' | 'weight'>('count');
  const weightsAvailable = data.coverage.weights_complete && data.items.length > 0 && data.items.every(item => item.portfolio_weight_pct != null && Number.isFinite(item.portfolio_weight_pct) && item.portfolio_weight_pct >= 0 && item.portfolio_weight_pct <= 100);
  const useWeight = weightsAvailable && mode === 'weight';
  const sorted = [...data.items].sort((a, b) => (useWeight ? b.portfolio_weight_pct! - a.portfolio_weight_pct! : b.holding_count - a.holding_count));
  const max = useWeight ? 100 : Math.max(1, data.coverage.holdings, ...data.items.map(item => item.holding_count));
  return <figure className="research-overview-figure" aria-label="Portfolio relationship comparison">
    <figcaption>Relationship concentration <span>Each relationship is independent; holdings may appear in several rows.</span></figcaption>
    <CoverageBar label="Holdings with cited relationships" value={data.coverage.with_cited_relationships} total={data.coverage.holdings} />
    {data.items.length > 0 && <>
      <div className="research-visual-controls" role="group" aria-label="Relationship chart measure">
        <button type="button" aria-pressed={!useWeight} onClick={() => setMode('count')}>Holding count</button>
        <button type="button" aria-pressed={useWeight} disabled={!weightsAvailable} onClick={() => setMode('weight')}>Portfolio weight</button>
      </div>
      {!weightsAvailable && <p className="research-visual-note">Showing holding counts. Complete comparable quotes are required to plot portfolio weights.</p>}
      <div className="research-concentration" aria-label={useWeight ? 'Quoted portfolio weights by relationship' : 'Holding counts by relationship'}>
        {sorted.map(group => {
          const value = useWeight ? group.portfolio_weight_pct! : group.holding_count;
          return <button type="button" key={group.id} className="research-concentration-row" onClick={() => onInspect(group.id)} aria-label={`Inspect ${group.name}: ${useWeight ? `${value.toFixed(1)}% portfolio weight` : `${value} holding${value === 1 ? '' : 's'}`}`}>
            <span className="research-concentration-label">{group.name} <small>{group.kind.replace(/_/g, ' ')}</small></span>
            <span className="research-concentration-track" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, value / max * 100))}%` }} /></span>
            <strong>{useWeight ? `${value.toFixed(1)}%` : `${value} holding${value === 1 ? '' : 's'}`}</strong>
          </button>;
        })}
      </div>
      <p className="research-visual-note">Select a bar to inspect its evidence. {useWeight ? 'Scale: 0–100% of quoted holdings; this is not predicted loss.' : `Scale: 0–${max} holdings; relationship counts include disclosed, inferred and user-defined links.`}</p>
    </>}
  </figure>;
}

export function PortfolioRelationshipMatrix({ data }: { data: PortfolioImpact }) {
  const symbols = [...new Set(data.items.flatMap(item => item.holdings.map(h => h.symbol)))].sort();
  if (!symbols.length) return null;
  return <figure className="research-overview-figure" aria-label="Holdings relationship matrix">
    <figcaption>Where holdings overlap <span>D = disclosed · I = inferred · A = your assumption · ? = unverified · — = no recorded link</span></figcaption>
    <div className="research-matrix-scroll" tabIndex={0} role="region" aria-label="Scrollable holdings relationship table"><table className="research-matrix">
      <thead><tr><th scope="col">Relationship</th>{symbols.map(symbol => <th key={symbol} scope="col">{symbol}</th>)}</tr></thead>
      <tbody>{data.items.map(group => <tr key={group.id}><th scope="row">{group.name}<small>{group.kind}</small></th>{symbols.map(symbol => {
        const holding = group.holdings.find(h => h.symbol === symbol);
        const basis = holding?.basis;
        const code = !holding ? '—' : basis === 'disclosed' ? 'D' : basis === 'inferred' ? 'I' : basis === 'user_assumption' ? 'A' : '?';
        return <td key={symbol}><span className={`research-matrix-cell ${holding ? 'research-matrix-linked' : ''}`} aria-label={`${symbol}: ${basis?.replace(/_/g, ' ') || 'no recorded link'}`} title={basis?.replace(/_/g, ' ') || 'No recorded link'}>{code}</span></td>;
      })}</tr>)}</tbody>
    </table></div>
  </figure>;
}
