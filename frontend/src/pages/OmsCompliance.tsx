import { useEffect, useState } from "react";

import { createOmsOrder, fetchAuditEvents, fetchOmsOrders, setRestrictedSymbol } from "../api/client";
import type { AuditEvent, OmsOrder } from "../types";

export function OmsCompliancePage() {
  const [symbol, setSymbol] = useState("RELIANCE");
  const [side, setSide] = useState<"buy" | "sell" | "long" | "short">("buy");
  const [quantity, setQuantity] = useState(10);
  const [orders, setOrders] = useState<OmsOrder[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const [o, a] = await Promise.all([fetchOmsOrders(), fetchAuditEvents()]);
    setOrders(o);
    setAudit(a.slice(0, 100));
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-3 p-4">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-sm font-semibold text-terminal-accent">Order Ticket + Compliance</div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
          <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          <select className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={side} onChange={(e) => setSide(e.target.value as any)}>
            <option value="buy">BUY</option>
            <option value="sell">SELL</option>
            <option value="long">LONG</option>
            <option value="short">SHORT</option>
          </select>
          <input type="number" className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
          <button
            className="rounded border border-terminal-border px-2 py-1 text-xs"
            onClick={async () => {
              const out = await createOmsOrder({ symbol, side, quantity, simulate_fill: true });
              setMessage(`Order ${out.order.status}: ${out.order.id}`);
              await load();
            }}
          >
            Submit Order
          </button>
          <button
            className="rounded border border-terminal-neg px-2 py-1 text-xs text-terminal-neg"
            onClick={async () => {
              await setRestrictedSymbol({ symbol, active: true, reason: "Manual compliance restriction" });
              setMessage(`Restricted ${symbol}`);
              await load();
            }}
          >
            Restrict Symbol
          </button>
        </div>
        {message && <div className="mt-2 text-xs text-terminal-muted">{message}</div>}
      </div>

      <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
        <div className="mb-2 font-semibold">Orders</div>
        <div className="space-y-1">
          {orders.map((o) => (
            <div key={o.id}>
              {o.created_at} | {o.symbol} | {o.side} {o.quantity} | {o.status}
              {o.rejection_reason ? ` | ${o.rejection_reason}` : ""}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
        <div className="mb-2 font-semibold">Audit Log</div>
        <div className="space-y-1">
          {audit.map((a) => (
            <div key={a.id}>
              {a.created_at} | {a.event_type} | {a.entity_type}:{a.entity_id || "-"}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
