import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { fetchValueChain, extractValueChain, type ChainNode, type ValueChain } from "../../api/businessResearch";
import { TerminalBadge } from "../terminal/TerminalBadge";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { TerminalTable } from "../terminal/TerminalTable";
import { CitationHint } from "./citations";
import { AiThinking } from "../ai/AiVisuals";

export type ValueChainSectionProps = { symbol: string; market?: string };

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

function pctColor(value: number | null): string {
  if (value == null) return "text-terminal-muted";
  if (value < 0) return "text-terminal-neg";
  if (value > 0) return "text-terminal-pos";
  return "text-terminal-text";
}

const ORIGIN_META: Record<ChainNode["origin"], { label: string; variant: "accent" | "info" | "neutral" }> = {
  filings: { label: "Filings", variant: "accent" },
  peers: { label: "Peers", variant: "info" },
  curated: { label: "Curated", variant: "neutral" },
};

function OriginBadge({ origin }: { origin: (typeof ORIGIN_META)[ChainNode["origin"]] }) {
  return <TerminalBadge variant={origin.variant} size="sm">{origin.label}</TerminalBadge>;
}

function NodeCard({ node }: { node: ChainNode }) {
  const link = node.symbol ? `/equity/security/${node.symbol}` : null;
  return (
    <div className="flex items-start justify-between gap-2 rounded-sm border border-terminal-border bg-terminal-panel p-2.5">
      <div className="min-w-0">
        {link ? (
          <Link
            to={link}
            className="truncate ot-type-label text-[11px] font-medium text-terminal-text hover:text-terminal-accent"
          >
            {node.name || "—"}
          </Link>
        ) : (
          <div className="truncate ot-type-label text-[11px] text-terminal-text">{node.name || "—"}</div>
        )}
        {node.detail ? <div className="mt-0.5 truncate text-terminal-muted text-[10px]">{node.detail}</div> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {node.share_pct != null ? (
          <span className="rounded border border-terminal-border bg-terminal-bg px-1.5 py-0.5 ot-type-data text-[10px] text-terminal-text">
            {fmtPct(node.share_pct)}
          </span>
        ) : null}
        <div className="flex items-center gap-1">
          <OriginBadge origin={ORIGIN_META[node.origin]} />
          <CitationHint citation={node.citation} />
        </div>
      </div>
    </div>
  );
}

function ChainColumn({ title, nodes, emptyText }: { title: string; nodes: ChainNode[]; emptyText: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="ot-type-label text-[11px] uppercase text-terminal-muted">
        {title}
        <span className="ml-1 text-terminal-muted">{nodes.length}</span>
      </h4>
      {nodes?.length ? (
        <div className="flex flex-col gap-2">{nodes.map((node) => <NodeCard key={node.name} node={node} />)}</div>
      ) : (
        <div className="rounded-sm border border-dashed border-terminal-border bg-terminal-panel px-2.5 py-6 text-center text-terminal-muted text-[10px]">
          {emptyText}
        </div>
      )}
    </div>
  );
}

function CompetitorsRow({ competitors }: { competitors: ChainNode[] }) {
  if (!competitors?.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <h4 className="ot-type-label text-[11px] uppercase text-terminal-muted">Competitors</h4>
      <div className="flex flex-wrap gap-2">{competitors.map((node) => <NodeCard key={node.name} node={node} />)}</div>
    </div>
  );
}

function MaterialName({ material }: { material: { commodity_symbol: string | null; name: string } }) {
  const link = material.commodity_symbol ? `/equity/commodities?symbol=${encodeURIComponent(material.commodity_symbol)}` : null;
  return (
    <div className="min-w-0">
      <div className="truncate ot-type-data text-[11px] text-terminal-text">{material.name || "—"}</div>
      {link ? (
        <Link to={link} className="truncate ot-type-label text-[10px] text-terminal-accent hover:text-terminal-accent/80">
          {material.commodity_symbol}
        </Link>
      ) : null}
    </div>
  );
}

function RawMaterialsTable({ materials }: { materials: ValueChain["raw_materials"] }) {
  return (
    <TerminalTable
      density="compact"
      emptyText="No raw materials mapped."
      rowKey={(r) => r.name}
      columns={[
        {
          key: "name",
          label: "Material",
          render: (r) => <MaterialName material={r} />,
        },
        {
          key: "price",
          label: "Price",
          align: "right",
          render: (r) =>
            r.price != null && r.currency ? (
              <span className="ot-type-data text-[11px] text-terminal-text">
                {(r.price).toLocaleString("en-US", { maximumFractionDigits: 2 })}{" "}
                <span className="text-terminal-muted">{r.currency}</span>
              </span>
            ) : (
              <span className="text-terminal-muted">—</span>
            ),
        },
        {
          key: "change_1m",
          label: "1M %",
          align: "right",
          render: (r) => <span className={pctColor(r.change_1m_pct)}>{fmtPct(r.change_1m_pct)}</span>,
        },
        {
          key: "change_1y",
          label: "1Y %",
          align: "right",
          render: (r) => <span className={pctColor(r.change_1y_pct)}>{fmtPct(r.change_1y_pct)}</span>,
        },
        {
          key: "cost_share",
          label: "Cost share",
          align: "right",
          render: (r) =>
            r.cost_share_pct != null ? (
              <span className="ot-type-data text-[11px] text-terminal-text">{fmtPct(r.cost_share_pct)}</span>
            ) : (
              <span className="text-terminal-muted">—</span>
            ),
        },
      ]}
      rows={materials}
    />
  );
}

function HasWarnings({ warnings }: { warnings: string[] }) {
  if (!warnings?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" role="alert">
      {warnings.map((warning, idx) => (
        <span
          key={idx}
          className="rounded-sm border border-terminal-warn bg-terminal-warn/10 px-2 py-0.5 ot-type-ui text-[10px] text-terminal-warn"
        >
          {warning}
        </span>
      ))}
    </div>
  );
}

function valueChainIsEmpty(value: ValueChain | null): boolean {
  if (!value) return true;
  return (
    !value.suppliers?.length &&
    !value.customers?.length &&
    !value.competitors?.length &&
    !value.raw_materials?.length
  );
}

export function ValueChainSection({ symbol }: ValueChainSectionProps) {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["value-chain", symbol],
    queryFn: () => fetchValueChain(symbol),
    enabled: Boolean(symbol),
    staleTime: 10 * 60 * 1000,
  });

  const extractMutation = useMutation({
    mutationFn: () => extractValueChain(symbol),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["value-chain", symbol] });
      void refetch();
    },
  });

  const valueChain = data ?? null;

  if (isLoading) {
    return (
      <TerminalPanel title="Value chain" subtitle="Loading…">
        <div className="px-2.5 py-6 text-terminal-muted text-[11px]">Loading value chain…</div>
      </TerminalPanel>
    );
  }

  if (isError) {
    return (
      <TerminalPanel title="Value chain" subtitle="Error">
        <div className="px-2.5 py-6">
          <div className="rounded-sm border border-terminal-neg bg-terminal-neg/10 px-3 py-2 ot-type-ui text-[11px] text-terminal-neg">
            {error instanceof Error ? error.message : "Failed to load value chain."}
          </div>
        </div>
      </TerminalPanel>
    );
  }

  if (!valueChain || valueChainIsEmpty(valueChain)) {
    return (
      <TerminalPanel
        title="Value chain"
        subtitle="Not mapped yet"
        actions={
          <span className="flex items-center gap-2">
            {extractMutation.isPending ? <AiThinking activity="linking" label="Mapping suppliers and customers…" /> : null}
            <TerminalButton size="sm" loading={extractMutation.isPending} onClick={() => extractMutation.mutate()}>
              Extract from filings
            </TerminalButton>
          </span>
        }
      >
        <div className="flex flex-col gap-3 px-2.5 py-6">
          <div className="rounded-sm border border-terminal-border bg-terminal-panel px-3 py-4 ot-type-ui text-center text-[11px] text-terminal-muted">
            No value chain mapping for this company yet. Extract from filings to populate suppliers, customers, competitors,
            and raw materials.
          </div>
          <TerminalButton size="sm" loading={extractMutation.isPending} onClick={() => extractMutation.mutate()}>
            Extract from filings
          </TerminalButton>
        </div>
      </TerminalPanel>
    );
  }

  return (
    <TerminalPanel
      title="Value chain"
      subtitle={valueChain.industry ? valueChain.industry : "Suppliers · Company · Customers"}
      actions={
        <span className="flex items-center gap-2">
          {extractMutation.isPending ? <AiThinking activity="linking" label="Mapping suppliers and customers…" /> : null}
          <TerminalButton size="sm" variant="accent" loading={extractMutation.isPending} onClick={() => extractMutation.mutate()}>
            Extract from filings
          </TerminalButton>
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <HasWarnings warnings={valueChain.warnings || []} />

        {/* Company sits in a narrow centre column between its suppliers and customers (it was an equal-width
            empty box labelled "[LLY]"). Stacks on narrow screens. */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(150px,200px)_minmax(0,1fr)]">
          <ChainColumn title="Suppliers" nodes={valueChain.suppliers} emptyText="No suppliers mapped." />
          <div className="flex flex-col items-center justify-center gap-1 self-center rounded-sm border border-terminal-accent/40 bg-terminal-accent/5 px-3 py-4 text-center">
            <div className="ot-type-label text-[11px] text-terminal-muted" aria-hidden="true">supplies → </div>
            <div className="ot-type-data text-[16px] font-semibold text-terminal-accent">{valueChain.symbol}</div>
            {valueChain.sector ? <div className="text-[10px] text-terminal-muted">{valueChain.sector}</div> : null}
            <div className="ot-type-label text-[11px] text-terminal-muted" aria-hidden="true">→ sells to</div>
          </div>
          <ChainColumn title="Customers" nodes={valueChain.customers} emptyText="No customers mapped." />
        </div>

        <CompetitorsRow competitors={valueChain.competitors} />

        {valueChain.raw_materials?.length ? (
          <section className="flex flex-col gap-2">
            <h4 className="ot-type-label text-[11px] uppercase text-terminal-muted">Raw materials</h4>
            <div className="overflow-x-auto">
              <RawMaterialsTable materials={valueChain.raw_materials} />
            </div>
          </section>
        ) : (
          <div className="rounded-sm border border-dashed border-terminal-border bg-terminal-panel px-2.5 py-6 text-center text-terminal-muted text-[10px]">
            No raw materials mapped.
          </div>
        )}
      </div>
    </TerminalPanel>
  );
}