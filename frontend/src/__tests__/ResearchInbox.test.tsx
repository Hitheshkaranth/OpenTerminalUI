import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResearchInbox } from '../components/research/ResearchInbox';
import { fetchResearchInbox, reviewResearchEvent, type ResearchInbox as InboxResponse } from '../api/researchInbox';
vi.mock('../api/researchInbox', () => ({ fetchResearchInbox: vi.fn(), reviewResearchEvent: vi.fn() }));
let data: InboxResponse;
function wrap() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter><ResearchInbox/></MemoryRouter></QueryClientProvider>); }
beforeEach(() => {
  vi.clearAllMocks();
  data = { items: [{ id: 'dossier:d:2', kind: 'thesis', symbol: 'ACME', title: 'ACME margin changed', reason: 'Margin breached your threshold', priority: 'high', occurred_at: '2026-10-30T12:00:00Z', source_url: '/equity/research-dossiers?dossier=d', dossier_id: 'd', upcoming: false, status: 'needs_review', bucket: 'needs_review', snoozed_until: null, changes: [{ reason: 'Margin below 18%', before: { value: 19.2, unit: '%' }, after: { status: 'breached', value: 17.4, unit: '%', evidence: { quote: 'Operating margin was 17.4%.', source_url: 'https://example.com/filing', page: 4 } } }] }], counts: { needs_review: 1, upcoming: 0, reviewed: 0 }, coverage: { dossiers: 2, enabled: 2, checked: 1, awaiting_check: 1, disabled: 0, last_checked_at: null, scope: 'Local filings only', screen_schedules: 0 } };
  vi.mocked(fetchResearchInbox).mockImplementation(async () => structuredClone(data));
  vi.mocked(reviewResearchEvent).mockImplementation(async (_, status) => { data.items[0].status = status; data.items[0].bucket = status === 'reviewed' ? 'reviewed' : status === 'snoozed' ? 'upcoming' : 'needs_review'; data.counts = { needs_review: 0, upcoming: 0, reviewed: 0 }; data.counts[data.items[0].bucket] = 1; });
});
describe('Today research inbox', () => {
  it('shows coverage, cited evidence, acknowledgement and undo', async () => {
    const user = userEvent.setup(); wrap();
    expect(await screen.findByText(/Previously checked 1 of 2/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /ACME margin changed/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Operating margin was 17.4%.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open source document' })).toHaveAttribute('href', 'https://example.com/filing');
    await user.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    expect(await screen.findByRole('button', { name: 'Reopen review' })).toBeInTheDocument();
    expect(reviewResearchEvent).toHaveBeenCalledWith('dossier:d:2', 'reviewed', undefined);
    await user.click(screen.getByRole('button', { name: 'Close evidence review' }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(reviewResearchEvent).toHaveBeenLastCalledWith('dossier:d:2', 'needs_review', undefined));
  });
  it('snoozes until a future timestamp and retains evidence', async () => {
    const user = userEvent.setup(); wrap();
    await user.click(await screen.findByRole('button', { name: /ACME margin changed/ }));
    await user.click(screen.getByRole('button', { name: 'Snooze for 24 hours' }));
    await waitFor(() => expect(reviewResearchEvent).toHaveBeenCalled());
    expect(new Date(vi.mocked(reviewResearchEvent).mock.calls[0][2]!).getTime()).toBeGreaterThan(Date.now());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('shows failure rather than an empty success state', async () => {
    vi.mocked(fetchResearchInbox).mockRejectedValue(new Error('Provider disconnected'));
    wrap();
    expect(await screen.findByRole('alert')).toHaveTextContent('Provider disconnected');
    expect(screen.queryByText('No recorded changes need review')).not.toBeInTheDocument();
  });
});

it('does not treat unrun screen schedules as successful checks', async () => {
  data.items = []; data.counts = { needs_review: 0, reviewed: 0, upcoming: 0 };
  data.coverage = { ...data.coverage, dossiers: 0, enabled: 0, checked: 0, awaiting_check: 0, screen_schedules: 1, screen_awaiting_check: 1, screen_checked: 0 };
  wrap();
  expect(await screen.findByText('Waiting for your first checks')).toBeInTheDocument();
  expect(screen.queryByText('No recorded changes need review')).not.toBeInTheDocument();
});
it('reports failed and partial coverage without implying nothing changed', async () => {
  data.items = []; data.counts = { needs_review: 0, reviewed: 0, upcoming: 0 };
  data.coverage = { ...data.coverage, screen_schedules: 2, screen_failed: 1, screen_partial: 1, screen_checked: 2, screen_evaluated: 4, screen_requested: 10 };
  wrap();
  expect(await screen.findByText('No recorded changes; coverage is incomplete')).toBeInTheDocument();
  expect(screen.getByText(/1 failed/)).toHaveTextContent('1 with incomplete coverage');
  expect(screen.getByText(/evaluated 4 of 10/)).toBeInTheDocument();
});
