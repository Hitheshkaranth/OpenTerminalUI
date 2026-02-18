import { useMemo, useState } from "react";

import { addTaxLot, realizeTaxLots } from "../../api/client";
import type { TaxLotSummary } from "../../types";
import { formatInr } from "../../utils/formatters";

export function TaxLotManager({ data, onRefresh }: { data: TaxLotSummary | null; onRefresh: () => Promise<void> }) {
  const [ticker, setTicker] = useState("RELIANCE");
  const [qty, setQty] = useState(10);
  const [buyPrice, setBuyPrice] = useState(1000);
  const [buyDate, setBuyDate] = useState(new Date().toISOString().slice(0, 10));
  const [sellQty, setSellQty] = useState(5);
  const [sellPrice, setSellPrice] = useState(1200);
  const [sellDate, setSellDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<"FIFO" | "LIFO" | "SPECIFIC">("FIFO");
  const [message, setMessage] = useState<string>("");

  const rows = data?.lots ?? [];
  const unrealized = data?.unrealized_gain_total ?? 0;
  const lotsByTicker = useMemo(() => rows.filter((r) => r.ticker === ticker.toUpperCase()), [rows, ticker]);

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-terminal-accent">Tax Lot Manager</div>
        <div className="text-xs text-terminal-muted">Unrealized: {formatInr(unrealized)}</div>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-2 text-xs" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} />
        <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-2 text-xs" type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
        <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-2 text-xs" type="number" value={buyPrice} onChange={(e) => setBuyPrice(Number(e.target.value))} />
        <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-2 text-xs" type="date" value={buyDate} onChange={(e) => setBuyDate(e.target.value)} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          className="rounded border border-terminal-accent px-3 py-2 text-xs text-terminal-accent"
          onClick={async () => {
            try {
              await addTaxLot({ ticker, quantity: qty, buy_price: buyPrice, buy_date: buyDate });
              await onRefresh();
              setMessage("Tax lot added");
            } catch (e) {
              setMessage(e instanceof Error ? e.message : "Failed to add tax lot");
            }
          }}
        >
          Add Lot
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-5">
        <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-2 text-xs" type="number" value={sellQty} onChange={(e) => setSellQty(Number(e.target.value))} />
        <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-2 text-xs" type="number" value={sellPrice} onChange={(e) => setSellPrice(Number(e.target.value))} />
        <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-2 text-xs" type="date" value={sellDate} onChange={(e) => setSellDate(e.target.value)} />
        <select className="rounded border border-terminal-border bg-terminal-bg px-2 py-2 text-xs" value={method} onChange={(e) => setMethod(e.target.value as "FIFO" | "LIFO" | "SPECIFIC") }>
          <option value="FIFO">FIFO</option>
          <option value="LIFO">LIFO</option>
          <option value="SPECIFIC">Specific</option>
        </select>
        <button
          className="rounded border border-terminal-border px-3 py-2 text-xs text-terminal-text"
          onClick={async () => {
            try {
              const specific_lot_ids = method === "SPECIFIC" ? lotsByTicker.slice(0, Math.ceil(sellQty)).map((x) => x.id) : undefined;
              const out = await realizeTaxLots({ ticker, quantity: sellQty, sell_price: sellPrice, sell_date: sellDate, method, specific_lot_ids });
              await onRefresh();
              setMessage(`Realized gain: ${formatInr(out.realized_gain_total)} | STCG ${formatInr(out.short_term_gain)} | LTCG ${formatInr(out.long_term_gain)}`);
            } catch (e) {
              setMessage(e instanceof Error ? e.message : "Failed to realize lots");
            }
          }}
        >
          Realize
        </button>
      </div>

      {message ? <div className="mt-2 text-xs text-terminal-muted">{message}</div> : null}

      <div className="mt-3 max-h-56 overflow-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-terminal-border text-terminal-muted">
              <th className="px-2 py-1 text-left">ID</th>
              <th className="px-2 py-1 text-left">Ticker</th>
              <th className="px-2 py-1 text-right">Qty</th>
              <th className="px-2 py-1 text-right">Remain</th>
              <th className="px-2 py-1 text-right">Buy</th>
              <th className="px-2 py-1 text-left">Date</th>
              <th className="px-2 py-1 text-right">Unrealized</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-terminal-border/50">
                <td className="px-2 py-1">{r.id}</td>
                <td className="px-2 py-1">{r.ticker}</td>
                <td className="px-2 py-1 text-right">{r.quantity}</td>
                <td className="px-2 py-1 text-right">{r.remaining_quantity}</td>
                <td className="px-2 py-1 text-right">{formatInr(r.buy_price)}</td>
                <td className="px-2 py-1">{r.buy_date}</td>
                <td className="px-2 py-1 text-right">{formatInr(r.unrealized_gain ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
