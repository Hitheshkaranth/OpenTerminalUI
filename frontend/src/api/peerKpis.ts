import { useQuery } from "@tanstack/react-query";

import { api } from "./base";
import type { PeerResponse } from "../types";

// Typed client for the peer operational-KPI comparison API (see CONTRACT.md).

// Mirrors the shared filings/business Citation shape so it drops straight into
// the terminal CitationHint helper.
export type Citation = {
  doc_id: number;
  title: string;
  page_start: number;
  page_end: number;
  section: string | null;
  quote: string;
  source_url: string | null;
};

export type PeerKpiCell = {
  value: number | null;
  unit: string | null;
  period: string | null;
  citation: Citation | null;
};

export type PeerKpiRow = {
  key: string;
  label: string;
  unit: string | null;
  higher_is_better: boolean | null;
  values: Record<string, PeerKpiCell>;
};

export type PeerKpiTable = {
  symbol: string;
  peers: string[];
  rows: PeerKpiRow[];
  financial_rows: PeerKpiRow[];
  missing: string[];
  warnings: string[];
};

export function parsePeerKpis(input: string): string[] {
  return input
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

/** Symbols holding the best value for a row, respecting `higher_is_better`. */
export function bestCells(
  values: Record<string, PeerKpiCell>,
  higher_is_better: boolean | null,
): Set<string> {
  const scored: [string, number][] = Object.entries(values)
    .filter(([, cell]) => cell?.value != null && typeof cell.value === "number")
    .map(([symbol, cell]): [string, number] => [symbol, cell.value as number]);
  if (!scored.length) return new Set<string>();
  const best = higher_is_better
    ? Math.max(...scored.map(([, value]) => value))
    : higher_is_better === false
      ? Math.min(...scored.map(([, value]) => value))
      : null;
  if (best === null) return new Set<string>();
  const out = new Set<string>();
  for (const [symbol, value] of scored) {
    if (value === best) out.add(symbol);
  }
  return out;
}

export function fetchPeerKpis(symbol: string, peers?: string[]): Promise<PeerKpiTable> {
  const params: Record<string, string> = {};
  if (peers && peers.length) {
    params.peers = peers.join(",");
  }
  return api.get<PeerKpiTable>(`/peer-kpis/${symbol}`, { params }).then(({ data }) => data);
}

export function usePeerKpiComparison(
  symbol: string,
  market: string | undefined,
  peers?: string[],
) {
  return useQuery<PeerKpiTable>({
    queryKey: ["peer-kpis", symbol, market, peers?.join(",")],
    queryFn: () => fetchPeerKpis(symbol, peers),
    enabled: Boolean(symbol),
    staleTime: 5 * 60_000,
  });
}

// Re-exported only so callers can type the Peers tab's existing comparison.
export type { PeerResponse };