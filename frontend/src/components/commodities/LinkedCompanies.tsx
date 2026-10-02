import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { extractApiErrorMessage } from "../../api/base";
import { fetchCommodityCompanies, type LinkedCompany } from "../../api/rawMaterials";
import { TerminalBadge } from "../terminal/TerminalBadge";
import { TerminalPanel } from "../terminal/TerminalPanel";

type MarketFilter = "ALL" | "IN" | "US";

const SENSITIVITY_VARIANT = { high: "danger", medium: "warn", low: "neutral" } as const;

function CompanyRow({ company }: { company: LinkedCompany }) {
  const label = (
    <>
      <span className="font-semibold text-terminal-text">{company.symbol ?? "—"}</span>
      <span className="ml-2 truncate text-terminal-muted">{company.name}</span>
    </>
  );
  return (
    <li className="flex items-center justify-between gap-2 border-b border-terminal-border/40 py-1.5 text-xs last:border-0">
      <div className="min-w-0 truncate">
        {company.symbol ? (
          <Link to={`/equity/security/${encodeURIComponent(company.symbol)}`} className="hover:underline">
            {label}
          </Link>
        ) : (
          label
        )}
        {company.industry ? <div className="truncate text-[10px] text-terminal-muted">{company.industry}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className="text-[10px] text-terminal-muted">{company.market}</span>
        {company.source === "value_chain" ? <TerminalBadge variant="info">filings</TerminalBadge> : null}
        <TerminalBadge variant={SENSITIVITY_VARIANT[company.sensitivity] ?? "neutral"}>{company.sensitivity}</TerminalBadge>
      </div>
    </li>
  );
}

function Group({ title, tone, companies }: { title: string; tone: "pos" | "neg"; companies: LinkedCompany[] }) {
  return (
    <div className="min-w-0 rounded-sm border border-terminal-border bg-terminal-bg p-2">
      <div className={`mb-1 ot-type-label ${tone === "pos" ? "text-terminal-pos" : "text-terminal-neg"}`}>{title}</div>
      {companies.length ? (
        <ul>
          {companies.map((c) => (
            <CompanyRow key={`${c.relation}-${c.symbol ?? c.name}`} company={c} />
          ))}
        </ul>
      ) : (
        <div className="py-2 text-xs text-terminal-muted">No curated companies for this side.</div>
      )}
    </div>
  );
}

export function LinkedCompanies({ commoditySymbol }: { commoditySymbol: string }) {
  const [market, setMarket] = useState<MarketFilter>("ALL");
  const query = useQuery({
    queryKey: ["commodity-companies", commoditySymbol],
    queryFn: () => fetchCommodityCompanies(commoditySymbol),
    enabled: Boolean(commoditySymbol),
    staleTime: 10 * 60 * 1000,
  });
  const companies = (query.data?.companies ?? []).filter((c) => market === "ALL" || c.market === market);
  const hurt = companies.filter((c) => c.relation === "input_cost");
  const helped = companies.filter((c) => c.relation === "output_price");

  return (
    <TerminalPanel
      title="Linked companies"
      subtitle={query.data?.name ? `Who a ${query.data.name} price rise hurts and helps` : "Companies exposed to this commodity"}
      actions={
        <div className="flex gap-1" role="group" aria-label="Market filter">
          {(["ALL", "IN", "US"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={market === m}
              onClick={() => setMarket(m)}
              className={`rounded-sm border px-2 py-0.5 text-[10px] ${market === m ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
            >
              {m}
            </button>
          ))}
        </div>
      }
    >
      {query.isLoading ? (
        <div className="py-4 text-xs text-terminal-muted">Loading linked companies…</div>
      ) : query.isError ? (
        <div className="py-4 text-xs text-terminal-neg">{extractApiErrorMessage(query.error, "Failed to load linked companies")}</div>
      ) : !query.data?.companies.length ? (
        <div className="py-4 text-xs text-terminal-muted">No linked companies are curated for {commoditySymbol} yet.</div>
      ) : (
        <div className="space-y-2">
          {query.data.impact_note ? <p className="text-xs text-terminal-muted">{query.data.impact_note}</p> : null}
          <div className="grid gap-2 md:grid-cols-2">
            <Group title="Hurt by a price rise (input cost)" tone="neg" companies={hurt} />
            <Group title="Helped by a price rise (output price)" tone="pos" companies={helped} />
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
