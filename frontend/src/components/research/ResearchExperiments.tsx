import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, extractApiErrorMessage } from "../../api/base";
import { downloadJson } from "../../lib/downloadJson";

type Experiment = { id: string; title: string; symbol: string; sha256: string; created_at: string };
type FrozenBar = { date: string; available_at: string; open: number; high: number; low: number; close: number; volume: number };
export function parseFrozenBars(csv: string): FrozenBar[] {
  const rows = csv.trim().split(/\r?\n/).filter((line) => line.trim());
  const headers = rows.shift()?.split(",").map((s) => s.trim().toLowerCase()) || [];
  const required = ["date", "available_at", "open", "high", "low", "close", "volume"];
  if (!required.every((h) => headers.includes(h))) throw new Error(`CSV columns required: ${required.join(", ")}`);
  if (rows.length < 10 || rows.length > 20000) throw new Error("Provide between 10 and 20,000 price bars.");
  return rows.map((line, index) => {
    const values = line.split(",").map((s) => s.trim());
    const row = Object.fromEntries(required.map((key) => [key, values[headers.indexOf(key)]]));
    if (!row.date || !row.available_at || !/[zZ]|[+-]\d{2}:\d{2}$/.test(row.date) || !/[zZ]|[+-]\d{2}:\d{2}$/.test(row.available_at)) throw new Error(`Row ${index + 2}: timestamps must include a timezone.`);
    const numbers = Object.fromEntries(required.slice(2).map((key) => [key, row[key] === "" || row[key] === undefined ? NaN : Number(row[key])]));
    if (Object.values(numbers).some((n) => !Number.isFinite(n))) throw new Error(`Row ${index + 2}: price or volume is missing or invalid.`);
    return { date: row.date, available_at: row.available_at, ...numbers } as FrozenBar;
  });
}

export function ResearchExperiments({ dossierId, symbol }: { dossierId: string; symbol: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["research-experiments", dossierId], queryFn: async () => (await api.get<{ items: Experiment[] }>("/research/experiments", { params: { dossier_id: dossierId } })).data.items });
  const [bars, setBars] = useState<FrozenBar[]>([]);
  const [form, setForm] = useState({ title: `${symbol} moving-average experiment`, provider: "", data_version: "", adjustment_policy: "raw", as_of: "", train_end: "", validation_start: "", short_window: 20, long_window: 50, fee_bps: 5, slippage_bps: 5 });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const act = async (fn: () => Promise<void>) => { setBusy(true); setNotice(""); try { await fn(); } catch (e) { setNotice(extractApiErrorMessage(e, "Experiment failed.")); } finally { setBusy(false); } };
  const input = "block w-full rounded border border-terminal-border bg-terminal-bg p-2 text-sm";
  const utcEnd = (date: string) => `${date}T23:59:59Z`;
  return <section className="mt-6 border-t border-terminal-border pt-5"><h3 className="font-semibold">Reproducible experiments</h3><p className="mt-1 text-sm text-terminal-muted">Freeze price bars and costs, test a fixed moving-average strategy, then replay without fetching new data.</p>
    {notice && <p role="status" className="my-3 text-sm">{notice}</p>}
    {query.isError && <p role="alert" className="text-sm">Unable to load experiments.</p>}
    <ul className="divide-y divide-terminal-border">{query.data?.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div><strong>{item.title}</strong><p className="text-xs text-terminal-muted">Saved {new Date(item.created_at).toLocaleDateString()}</p></div><div className="flex gap-2">
      <button disabled={busy} className="rounded border border-terminal-border p-2" onClick={() => void act(async () => { const { data } = await api.post(`/research/experiments/${item.id}/replay`); setNotice(data.matches ? "Replay matched the saved results using the frozen data. No provider requests were made." : "Replay results differ. Inspect the exported experiment before relying on it."); })}>Replay experiment</button>
      <button disabled={busy} className="rounded border border-terminal-border p-2" onClick={() => void act(async () => downloadJson((await api.get(`/research/experiments/${item.id}`)).data, `${symbol}-experiment.json`))}>Export experiment</button>
    </div></li>)}</ul>
    <details className="mt-3 rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Create frozen-data experiment</summary><form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void act(async () => {
      const asOf = new Date(Math.min(new Date(utcEnd(form.as_of)).getTime(), Date.now())).toISOString();
      await api.post("/research/experiments", { ...form, dossier_id: dossierId, symbol, bars, as_of: asOf, train_end: utcEnd(form.train_end), validation_start: `${form.validation_start}T00:00:00Z` });
      await client.invalidateQueries({ queryKey: ["research-experiments", dossierId] }); setNotice("Experiment saved with separate training and validation results.");
    }); }}>
      <label className="block text-sm">Price bars CSV<input required type="file" accept=".csv,text/csv" className={input} onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { if (file.size > 8_000_000) throw new Error("CSV must be smaller than 8 MB."); setBars(parseFrozenBars(await file.text())); setNotice(""); } catch (error) { setBars([]); setNotice((error as Error).message); } }} /></label>
      <p className="text-xs text-terminal-muted">Columns: date, available_at, open, high, low, close, volume. Use timezone-qualified timestamps at the completed bar’s decision time. Publication times and adjustment policy must come from your source; they are not inferred.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {([['title', 'Experiment title'], ['provider', 'Data source'], ['data_version', 'Source version or snapshot ID']] as const).map(([key, label]) => <label key={key} className="text-sm">{label}<input required className={input} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>)}
        <label className="text-sm">Price adjustment<select className={input} value={form.adjustment_policy} onChange={(e) => setForm({ ...form, adjustment_policy: e.target.value })}><option value="raw">Raw prices</option><option value="split_adjusted">Split adjusted</option><option value="total_return_adjusted">Total return adjusted</option></select></label>
        {([['as_of', 'Data known by (UTC)'], ['train_end', 'Training ends (UTC)'], ['validation_start', 'Validation starts (UTC)']] as const).map(([key, label]) => <label key={key} className="text-sm">{label}<input required type="date" className={input} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>)}
        {([['short_window', 'Short moving average'], ['long_window', 'Long moving average'], ['fee_bps', 'Fees (basis points)'], ['slippage_bps', 'Slippage (basis points)']] as const).map(([key, label]) => <label key={key} className="text-sm">{label}<input required type="number" min={key.includes("window") ? 1 : 0} max={1000} className={input} value={form[key]} onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })} /></label>)}
      </div>
      <button disabled={busy || !bars.length} className="rounded border border-terminal-border px-3 py-2 text-sm">{busy ? "Running…" : `Freeze and test ${bars.length} bars`}</button>
    </form></details>
  </section>;
}
