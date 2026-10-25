import { useEffect, useState } from "react";
import { confirmProposal, getProposal, rejectProposal, type ProposalItem } from "../../api/agentExtras";

type Status = ProposalItem["status"];

const TYPE_COLORS: Record<string, string> = {
  paper_order: "text-terminal-accent border-terminal-accent/60",
  alert: "text-terminal-warn border-terminal-warn/60",
  watchlist_add: "text-terminal-info border-terminal-info/60",
};

export function ProposalCard({ proposal: initial }: { proposal: ProposalItem }) {
  const [proposal, setProposal] = useState(initial);
  const [detailsReady, setDetailsReady] = useState(!!initial.expires_at);
  const [status, setStatus] = useState<Status>(proposal.status);
  const [pendingAction, setPendingAction] = useState<"confirm" | "reject" | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [errorDetail, setErrorDetail] = useState<string>("");

  const canAct = status === "pending" && detailsReady;
  const decided = status === "confirmed" || status === "rejected" || status === "expired" || status === "failed";
  useEffect(() => {
    if (initial.expires_at) return;
    let current = true;
    getProposal(initial.proposal_id).then((full) => { if (current) { setProposal(full); setStatus(full.status); setDetailsReady(true); } })
      .catch(() => { if (current) setErrorDetail("Unable to load proposal details. Reconnect before reviewing this action."); });
    return () => { current = false; };
  }, [initial.proposal_id, initial.expires_at]);
  const labels: Record<string, string> = { paper_order: "Confirm paper order", rebalance: "Confirm paper rebalance", journal_entry: "Save research note", watchlist_add: "Add to watchlist", watchlist_remove: "Remove from watchlist", alert: "Create alert", screener_alert: "Create screen alert" };
  const payload = proposal.payload || {};
  const deltas = Array.isArray(payload.deltas) ? payload.deltas as Record<string, unknown>[] : [];
  const profile = payload.execution_profile as Record<string, unknown> | undefined;
  const number = (value: unknown, percent = false) => typeof value === "number" && Number.isFinite(value) ? `${(percent ? value * 100 : value).toLocaleString(undefined, { maximumFractionDigits: percent ? 2 : 6 })}${percent ? "%" : ""}` : "Unavailable";

  const handleConfirm = async () => {
    setPendingAction("confirm");
    try {
      const resp = await confirmProposal(proposal.proposal_id);
      setResult(resp.result ?? null);
      if (resp.status === "confirmed") {
        setStatus("confirmed");
        // Show order id or fill status from result
        const orderId = (resp.result as Record<string, unknown>)?.order_id;
        if (orderId) {
          setErrorDetail(`Order placed: ${String(orderId)}`);
        } else {
          setErrorDetail("Action completed");
        }
      } else if (resp.status === "executing") {
        setStatus("executing");
        setErrorDetail("Action is executing. Reconnect to check its result.");
      } else {
        setStatus("failed");
        setErrorDetail(String(resp.result?.error || "Action could not be completed"));
      }
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setStatus("failed");
      setErrorDetail(typeof detail === "string" ? detail : "Confirmation failed");
    } finally {
      setPendingAction(null);
    }
  };

  const handleReject = async () => {
    setPendingAction("reject");
    try {
      await rejectProposal(proposal.proposal_id);
      setStatus("rejected");
    } catch {
      setErrorDetail("Rejection failed");
    } finally {
      setPendingAction(null);
    }
  };

  const colorClass = TYPE_COLORS[proposal.type] || "text-terminal-muted border-terminal-border";

  return (
    <div className="overflow-hidden rounded-md border border-terminal-border bg-terminal-panel/80">
      <div className="flex items-center justify-between border-b border-terminal-border/60 px-2.5 py-1.5">
        <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${colorClass}`}>
          {proposal.type.replace("_", " ")}
        </span>
        <span className="font-mono text-[10px] text-terminal-muted">{proposal.proposal_id}</span>
      </div>
      <div className="px-2.5 py-2 text-xs leading-5 text-terminal-text">
        {proposal.summary}
      </div>
      {(proposal.type === "rebalance" || proposal.type === "paper_order") && <p className="px-3 py-2 text-sm font-semibold">Paper portfolio only. No live broker orders.</p>}
      {proposal.type === "rebalance" && <div className="overflow-x-auto px-3 pb-3 text-xs"><table className="w-full text-right"><caption className="mb-2 text-left">Review proposed trades · valued {String(payload.valued_at || "at an unavailable time")}</caption><thead><tr><th className="text-left">Symbol</th><th>Current</th><th>Target</th><th>Quantity change</th><th>Marked price</th></tr></thead><tbody>{deltas.map((delta) => <tr key={String(delta.symbol)} className="border-t border-terminal-border"><th className="py-2 text-left">{String(delta.symbol)}</th><td>{number(delta.current_weight, true)}</td><td>{number(delta.target_weight, true)}</td><td>{number(delta.implied_delta_qty)}</td><td>{number(delta.price_used)}</td></tr>)}</tbody></table>
        <p>Cash reserve: {number(payload.cash_reserve)} · Slippage: {number(profile?.slippage_bps)} bps · Commission: {number(profile?.commission_bps)} bps</p><p className="mt-1 text-terminal-muted">Changed holdings or quote drift above {number(profile?.max_price_drift_pct)}% require a fresh proposal.</p>
      </div>}
      {proposal.type === "paper_order" && <p className="px-3 pb-3 text-sm">{String(payload.side || "")} {number(payload.quantity)} {String(payload.symbol || "")}</p>}
      {proposal.type === "journal_entry" && <p className="whitespace-pre-wrap px-3 pb-3 text-sm">{String(payload.body || "")}</p>}
      {(proposal.type === "watchlist_add" || proposal.type === "watchlist_remove") && <p className="px-3 pb-3 text-sm">Symbols: {Array.isArray(payload.symbols) ? payload.symbols.join(", ") : String(payload.symbol || "")}</p>}
      {proposal.rationale && <p className="px-3 pb-3 text-xs text-terminal-muted">{proposal.rationale}</p>}
      {!detailsReady && !errorDetail && <p role="status" className="px-3 pb-3 text-xs">Loading action details…</p>}
      {result && status === "confirmed" && (
        <div className="border-b border-terminal-border/60 px-2.5 py-1.5 text-[11px] text-terminal-pos">
          ✓ {result.order_id ? `Paper order ${String(result.order_id)}` : `${labels[proposal.type] || "Action"}: completed`}
        </div>
      )}
      {errorDetail && (status === "failed" || !detailsReady || status === "executing") && (
        <div className="border-b border-terminal-border/60 px-2.5 py-1.5 text-[11px] text-terminal-neg">
          ✗ {errorDetail}
        </div>
      )}
      {canAct && (
        <div className="flex gap-2 border-t border-terminal-border/60 px-2.5 py-2">
          <button
            onClick={handleConfirm}
            disabled={pendingAction !== null}
            className="rounded border border-terminal-pos/60 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-terminal-pos transition-colors hover:bg-terminal-pos/10 disabled:opacity-40"
          >
            {pendingAction === "confirm" ? "Applying…" : labels[proposal.type] || "Confirm action"}
          </button>
          <button
            onClick={handleReject}
            disabled={pendingAction !== null}
            className="rounded border border-terminal-border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-terminal-muted transition-colors hover:text-terminal-text disabled:opacity-40"
          >
            {pendingAction === "reject" ? "…" : "Reject"}
          </button>
        </div>
      )}
      {(decided || status === "executing") && (
        <div className="border-t border-terminal-border/60 px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-terminal-muted">
          {status}
        </div>
      )}
    </div>
  );
}
