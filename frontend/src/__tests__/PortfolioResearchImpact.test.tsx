import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PortfolioResearchImpact } from '../components/research/PortfolioResearchImpact';
import { fetchResearchPortfolios, fetchPortfolioImpact } from '../api/researchInbox';
vi.mock('../api/researchInbox', () => ({ fetchResearchPortfolios: vi.fn(), fetchPortfolioImpact: vi.fn() }));
const impact = {
  portfolio_name: 'Research portfolio', currency: 'USD',
  coverage: { holdings: 2, with_cited_relationships: 1, unknown_symbols: ['B'], quote_gaps: ['B'], weights_complete: false },
  weight_basis: 'Share of quoted long equity holdings, excluding cash and short positions.',
  interpretation: 'Affected holdings weight is not a predicted loss or quantified business exposure.',
  items: [{ id: 'supplier:s', name: 'Shared supplier', kind: 'supplier', holding_count: 2, portfolio_weight_pct: null, holdings: [
    { symbol: 'A', weight_pct: null, business_share_pct: 20, basis: 'disclosed', citation: { quote: '20% of purchases', source_url: 'https://example.com/filing' }, dossiers: [{ id: 'd1', title: 'A thesis' }], quote_provenance: { source: 'yahoo', quality: 'delayed', as_of: null, currency: 'USD', eligible: true, reasons: [] } },
    { symbol: 'B', weight_pct: null, business_share_pct: null, basis: 'unknown', citation: null, dossiers: [], quote_provenance: { source: 'unknown', quality: 'unreported', as_of: null, currency: null, eligible: false, reasons: ['missing_currency'] } }
  ] }]
};
function mount() {
  render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PortfolioResearchImpact /></QueryClientProvider></MemoryRouter>);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchResearchPortfolios).mockResolvedValue([{ id: 'p1', name: 'Research portfolio', currency: 'USD' }]);
  vi.mocked(fetchPortfolioImpact).mockResolvedValue(impact);
});
it('separates quoted weight, disclosed business share, unknown coverage, and portfolio loss', async () => {
  mount();
  expect(await screen.findByText('1 of 2 holdings have cited relationships.')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Shared supplier', { selector: 'summary strong' }));
  expect(screen.getByText(/Relationship unverified/)).toBeInTheDocument();
  expect(screen.getByText(/Quoted holdings weight: Unavailable · Disclosed business share: 20.0%/)).toBeInTheDocument();
  expect(screen.getByText(/not a predicted loss/)).toBeInTheDocument();
  expect(screen.getByText(/Quote: yahoo · delayed · USD · Quote time unknown/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Review A thesis' })).toHaveAttribute('href', '/equity/research-dossiers?id=d1');
  expect(screen.getByRole('link', { name: 'Read cited filing' })).toHaveAttribute('href', 'https://example.com/filing');
});
it('preserves coverage when exploring relationships', async () => {
  mount();
  await screen.findByText('Shared supplier', { selector: 'summary strong' });
  fireEvent.click(screen.getByRole('button', { name: 'Explore relationships' }));
  expect(screen.getByRole('list', { name: 'Relationship map' })).toHaveTextContent('unknown');
  expect(screen.getByText(/Relationship coverage unknown: B/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show ranked list' })).toHaveAttribute('aria-pressed', 'true');
});
it('does not request impact before portfolios exist and gives an actionable empty state', async () => {
  vi.mocked(fetchResearchPortfolios).mockResolvedValue([]);
  mount();
  expect(await screen.findByRole('link', { name: 'Open Portfolio Manager' })).toBeInTheDocument();
  expect(fetchPortfolioImpact).not.toHaveBeenCalled();
});
it('offers retry when quotes or research cannot load', async () => {
  vi.mocked(fetchPortfolioImpact).mockRejectedValue(new Error('network unavailable'));
  mount();
  await screen.findByRole('alert');
  vi.mocked(fetchPortfolioImpact).mockResolvedValue(impact);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.getByText('Shared supplier', { selector: 'summary strong' })).toBeInTheDocument());
});
