import { api } from "./base";

export type PaperOrderAction = {
  type: "paper_order";
  portfolio_id: string;
  side: "buy" | "sell";
  quantity: number;
  order_type: "market";
};

export type WatchlistAction = {
  type: "add_to_watchlist";
  watchlist_id: string;
};

export type WebhookAction = {
  type: "webhook";
  url: string;
  payload?: Record<string, unknown> | null;
};

export type AlertAction = PaperOrderAction | WatchlistAction | WebhookAction;

export const MAX_ALERT_ACTIONS = 5;

export type DryRunResult = {
  alert_id: string;
  actions: Array<{ type: string; ok: boolean; detail: string }>;
};

export async function dryRunAlertActions(alertId: string): Promise<DryRunResult> {
  const { data } = await api.post<DryRunResult>(`/alerts/${encodeURIComponent(alertId)}/actions/dry-run`);
  return data;
}

export function readActions(
  config: Record<string, unknown> | undefined | null,
): AlertAction[] {
  if (!config || typeof config !== "object") return [];
  const raw = (config as Record<string, unknown>).actions;
  if (!Array.isArray(raw)) return [];

  const result: AlertAction[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const type = obj.type as string;

    if (type === "paper_order") {
      if (typeof obj.portfolio_id === "string" && typeof obj.side === "string" && typeof obj.quantity === "number") {
        if (obj.quantity > 0 && (obj.side === "buy" || obj.side === "sell")) {
          result.push({
            type: "paper_order",
            portfolio_id: obj.portfolio_id,
            side: obj.side as "buy" | "sell",
            quantity: obj.quantity,
            order_type: "market",
          });
          continue;
        }
      }
    } else if (type === "add_to_watchlist") {
      if (typeof obj.watchlist_id === "string") {
        result.push({
          type: "add_to_watchlist",
          watchlist_id: obj.watchlist_id,
        });
        continue;
      }
    } else if (type === "webhook") {
      if (typeof obj.url === "string") {
        result.push({
          type: "webhook",
          url: obj.url,
          payload: obj.payload as Record<string, unknown> | null | undefined,
        });
        continue;
      }
    }

    // Malformed entry — drop it
  }
  return result;
}

export function validateActions(actions: AlertAction[]): string | null {
  if (actions.length > MAX_ALERT_ACTIONS) {
    return `Maximum ${MAX_ALERT_ACTIONS} actions allowed`;
  }

  for (const action of actions) {
    if (action.type === "paper_order") {
      if (action.quantity <= 0) {
        return "Paper order quantity must be greater than 0";
      }
      if (!action.portfolio_id || typeof action.portfolio_id !== "string" || !action.portfolio_id.trim()) {
        return "Paper order requires a portfolio_id";
      }
    } else if (action.type === "add_to_watchlist") {
      if (!action.watchlist_id || typeof action.watchlist_id !== "string" || !action.watchlist_id.trim()) {
        return "Add to watchlist requires a watchlist_id";
      }
    } else if (action.type === "webhook") {
      if (action.url && !/^https?:\/\/.+/i.test(action.url)) {
        return "Webhook URL must start with http:// or https://";
      }
    }
  }

  return null;
}