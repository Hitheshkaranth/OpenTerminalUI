import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { fetchPaperPortfolios } from "../../api/portfolio";
import { fetchWatchlists } from "../../api/watchlist";
import { TerminalBadge } from "../../components/terminal/TerminalBadge";
import { TerminalButton } from "../../components/terminal/TerminalButton";
import { TerminalSelect } from "../../components/terminal/TerminalSelect";
import { TerminalInput } from "../../components/terminal/TerminalInput";
import type { PaperPortfolio, Watchlist } from "../../types";
import type { AlertAction } from "../../api/alertActions";
import { dryRunAlertActions, MAX_ALERT_ACTIONS, validateActions } from "../../api/alertActions";

type Props = {
  value: AlertAction[];
  onChange: (next: AlertAction[]) => void;
  alertId?: string | null;
};

function makePaperAction(): AlertAction {
  return { type: "paper_order", portfolio_id: "", side: "buy", quantity: 1, order_type: "market" };
}

function makeWatchlistAction(): AlertAction {
  return { type: "add_to_watchlist", watchlist_id: "" };
}

function makeWebhookAction(): AlertAction {
  return { type: "webhook", url: "", payload: null };
}

const ACTION_LABELS: Record<string, string> = {
  paper_order: "Paper order",
  add_to_watchlist: "Add to watchlist",
  webhook: "Webhook",
};

export function AlertActionsEditor({ value, onChange, alertId }: Props) {
  const [adding, setAdding] = useState(false);
  const validationError = validateActions(value);

  const { data: portfolios = [], isLoading: portfoliosLoading } = useQuery({
    queryKey: ["paper", "portfolios"],
    queryFn: fetchPaperPortfolios,
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const { data: watchlists = [], isLoading: watchlistsLoading } = useQuery({
    queryKey: ["watchlists"],
    queryFn: fetchWatchlists,
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const queryClient = useQueryClient();

  const { mutate: runDryRun, isPending: dryRunLoading, error: dryRunError } = useMutation({
    mutationFn: dryRunAlertActions,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["paper", "portfolios"] });
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
    },
  });

  function handleAddAction(type: string) {
    if (value.length >= MAX_ALERT_ACTIONS) return;
    let next: AlertAction;
    if (type === "paper_order") next = makePaperAction();
    else if (type === "add_to_watchlist") next = makeWatchlistAction();
    else next = makeWebhookAction();
    onChange([...value, next]);
    setAdding(false);
  }

  function handleRemoveAction(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function updateAction(index: number, action: AlertAction) {
    onChange([...value.slice(0, index), action, ...value.slice(index + 1)]);
  }


  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-terminal-accent">Actions on trigger</div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-terminal-muted">{value.length}/{MAX_ALERT_ACTIONS}</span>
          {value.length < MAX_ALERT_ACTIONS ? (
            <span className="relative">
              {adding ? (
                <TerminalSelect
                  size="sm"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      handleAddAction(e.target.value);
                    }
                  }}
                >
                  <option value="">Add action…</option>
                  <option value="paper_order">Paper order</option>
                  <option value="add_to_watchlist">Add to watchlist</option>
                  <option value="webhook">Webhook</option>
                </TerminalSelect>
              ) : (
                <TerminalButton
                  variant="default"
                  size="sm"
                  onClick={() => setAdding(true)}
                >
                  Add action
                </TerminalButton>
              )}
            </span>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        {value.map((action, index) => (
          <div
            key={index}
            className="flex flex-col gap-2 rounded border border-terminal-border bg-terminal-bg p-2 sm:flex-row sm:items-start"
          >
            <div className="flex items-center gap-2 sm:w-36 sm:flex-shrink-0">
              <TerminalBadge variant="accent">{ACTION_LABELS[action.type] || action.type}</TerminalBadge>
              <TerminalButton
                variant="ghost"
                size="sm"
                className="text-terminal-neg hover:text-terminal-neg"
                onClick={() => handleRemoveAction(index)}
              >
                X
              </TerminalButton>
            </div>

            <div className="flex flex-1 flex-wrap gap-2">
              {action.type === "paper_order" && (
                <>
                  <div className="flex flex-1 flex-col gap-1 sm:w-32">
                    <label className="text-[10px] text-terminal-muted">Portfolio</label>
                    <TerminalSelect
                      size="sm"
                      value={action.portfolio_id}
                      onChange={(e) => updateAction(index, { ...action, portfolio_id: e.target.value })}
                    >
                      {portfolios.length === 0 ? (
                        <option value="" disabled>No paper portfolios — create one in Paper Trading</option>
                      ) : (
                        portfolios.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))
                      )}
                    </TerminalSelect>
                  </div>
                  <div className="flex flex-1 flex-col gap-1 sm:w-24">
                    <label className="text-[10px] text-terminal-muted">Side</label>
                    <TerminalSelect
                      size="sm"
                      value={action.side}
                      onChange={(e) => updateAction(index, { ...action, side: e.target.value as "buy" | "sell" })}
                    >
                      <option value="buy">Buy</option>
                      <option value="sell">Sell</option>
                    </TerminalSelect>
                  </div>
                  <div className="flex flex-1 flex-col gap-1 sm:w-24">
                    <label className="text-[10px] text-terminal-muted">Quantity</label>
                    <TerminalInput
                      size="sm"
                      type="number"
                      min={1}
                      value={String(action.quantity)}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        updateAction(index, { ...action, quantity: isNaN(val) ? 1 : Math.max(1, val) });
                      }}
                    />
                  </div>
                </>
              )}

              {action.type === "add_to_watchlist" && (
                <div className="flex flex-1 flex-col gap-1 sm:w-48">
                  <label className="text-[10px] text-terminal-muted">Watchlist</label>
                  <TerminalSelect
                    size="sm"
                    value={action.watchlist_id}
                    onChange={(e) => updateAction(index, { ...action, watchlist_id: e.target.value })}
                  >
                    {watchlists.length === 0 ? (
                      <option value="" disabled>No watchlists</option>
                    ) : (
                      watchlists.map((w) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))
                    )}
                  </TerminalSelect>
                </div>
              )}

              {action.type === "webhook" && (
                <div className="flex flex-1 flex-col gap-1 sm:w-64">
                  <label className="text-[10px] text-terminal-muted">URL</label>
                  <TerminalInput
                    size="sm"
                    type="text"
                    value={action.url}
                    placeholder="https://example.com/hook"
                    onChange={(e) => updateAction(index, { ...action, url: e.target.value })}
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {validationError ? (
        <div className="text-[11px] text-terminal-neg">{validationError}</div>
      ) : null}

      {alertId && (
        <div className="space-y-2">
          <TerminalButton
            variant="default"
            size="sm"
            loading={dryRunLoading}
            onClick={() => runDryRun(alertId)}
          >
            Dry run
          </TerminalButton>

          {dryRunError && (
            <div className="text-[11px] text-terminal-neg">
              Dry run failed: {dryRunError instanceof Error ? dryRunError.message : String(dryRunError)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}