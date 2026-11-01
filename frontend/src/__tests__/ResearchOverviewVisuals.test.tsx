import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { InboxCoverageVisual, PortfolioImpactVisual, PortfolioRelationshipMatrix } from '../components/research/ResearchOverviewVisuals';
import type { PortfolioImpact, ResearchInbox } from '../api/researchInbox';

const data: PortfolioImpact = {
  portfolio_name: 'India research', currency: 'INR', interpretation: '', weight_basis: '',
  coverage: { holdings: 2, with_cited_relationships: 1, unknown_symbols: ['OTHER'], quote_gaps: ['OTHER'], weights_complete: false },
  items: [{ id: 'customer', name: 'Customer relationship', kind: 'customer', holding_count: 1, portfolio_weight_pct: null,
    holdings: [{ symbol: 'MTARTECH', weight_pct: null, business_share_pct: null, basis: 'disclosed', citation: { source_url: 'https://mtar.in' }, dossiers: [] }] },
    { id: 'assumption', name: 'Margin threshold', kind: 'assumption', holding_count: 1, portfolio_weight_pct: null,
      holdings: [{ symbol: 'OTHER', weight_pct: null, business_share_pct: null, basis: 'user_assumption', citation: null, dossiers: [] }] }],
};

it('does not turn incomplete quotes into zero-weight bars and drills into evidence', () => {
  const inspect = vi.fn();
  render(<PortfolioImpactVisual data={data} onInspect={inspect} />);
  expect(screen.getByRole('button', { name: 'Portfolio weight' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Customer relationship: 1 holding' }));
  expect(inspect).toHaveBeenCalledWith('customer');
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '1');
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuemax', '2');
});

it('uses independent, unnormalised weights only when complete, including true zero', () => {
  const complete = { ...data, coverage: { ...data.coverage, weights_complete: true, quote_gaps: [] }, items: data.items.map((item, i) => ({ ...item, portfolio_weight_pct: i === 0 ? 70 : 0 })) };
  const { rerender } = render(<PortfolioImpactVisual data={complete} onInspect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Portfolio weight' }));
  expect(screen.getByRole('button', { name: 'Inspect Customer relationship: 70.0% portfolio weight' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Inspect Margin threshold: 0.0% portfolio weight' })).toBeInTheDocument();
  rerender(<PortfolioImpactVisual data={data} onInspect={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Holding count' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByText('70.0%')).not.toBeInTheDocument();
});

it('distinguishes disclosed, assumed and absent links in the matrix', () => {
  render(<PortfolioRelationshipMatrix data={data} />);
  expect(screen.getByLabelText('MTARTECH: disclosed')).toHaveTextContent('D');
  expect(screen.getByLabelText('OTHER: user assumption')).toHaveTextContent('A');
  expect(screen.getByLabelText('OTHER: no recorded link')).toHaveTextContent('—');
  expect(screen.getByRole('region', { name: 'Scrollable holdings relationship table' })).toHaveAttribute('tabindex', '0');
});

it('keeps missing coverage distinct from zero completed checks', () => {
  const coverage: ResearchInbox['coverage'] = { dossiers: 0, enabled: 0, checked: 0, disabled: 0, awaiting_check: 0, last_checked_at: null, scope: '', screen_schedules: 1, screen_requested: 4, screen_evaluated: 0 };
  render(<InboxCoverageVisual coverage={coverage} />);
  expect(screen.getByText('Not available')).toBeInTheDocument();
  expect(screen.getAllByRole('meter')).toHaveLength(1);
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuemax', '4');
});
