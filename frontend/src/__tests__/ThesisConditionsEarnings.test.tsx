import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThesisConditions } from "../components/research/ThesisConditions";
import { EarningsReview } from "../components/research/EarningsReview";
import { emptyDossier, type ResearchDossier, type ThesisCondition } from "../api/researchDossiers";
import { api } from "../api/base";

vi.mock("../api/base", () => ({ api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() }, extractApiErrorMessage: (e: Error) => e.message }));
const condition: ThesisCondition = { id: "c1", label: "Operating margin", metric: "operating_margin", operator: "gte", threshold: 18, unit: "%", enabled: true };
const dossier: ResearchDossier = { ...emptyDossier(), id: "d1", symbol: "AAPL", title: "Thesis", revision: 3, created_at: "2026-01-01", updated_at: "2026-01-01", thesis_conditions: [condition] };
function mount(element: React.ReactNode) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{element}</QueryClientProvider>); }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.patch).mockResolvedValue({ data: dossier }); vi.mocked(api.post).mockResolvedValue({ data: dossier }); });

it("distinguishes unknown coverage from a sourced breach and opens its citation", () => {
  const { rerender } = mount(<ThesisConditions dossier={dossier} onSaved={() => {}} />);
  expect(screen.getByText("Unknown")).toBeInTheDocument();
  expect(screen.getByText("Unavailable")).toBeInTheDocument();
  rerender(<QueryClientProvider client={new QueryClient()}><ThesisConditions dossier={{ ...dossier, condition_status: [{ condition, condition_id: "c1", status: "breached", value: 17.4, previous_value: 19, reason: "Margin breached", evidence: { id: "e1", claim: "Margin", stance: "neutral", quote: "Operating margin was 17.4%", source_url: "https://example.com/results", published_at: "2025-07-01" } }] }} onSaved={() => {}} /></QueryClientProvider>);
  expect(screen.getByText("Breached")).toBeInTheDocument();
  expect(screen.getByText("Previously 19 %")).toBeInTheDocument();
  fireEvent.click(screen.getByText("View evidence"));
  expect(screen.getByRole("link", { name: "Open source" })).toHaveAttribute("href", "https://example.com/results");
});

it("saves a measurable assumption with optimistic concurrency", async () => {
  mount(<ThesisConditions dossier={{ ...dossier, thesis_conditions: [] }} onSaved={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Add assumption" }));
  fireEvent.change(screen.getByLabelText("Assumption name"), { target: { value: "Margin stays above 18%" } });
  fireEvent.click(screen.getByRole("button", { name: "Save assumption" }));
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/research/dossiers/d1", expect.objectContaining({ expected_revision: 3, thesis_conditions: [expect.objectContaining({ threshold: 18, metric: "operating_margin", unit: "%" })] })));
});

it("records source-backed observations without modifying the thesis", async () => {
  mount(<ThesisConditions dossier={dossier} onSaved={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Record observation" }));
  fireEvent.change(screen.getByLabelText("Reported value (%)"), { target: { value: "17.4" } });
  fireEvent.change(screen.getByLabelText("Observation fiscal period"), { target: { value: "FY2025 Q2" } });
  fireEvent.change(screen.getByLabelText("Observation publication date"), { target: { value: "2025-07-01" } });
  fireEvent.change(screen.getByLabelText("Observation source URL"), { target: { value: "https://example.com/results" } });
  fireEvent.change(screen.getByLabelText("Exact source quotation"), { target: { value: "Operating margin was 17.4%" } });
  fireEvent.click(screen.getByRole("button", { name: "Save observation" }));
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/research/dossiers/d1", expect.objectContaining({ evidence: [expect.objectContaining({ value: 17.4, period: "FY2025 Q2", published_at: "2025-07-01T00:00:00Z" })] })));
  expect(vi.mocked(api.patch).mock.calls[0][1]).not.toHaveProperty("thesis");
});

it("freezes original expectations in the outcome editor and saves source evidence", async () => {
  const review = { id: "r1", period: "FY2025 Q2", recorded_at: "2025-04-01T00:00:00Z", notes: "", metrics: [{ metric: "operating_margin", label: "Operating margin", unit: "%", expected: 19, guidance_low: 18, guidance_high: 20 }] };
  mount(<EarningsReview dossier={{ ...dossier, earnings_reviews: [review] }} onSaved={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Review FY2025 Q2 results" }));
  expect(screen.getByLabelText("Your expectation")).toHaveAttribute("readonly");
  fireEvent.change(screen.getByLabelText("Reported actual"), { target: { value: "17.4" } });
  fireEvent.change(screen.getByLabelText("Results publication date"), { target: { value: "2025-07-01" } });
  fireEvent.change(screen.getByLabelText("Results source URL"), { target: { value: "https://example.com/results" } });
  fireEvent.change(screen.getByLabelText("Results exact quotation"), { target: { value: "Operating margin was 17.4%." } });
  fireEvent.click(screen.getByRole("button", { name: "Save earnings review" }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith("/research/dossiers/d1/earnings-reviews", expect.objectContaining({ expected_revision: 3, review: expect.objectContaining({ metrics: [expect.objectContaining({ expected: 19, actual: 17.4, source_url: "https://example.com/results" })] }) })));
});

it("shows unavailable values and retrospective forecasts without invented consensus", () => {
  mount(<EarningsReview dossier={{ ...dossier, earnings_reviews: [{ id: "r1", period: "FY2025 Q2", recorded_at: "2026-01-01", notes: "", metrics: [{ metric: "margin", label: "Margin", unit: "%", actual: 17, expected: 18, quote: "Margin was 17%", published_at: "2025-07-01", source_url: "https://example.com/results" }] }] }} onSaved={() => {}} />);
  expect(screen.getByText("Unavailable")).toBeInTheDocument();
  expect(screen.getByText("-1 percentage points")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Reported source"));
  expect(screen.getByText(/retrospective comparison/)).toBeInTheDocument();
});

it("offers explicit thesis thresholds for review without auto-saving them", () => {
  mount(<ThesisConditions dossier={{ ...dossier, thesis: 'Revenue growth stays above 15%.', thesis_conditions: [] }} onSaved={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /Review suggestion: Revenue growth stays above 15%/ }));
  expect(screen.getByLabelText('Threshold')).toHaveValue(15);
  expect(screen.getByLabelText('Metric')).toHaveValue('revenue_growth');
  expect(api.patch).not.toHaveBeenCalled();
});

it("delivery history excludes retrospective guidance comparisons", () => {
  mount(<EarningsReview dossier={{ ...dossier, earnings_reviews: [{ id: 'past', period: 'FY2025 Q2', recorded_at: '2026-01-01', notes: '', metrics: [{ metric: 'margin', label: 'Margin', unit: '%', actual: 17, guidance_low: 18, guidance_high: 20, guidance_source_url: 'https://example.com/guidance', guidance_quote: '18 to 20%', published_at: '2025-07-01', source_url: 'https://example.com/results', quote: '17%' }] }] }} onSaved={() => {}} />);
  expect(screen.getByLabelText('Management delivery history')).toHaveTextContent('0 within guidance · 0 above · 0 below');
});

it("counts only the latest pre-publication guidance for each metric-period", () => {
  const metric = { metric: 'margin', label: 'Margin', unit: '%', actual: 17, guidance_low: 18, guidance_high: 20, guidance_source_url: 'https://example.com/guidance', guidance_quote: '18 to 20%', published_at: '2025-07-01', source_url: 'https://example.com/results', quote: '17%' };
  mount(<EarningsReview dossier={{ ...dossier, earnings_reviews: [
    { id: 'original', period: 'FY2025 Q2', recorded_at: '2025-04-01', notes: '', metrics: [metric] },
    { id: 'revised', period: 'FY2025 Q2', recorded_at: '2025-06-01', notes: '', metrics: [{ ...metric, guidance_low: 16, guidance_high: 18 }] },
  ] }} onSaved={() => {}} />);
  expect(screen.getByLabelText('Management delivery history')).toHaveTextContent('1 within guidance · 0 above · 0 below');
});
