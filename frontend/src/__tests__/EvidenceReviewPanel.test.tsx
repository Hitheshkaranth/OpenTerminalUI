import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EvidenceChange } from '../components/research/EvidenceReviewPanel';
describe('evidence review payloads', () => {
  it('renders screen rule arrays and symbol evidence', () => {
    render(<EvidenceChange change={{ kind: 'entered', symbol: 'ACME', before: { roe: 19 }, after: { roe: 21 }, rules: ['roe > 20', 'pe < 25'] }}/>);
    expect(screen.getByText(/Changed conditions: roe > 20; pe < 25/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ACME: Observation' })).toBeInTheDocument();
  });
  it('uses nested condition units, evidence period and first-observation previous value', () => {
    render(<EvidenceChange change={{ kind: 'condition_changed', before: null, after: { value: 17.4, previous_value: 19.2, status: 'breached', condition: { label: 'Operating margin', unit: '%', threshold: 18, operator: 'gte' }, evidence: { period: 'FY2026 Q2', quote: 'Margin was 17.4%.', source_url: 'https://example.com/results' } } }}/>);
    expect(screen.getByText('19.2 %')).toBeInTheDocument();
    expect(screen.getByText('17.4 %')).toBeInTheDocument();
    expect(screen.getByText('Period: FY2026 Q2')).toBeInTheDocument();
    expect(screen.getByText('Assumption: Operating margin ≥ 18 %')).toBeInTheDocument();
  });
  it('compares earnings expectations and actuals with sources and missing guidance', () => {
    render(<EvidenceChange change={{ kind: 'earnings_review', after: { period: 'FY2026 Q2', metrics: [{ metric: 'eps', label: 'EPS', unit: 'USD/share', expected: 2, actual: 1.75, quote: 'EPS was $1.75.', source_url: 'https://example.com/results' }] } }}/>);
    expect(screen.getByText('2 USD/share')).toBeInTheDocument();
    expect(screen.getByText('1.75 USD/share')).toBeInTheDocument();
    expect(screen.getByText('-0.25 USD/share')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open source document' })).toHaveAttribute('href', 'https://example.com/results');
  });
});
