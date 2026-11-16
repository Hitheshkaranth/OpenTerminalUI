import { useEffect, useRef, useState, type ReactNode } from "react";
import { cancelPaperOrder, createPaperPortfolio, fetchPaperOrders, fetchPaperPerformance, fetchPaperPortfolios,
  fetchPaperPositions, fetchPaperTrades, placePaperOrder } from "../api/client";
import { extractApiErrorMessage } from "../api/base";
import { HotKeyPanel } from "../components/trading/HotKeyPanel";
import type { PaperOrder, PaperPerformance, PaperPortfolio, PaperPosition, PaperTrade } from "../types";

const currencies = ["INR", "USD", "EUR", "GBP", "JPY", "HKD", "AUD", "CAD", "CHF", "SGD"];
const inputClass = "w-full rounded border border-terminal-border bg-terminal-bg px-2 py-2 text-xs text-terminal-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-terminal-accent";
const buttonClass = "rounded border border-terminal-accent px-3 py-2 text-xs text-terminal-accent disabled:opacity-50";
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1 text-xs text-terminal-text"><span>{label}</span>{children}</label>;
}

export function PaperTradingPage() {
  const [portfolios, setPortfolios] = useState<PaperPortfolio[]>([]);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState("");
  const [loadingPortfolios, setLoadingPortfolios] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [name, setName] = useState("Paper Portfolio");
  const [capital, setCapital] = useState("100000");
  const [baseCurrency, setBaseCurrency] = useState("INR");
  const [symbol, setSymbol] = useState("NSE:RELIANCE");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit" | "sl">("market");
  const [quantity, setQuantity] = useState("1");
  const [limitPrice, setLimitPrice] = useState("");
  const [slPrice, setSlPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [positions, setPositions] = useState<PaperPosition[]>([]);
  const [orders, setOrders] = useState<PaperOrder[]>([]);
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [perf, setPerf] = useState<PaperPerformance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [writing, setWriting] = useState(false);
  const writeLock = useRef(false);
  const mounted = useRef(true);
  const selection = useRef(selectedPortfolioId);
  const detailsVersion = useRef(0);
  selection.current = selectedPortfolioId;

  async function loadPortfolios() {
    const items = await fetchPaperPortfolios();
    if (!mounted.current) return;
    setPortfolios(items);
    setSelectedPortfolioId((current) => items.some((item) => item.id === current) ? current : items[0]?.id || "");
  }
  async function loadDetails(id: string) {
    const version = ++detailsVersion.current;
    const [p, o, t, k] = await Promise.all([fetchPaperPositions(id), fetchPaperOrders(id), fetchPaperTrades(id), fetchPaperPerformance(id)]);
    if (!mounted.current || selection.current !== id || version !== detailsVersion.current) return;
    setPositions(p); setOrders(o); setTrades(t); setPerf(k);
  }
  useEffect(() => {
    mounted.current = true;
    void loadPortfolios().catch((e) => { if (mounted.current) setError(extractApiErrorMessage(e, "Unable to load paper portfolios.")); })
      .finally(() => { if (mounted.current) setLoadingPortfolios(false); });
    return () => { mounted.current = false; };
  }, [retry]);
  useEffect(() => {
    setPositions([]); setOrders([]); setTrades([]); setPerf(null);
    setDetailsError(false);
    if (!selectedPortfolioId) { setLoadingDetails(false); return; }
    let active = true;
    setLoadingDetails(true);
    void loadDetails(selectedPortfolioId).catch((e) => { if (active) { setDetailsError(true); setError(extractApiErrorMessage(e, "Unable to load paper portfolio details.")); } })
      .finally(() => { if (active) setLoadingDetails(false); });
    return () => { active = false; };
  }, [selectedPortfolioId, retry]);
  async function write(action: () => Promise<void>) {
    if (writeLock.current) return;
    writeLock.current = true; setWriting(true); setError(null); setNotice("");
    try { await action(); }
    catch (e) { if (mounted.current) setError(extractApiErrorMessage(e, "Paper request failed.")); }
    finally { writeLock.current = false; if (mounted.current) setWriting(false); }
  }
  async function refreshAfterWrite(id: string) {
    try { await Promise.all([loadPortfolios(), loadDetails(id)]); }
    catch (e) { if (mounted.current) { setDetailsError(true); setPerf(null); setError(`Request completed, but balances could not be refreshed: ${extractApiErrorMessage(e, "Refresh failed.")}`); } }
  }
  const selected = portfolios.find((item) => item.id === selectedPortfolioId);
  const currency = selected?.base_currency || "INR";
  function money(value: number | null | undefined) {
    return typeof value === "number" && Number.isFinite(value)
      ? `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Unavailable";
  }
  function metric(value: number | undefined, percentage = false) {
    return typeof value === "number" && Number.isFinite(value) ? `${(value * (percentage ? 100 : 1)).toFixed(2)}${percentage ? "%" : ""}` : "Unavailable";
  }
  return <div className="space-y-3 p-3 text-terminal-text">
    <header><h1 className="text-lg font-semibold">Paper trading</h1><p className="mt-1 text-xs">Simulated orders and a cash ledger in your portfolio's base currency.</p></header>
    {error && <button className={buttonClass} disabled={writing || loadingPortfolios || loadingDetails} onClick={() => { setError(null); setLoadingPortfolios(true); setRetry((value) => value + 1); }}>Reload paper data</button>}
    {error && <div role="alert" className="rounded border border-terminal-neg bg-terminal-neg/10 p-3 text-sm text-terminal-neg">{error}</div>}
    {notice && <p role="status" className="rounded border border-terminal-border p-3 text-sm">{notice}</p>}
    <section className="rounded border border-terminal-border bg-terminal-panel p-3" aria-labelledby="paper-create-title">
      <h2 id="paper-create-title" className="mb-3 text-sm font-semibold">Create virtual portfolio</h2>
      <form onSubmit={(event) => { event.preventDefault(); void write(async () => {
        const created = await createPaperPortfolio({ name: name.trim(), initial_capital: Number(capital), base_currency: baseCurrency });
        if (!mounted.current) return;
        setPortfolios((current) => [created, ...current.filter((item) => item.id !== created.id)]);
        setSelectedPortfolioId(created.id);
        setNotice(`Portfolio created in ${created.base_currency || baseCurrency}.`);
      }); }}>
        <fieldset disabled={writing || loadingPortfolios} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Portfolio name"><input className={inputClass} required value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Initial capital"><input className={inputClass} type="number" required min="0.01" step="any" value={capital} onChange={(e) => setCapital(e.target.value)} /></Field>
          <Field label="Base currency"><select className={inputClass} value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)}>{currencies.map((code) => <option key={code}>{code}</option>)}</select></Field>
          <button className={buttonClass} type="submit">Create portfolio</button>
        </fieldset>
      </form>
      <div className="mt-3 max-w-md"><Field label="Active paper portfolio"><select className={inputClass} value={selectedPortfolioId} disabled={writing || loadingPortfolios}
        onChange={(e) => { selection.current = e.target.value; setError(null); setNotice(""); setSelectedPortfolioId(e.target.value); }}>
        <option value="">{loadingPortfolios ? "Loading portfolios…" : "Select portfolio"}</option>
        {portfolios.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.base_currency || "INR"})</option>)}
      </select></Field></div>
    </section>
    <section className="rounded border border-terminal-border bg-terminal-panel p-3" aria-labelledby="paper-order-title">
      <h2 id="paper-order-title" className="mb-3 text-sm font-semibold">Virtual order entry{selected ? ` · ${currency} ledger` : ""}</h2>
      <form onSubmit={(event) => { event.preventDefault(); if (!selectedPortfolioId) return; const id = selectedPortfolioId; void write(async () => {
        const result = await placePaperOrder({ portfolio_id: id, symbol: symbol.trim().toUpperCase(), side, order_type: orderType,
          quantity: Number(quantity), ...(orderType === "limit" ? { limit_price: Number(limitPrice) } : {}),
          ...(orderType === "sl" ? { sl_price: Number(slPrice) } : {}),
          ...(side === "buy" && stopPrice !== "" ? { stop_price: Number(stopPrice) } : {}) });
        if (!mounted.current) return;
        if (result.status === "rejected") setError(result.risk_rejection || "Order rejected by paper execution checks.");
        else setNotice(result.status === "filled" ? "Paper order filled." : "Paper order submitted; awaiting execution checks and a matching quote.");
        await refreshAfterWrite(id);
      }); }}>
        <fieldset disabled={writing || !selected || loadingDetails || detailsError} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Symbol"><input className={inputClass} required value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} /></Field>
          <Field label="Side"><select className={inputClass} value={side} onChange={(e) => setSide(e.target.value as "buy" | "sell")}><option value="buy">Buy</option><option value="sell">Sell</option></select></Field>
          <Field label="Order type"><select className={inputClass} value={orderType} onChange={(e) => setOrderType(e.target.value as typeof orderType)}><option value="market">Market</option><option value="limit">Limit</option><option value="sl">Stop trigger</option></select></Field>
          <Field label="Quantity"><input className={inputClass} type="number" required min="0.000001" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
          {orderType === "limit" && <Field label="Limit price (quote currency)"><input className={inputClass} type="number" required min="0.000001" step="any" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} /></Field>}
          {orderType === "sl" && <Field label="Order trigger price (quote currency)"><input className={inputClass} type="number" required min="0.000001" step="any" value={slPrice} onChange={(e) => setSlPrice(e.target.value)} /></Field>}
          {side === "buy" && <Field label="Hypothetical risk stop (optional, quote currency)"><input className={inputClass} type="number" min="0.000001" step="any" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} /></Field>}
          <button type="submit" className={buttonClass}>Place paper order</button>
        </fieldset>
      </form>
      <p className="mt-3 text-xs">The hypothetical risk stop is used by saved risk limits. It does not place a stop order or protect against gaps. An order trigger is a separate field. Quotes use the instrument's currency; balances use {currency}. Foreign-currency fills require a verified exchange rate.</p>
    </section>
    <HotKeyPanel embedded className="shadow-[0_0_0_1px_rgba(148,163,184,0.08)]" />
    {loadingDetails && <p role="status">Loading portfolio balances and orders…</p>}
    {selected && !loadingDetails && <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <section className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs"><h2 className="mb-2 text-sm font-semibold">Performance · {currency}</h2>
        <div>Portfolio: {selected.name}</div><div>Initial: {money(selected.initial_capital)}</div><div>Cash: {money(detailsError ? undefined : selected.current_cash)}</div>
        <div>Equity: {money(perf?.equity)}</div><div>P&amp;L: {money(perf?.pnl)}</div><div>Return: {metric(perf?.cumulative_return, true)}</div>
        <div>Sharpe: {metric(perf?.sharpe_ratio)}</div><div>Max drawdown: {metric(perf?.max_drawdown, true)}</div>
      </section>
      <section className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs"><h2 className="mb-2 text-sm font-semibold">Positions · {currency}</h2>
        {!detailsError && positions.map((item) => <div key={item.id} className="border-b border-terminal-border py-2">{item.symbol} · Quantity {item.quantity}<br />Average {money(item.avg_entry_price)} · Mark {money(item.mark_price)} · Unrealized P&amp;L {money(item.unrealized_pnl)}</div>)}
        {detailsError ? <p>Positions unavailable. Reload paper data to retry.</p> : !positions.length && <p>No positions recorded.</p>}
      </section>
      <section className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs"><h2 className="mb-2 text-sm font-semibold">Recent orders</h2>
        {!detailsError && orders.slice(0, 12).map((item) => <div key={item.id} className="space-y-2 border-b border-terminal-border py-2">
          <p>{item.symbol} {item.side.toUpperCase()} {item.quantity} {item.order_type} · {item.status}</p>
          {item.risk_rejection && <p className="text-terminal-neg">Risk check: {item.risk_rejection}</p>}
          {item.status === "pending" && <button className={buttonClass} disabled={writing} aria-label={`Cancel pending order ${item.symbol} ${item.id}`}
            onClick={() => { const id = selectedPortfolioId; void write(async () => { await cancelPaperOrder(item.id); if (mounted.current) setNotice("Pending order cancelled. Reserved capacity released."); await refreshAfterWrite(id); }); }}>Cancel pending order</button>}
        </div>)}
        {detailsError ? <p>Orders unavailable. Reload paper data to retry.</p> : !orders.length && <p>No orders recorded.</p>}
      </section>
    </div>}
    <section className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs"><h2 className="mb-2 text-sm font-semibold">Trade blotter{selected ? ` · ${currency}` : ""}</h2>
      {!detailsError && trades.slice(0, 20).map((item) => <div key={item.id} className="border-b border-terminal-border py-2">{new Date(item.timestamp).toLocaleString()} · {item.symbol} {item.side.toUpperCase()} {item.quantity} @ {money(item.price)} · Realized P&amp;L {money(item.pnl_realized)}</div>)}
      {detailsError ? <p>Trades unavailable. Reload paper data to retry.</p> : !trades.length && <p>{loadingDetails ? "Loading trades…" : "No trades recorded."}</p>}
    </section>
  </div>;
}
