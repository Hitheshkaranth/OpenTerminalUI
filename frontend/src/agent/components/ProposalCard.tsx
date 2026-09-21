import { useState } from "react";
import { confirmProposal, rejectProposal, type ProposalItem } from "../../api/agentExtras";

type Status = ProposalItem["status"];

const TYPE_COLORS: Record<string, string> = {
  paper_order: "text-terminal-accent border-terminal-accent/60",
  alert: "text-terminal-warn border-terminal-warn/60",
  watchlist_add: "text-terminal-info border-terminal-info/60",
};

export function ProposalCard({ proposal }: { proposal: ProposalItem }) {
  const [status, setStatus] = useState<Status>(proposal.status);
  const [pendingAction, setPendingAction] = useState<"confirm" | "reject" | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [errorDetail, setErrorDetail] = useState<string>("");

  const canAct = status === "pending";
  const decided = status === "confirmed" || status === "rejected" || status === "expired" || status === "failed";

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
          setErrorDetail("Order confirmed");
        }
      } else {
        setStatus("failed");
        setErrorDetail("Order execution failed");
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
      {result && (
        <div className="border-b border-terminal-border/60 px-2.5 py-1.5 text-[11px] text-terminal-pos">
          ✓ {JSON.stringify(result)}
        </div>
      )}
      {errorDetail && status === "failed" && (
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
            {pendingAction === "confirm" ? "…" : "Confirm"}
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
      {decided && (
        <div className="border-t border-terminal-border/60 px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-terminal-muted">
          {status}
        </div>
      )}
    </div>
  );
}