import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  askFilings,
  buildAnalysis,
  buildKnowledge,
  deleteDocument,
  fetchAnalysis,
  fetchAutoImport,
  fetchDocuments,
  fetchKnowledge,
  uploadDocument,
  type Analysis,
  type Citation,
  type Document,
  type Finding,
  type Knowledge,
} from "../api/filingsRag";

import { FilingsWorkspace } from "../components/filings/FilingsWorkspace";
import { GrowthHeadwindsSummary } from "../components/filings/GrowthHeadwindsSummary";
import { ConcallSummaries } from "../components/filings/ConcallSummaries";
import { GuidanceTracker } from "../components/filings/GuidanceTracker";

vi.mock("../api/filingsRag", () => ({
  fetchDocuments: vi.fn(),
  fetchAnalysis: vi.fn(),
  buildAnalysis: vi.fn(),
  uploadDocument: vi.fn(),
  deleteDocument: vi.fn(),
  fetchAutoImport: vi.fn(),
  askFilings: vi.fn(),
  fetchKnowledge: vi.fn(),
  buildKnowledge: vi.fn(),
}));

const doc: () => Document = () => ({
  id: 1,
  symbol: "TEST",
  doc_type: "concall_transcript",
  title: "Q2 FY25 Earnings Call",
  period: "FY25-Q2",
  source: "upload",
  source_url: null,
  filed_at: "2025-10-01T00:00:00Z",
  pages: 18,
  chunks: 42,
  chars: 30000,
  created_at: "2025-10-05T00:00:00Z",
});

const citation: () => Citation = () => ({
  doc_id: 1,
  title: "Annual Report 2025",
  page_start: 12,
  page_end: 12,
  section: "Management Discussion",
  quote: "The order book reached 4200 Cr in FY25.",
  source_url: "https://example.com/ar-2025.pdf",
});

const finding: () => Finding = () => ({
  claim: "The order book reached 4200 Cr in FY25.",
  metric: "order_book",
  value: 4200,
  unit: "Cr",
  period: "FY25",
  magnitude: "high",
  confidence: 0.87,
  citation: citation(),
});

const analysis: () => Analysis = () => ({
  symbol: "TEST",
  created_at: "2026-01-01T00:00:00Z",
  engine: "llm",
  model: "test-model",
  documents_used: 2,
  scores: { growth: 62, headwind: 31, net: 31 },
  stance: "constructive",
  growth: [
    {
      id: "order-book",
      label: "Order Book / Backlog",
      kind: "growth",
      summary: "Rising booked orders.",
      strength: 78,
      findings: [finding()],
    },
  ],
  headwinds: [],
  coverage: [],
  warnings: [],
});

const knowledge: () => Knowledge = () => ({
  symbol: "TEST",
  created_at: "2026-01-01T00:00:00Z",
  engine: "llm",
  concalls: [
    {
      doc_id: 3,
      title: "Q4 FY24 Earnings Call",
      period: "FY24-Q4",
      filed_at: "2024-07-20T00:00:00Z",
      engine: "llm",
      highlights: ["Margin expansion into FY26", "Order momentum sustained"],
      management_tone: "positive",
      key_numbers: [{ label: "Revenue", value: 1500, unit: "Cr" }],
      qa_themes: ["Capex phasing", "FX headwinds"],
      citations: [citation()],
    },
  ],
  guidance: [
    {
      metric: "Operating margin",
      statement: "We target 20% operating margin.",
      target: "20%",
      period: "FY26",
      said_in: { doc_id: 1, title: "Annual Report", period: "FY24" },
      status: "raised",
      citation: citation(),
    },
    {
      metric: "Revenue",
      statement: "We aim for 15% growth.",
      target: "15%",
      period: "FY25",
      said_in: { doc_id: 1, title: "Annual Report", period: "FY24" },
      status: "missed",
      citation: citation(),
    },
  ],
  warnings: [],
});

beforeEach(() => {
  fetchDocuments.mockResolvedValue({ symbol: "TEST", documents: [] });
  fetchAnalysis.mockResolvedValue(null);
  buildAnalysis.mockResolvedValue(null);
  uploadDocument.mockResolvedValue(null);
  deleteDocument.mockResolvedValue(undefined);
  fetchAutoImport.mockResolvedValue(null);
  askFilings.mockResolvedValue(null);
  fetchKnowledge.mockResolvedValue(null);
  buildKnowledge.mockResolvedValue(null);
});

describe("FilingsWorkspace", () => {
  it("renders imported documents", async () => {
    fetchDocuments.mockResolvedValue({ symbol: "TEST", documents: [doc()] });

    render(<FilingsWorkspace symbol="TEST" />);

    expect(await screen.findByText("Q2 FY25 Earnings Call")).toBeTruthy();
  });

  it("renders a cited analysis with a p.12 citation and stance badge", async () => {
    fetchDocuments.mockResolvedValue({ symbol: "TEST", documents: [doc()] });
    fetchAnalysis.mockResolvedValue(analysis());

    render(<FilingsWorkspace symbol="TEST" />);

    expect(await screen.findByText("The order book reached 4200 Cr in FY25.")).toBeTruthy();
    expect(screen.getByText(/p\.12/)).toBeTruthy();
    expect(screen.getByText("Constructive")).toBeTruthy();
    expect(screen.getByText("4,200 Cr · FY25")).toBeTruthy();
    expect(screen.getByText(/87%/)).toBeTruthy();
  });

  it("disables the Analyze button when there are no documents", async () => {
    fetchDocuments.mockResolvedValue({ symbol: "TEST", documents: [] });

    render(<FilingsWorkspace symbol="TEST" />);

    const analyze = await screen.findByRole("button", { name: "Analyze" });
    expect(analyze).toBeDisabled();
  });

  it("sends use_llm to the analyze endpoint", async () => {
    fetchDocuments.mockResolvedValue({ symbol: "TEST", documents: [doc()] });
    fetchAnalysis.mockResolvedValue(null);
    buildAnalysis.mockResolvedValue(analysis());

    render(<FilingsWorkspace symbol="TEST" />);

    const analyze = await screen.findByRole("button", { name: "Analyze" });
    fireEvent.click(analyze);

    await waitFor(() => {
      expect(buildAnalysis).toHaveBeenCalledWith("TEST", { use_llm: true });
    });
  });
});

describe("GrowthHeadwindsSummary", () => {
  it("renders the stance badge and top drivers", async () => {
    fetchAnalysis.mockResolvedValue(analysis());

    render(<GrowthHeadwindsSummary symbol="TEST" onOpenFilings={() => {}} />);

    expect(await screen.findByText("Constructive")).toBeTruthy();
    expect(screen.getByText("Order Book / Backlog")).toBeTruthy();
    expect(screen.getByText("62")).toBeTruthy();
  });
});

describe("ConcallSummaries", () => {
  it("renders call highlights", async () => {
    fetchKnowledge.mockResolvedValue(knowledge());

    render(<ConcallSummaries symbol="TEST" />);

    expect(await screen.findByText("Margin expansion into FY26")).toBeTruthy();
    expect(screen.getByText("Order momentum sustained")).toBeTruthy();
    expect(screen.getByText("Positive")).toBeTruthy();
  });
});

describe("GuidanceTracker", () => {
  it("renders a status badge per guidance item", async () => {
    fetchKnowledge.mockResolvedValue(knowledge());

    render(<GuidanceTracker symbol="TEST" />);

    expect(await screen.findByText("Operating margin")).toBeTruthy();
    expect(screen.getByText("Raised")).toBeTruthy();
    expect(screen.getByText("Missed")).toBeTruthy();
    expect(screen.getByText("FY26")).toBeTruthy();
  });
});

// Keep the value imports referenced even if a future refactor drops a caller.
void [askFilings, buildAnalysis, buildKnowledge, deleteDocument, fetchAutoImport, uploadDocument];